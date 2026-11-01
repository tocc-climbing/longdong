import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useLang } from '../i18n'
import { clampView, fitSize, IDENTITY, MAX_SCALE, moveView, type Inset, type Pt, type Size, type View } from '../core/topo/viewport'

/** 要縮放到的一塊（照片上的比例 0–1）；seq 不同才算新的一次 */
export interface ZoomFocus {
  x: number
  y: number
  w: number
  h: number
  seq: number
  /** 只放大不縮小（放大到一個點）：使用者自己放得更大時維持 */
  keepZoom?: boolean
}

/** 一次按 ＋／－ 或鍵盤 +／- 的縮放倍率 */
const STEP = 1.5
/** 滑鼠移動超過這個距離（螢幕像素）才算拖曳，之前都當作點擊 */
export const DRAG_PX = 5
/** 編輯用：在照片上按住不動超過這個時間（毫秒），接著拖曳就是平移 */
const LONG_PRESS_MS = 350
/** 手指點兩下：兩次放開相隔不超過這個時間（毫秒）、距離不超過 DOUBLE_TAP_PX，回到原尺寸 */
const DOUBLE_TAP_MS = 350
const DOUBLE_TAP_PX = 30
/** 點兩下之後這段時間（毫秒）的點擊都擋掉：瀏覽器可能在點兩下之後才送出兩下的 click */
const DOUBLE_TAP_QUIET_MS = 400

/**
 * 編輯用的縮放區（電腦版）：滾輪或 +／- 縮放（以游標位置為中心）、0 回到整張；
 * 放大後平移有四種方式：照片上長按（按住不動一下）再拖曳、按住空白鍵拖曳、滑鼠中鍵拖曳、右下角的「移動」按鈕（開啟後左鍵拖曳就是平移）。
 * 左鍵平常留給標記；平移（或拖曳超過幾個像素）結束放開時，不會當作點了一下而多出一個點。
 * children 收到目前倍率，點、線、把手依此反向調整，放大後仍維持相同的螢幕大小；
 * 位置換算用 getBoundingClientRect，已經包含縮放與平移。
 * 手指（編輯）：單指點一下標記；放大後單指在空白處拖曳平移，雙指捏合縮放、同時平移（照片上的把手自己要能拖）。
 * 觀看用（viewing）：照片上沒有要標記的東西，放大後直接按住左鍵拖曳平移（沒拖動就是點路線）；
 * 頁面要能捲動，所以滾輪要按住 Ctrl（⌘、觸控板的雙指縮放）才縮放，+／-／0 只在游標停在照片上時有效。
 * holding：回傳 true 時手指按住的拖曳留給外面（手機版編輯按住瞄準加點），不平移。
 * focus：換一個值（seq）就平滑地縮放到那一塊（照片上的比例 0–1）；那一塊已經整個看得到、放得夠大時不動。
 * aspect（手機版編輯）：縮放區撐滿外面的空間，照片（這個寬高比）置中縮到放得下；放大後照片可以佔滿整個縮放區。
 * 上下浮著按鈕時，縮放區的 CSS scroll-padding-top／bottom 設成按鈕佔的高度：照片的上下緣可以拖到按鈕外面（沒放大也可以）。
 * 編輯時手指點兩下回到原尺寸，接著呼叫 onDoubleTap（第一下若加了點，由外面收回）；第二下不當作點了一下。
 */
export function ZoomPane({
  children,
  viewing,
  holding,
  focus,
  aspect,
  onDoubleTap,
}: {
  children: (zoom: number) => ReactNode
  viewing?: boolean
  holding?: () => boolean
  focus?: ZoomFocus
  aspect?: number
  onDoubleTap?: () => void
}) {
  const { t } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [inset, setInset] = useState<Inset>({ top: 0, bottom: 0 })
  const [view, setView] = useState<View>(IDENTITY)
  const [space, setSpace] = useState(false)
  const [hand, setHand] = useState(false)
  const pan = useRef<Pt | null>(null)
  const hover = useRef(false)
  /** 左鍵按下的位置；移動超過 DRAG_PX 才算拖曳（觀看時開始平移），之後放開時擋掉那一次點擊 */
  const press = useRef<Pt | null>(null)
  /** 這一輪按下到放開之間平移、拖曳或捏合過：放開後的那一次點擊要擋掉；下一次按下（第二根手指除外）才重新算 */
  const dragged = useRef(false)
  /** 編輯用：按住不動的計時；時間到之後（long）拖曳就是平移 */
  const longTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [long, setLong] = useState(false)
  const armed = useRef(false)
  /** 按在點、把手、裁切框上：手指拖曳是移動它們，不是平移 */
  const onHandle = useRef(false)
  /** 螢幕上的手指（只在編輯時追蹤）；兩根以上就是捏合 */
  const touches = useRef(new Map<number, Pt>())
  /** 上一次手指點一下（放開的時間、位置）：再點一下就是點兩下 */
  const lastTap = useRef<{ at: number; p: Pt } | null>(null)
  /** 上一次點兩下的時間 */
  const doubleAt = useRef(-Infinity)

  useLayoutEffect(() => {
    const el = box.current!
    const measure = () => {
      setStage({ w: el.clientWidth, h: el.clientHeight })
      const css = getComputedStyle(el)
      const top = parseFloat(css.scrollPaddingTop) || 0
      const bottom = parseFloat(css.scrollPaddingBottom) || 0
      setInset((v) => (v.top === top && v.bottom === bottom ? v : { top, bottom }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** 照片在縮放區裡（沒放大時）的大小 */
  const content = aspect ? fitSize(stage, aspect) : stage
  // 照片的寬高比變了（裁切、視窗大小）：放大後的位置重新限制在照片範圍內
  useEffect(() => setView((v) => clampView(v, stage, content, inset)), [stage, content.w, content.h, inset])

  useEffect(() => () => clearTimeout(longTimer.current), [])

  // 自動縮放：動畫只在這一次（手指一按下就停掉，不拖慢手勢）
  const [gliding, setGliding] = useState(false)
  useEffect(() => {
    if (!focus || stage.w === 0) return
    setView((v) => {
      const box = { x: (focus.x - 0.5) * content.w, y: (focus.y - 0.5) * content.h, w: focus.w * content.w, h: focus.h * content.h }
      const fit = Math.min(MAX_SCALE, Math.max(1, Math.min(stage.w / Math.max(box.w, 1), stage.h / Math.max(box.h, 1))))
      const scale = focus.keepZoom ? Math.max(fit, v.scale) : fit
      // 已經整個看得到、而且放得比要的還大：不動
      const seen = (at: number, size: number, room: number, shift: number) => Math.abs(shift + at * v.scale) + (size * v.scale) / 2 <= room / 2
      if (v.scale >= scale && seen(box.x + box.w / 2, box.w, stage.w, v.x) && seen(box.y + box.h / 2, box.h, stage.h, v.y)) return v
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      return clampView({ scale, x: -cx * scale, y: -cy * scale }, stage, content, inset)
    })
    setGliding(true)
    const timer = setTimeout(() => setGliding(false), 350)
    return () => clearTimeout(timer)
    // 只在 focus 換了（或舞台第一次量到大小）的時候
  }, [focus, stage.w > 0])

  /** 滑鼠位置換成以舞台中心為原點的座標 */
  const rel = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
  }
  const zoomBy = (ratio: number, at: Pt = { x: 0, y: 0 }) => setView((v) => moveView(v, at, at, ratio, stage, content, inset))
  /** 可以平移：放大了，或照片的上下緣能拖到按鈕外面 */
  const movable = view.scale > 1 || inset.top > 0 || inset.bottom > 0

  useEffect(() => {
    const el = box.current!
    const onWheel = (e: WheelEvent) => {
      if (viewing && !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomBy(Math.exp((-e.deltaY * (e.deltaMode === 1 ? 16 : 1)) / 500), rel(e))
    }
    // 要能 preventDefault（不讓頁面捲動），所以不用 React 的 onWheel（被動監聽）
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (viewing && !hover.current) return
      if (e.key === '+' || e.key === '=') zoomBy(STEP)
      else if (e.key === '-') zoomBy(1 / STEP)
      else if (e.key === '0') setView(IDENTITY)
      // 空白鍵只在游標停在照片上時當作平移：游標在別處時留給按鈕、表單原本的用途
      else if (e.key === ' ' && hover.current && !viewing) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => e.key === ' ' && setSpace(false)
    const release = () => setSpace(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', release)
    }
  })

  const startPanAt = (e: ReactPointerEvent) => {
    box.current!.setPointerCapture(e.pointerId)
    pan.current = press.current ?? rel(e)
    dragged.current = true
  }
  // 平移：在捕獲階段攔下，照片上的點、把手收不到這次按下；指標鎖在這個區域
  const startPan = (e: ReactPointerEvent) => {
    setGliding(false)
    // 控制按鈕自己要能按（包括關掉「移動」）
    if ((e.target as Element).closest('.topo-zoom-controls')) return
    // 第一根手指就是新的一輪（上一輪漏收的放開不留著）
    if (e.pointerType === 'touch' && e.isPrimary) touches.current.clear()
    if (!(e.pointerType === 'touch' && touches.current.size > 0)) dragged.current = false
    onHandle.current = !!(e.target as Element).closest('.topo-handles, .topo-hits, .topo-fork, .topo-crop')
    if (e.pointerType === 'touch' && !viewing) {
      touches.current.set(e.pointerId, rel(e))
      if (touches.current.size >= 2) {
        // 第二根手指放下：改成捏合。正在拖的把手、長按的計時都取消，放開時不當作點了一下
        e.stopPropagation()
        clearTimeout(longTimer.current)
        press.current = null
        pan.current = null
        armed.current = false
        dragged.current = true
        for (const id of touches.current.keys()) box.current!.setPointerCapture(id)
        return
      }
    }
    if (e.button === 0) press.current = rel(e)
    if (viewing && e.button === 0) return
    if (e.button !== 1 && !(e.button === 0 && (space || hand))) {
      // 編輯：照片上按住不動一下，接著拖曳就是平移（點、把手、裁切框、分岔點自己要能拖，不算）
      if (e.button === 0 && !(e.target as Element).closest('.topo-handles, .topo-hits, .topo-fork, .topo-crop')) {
        clearTimeout(longTimer.current)
        longTimer.current = setTimeout(() => {
          if (holding?.()) return
          armed.current = true
          setLong(true)
        }, LONG_PRESS_MS)
      }
      return
    }
    e.preventDefault()
    e.stopPropagation()
    press.current = rel(e)
    startPanAt(e)
  }
  const movePan = (e: ReactPointerEvent) => {
    const finger = touches.current.get(e.pointerId)
    if (finger && touches.current.size >= 2) {
      const now = rel(e)
      const other = [...touches.current.entries()].find(([id]) => id !== e.pointerId)![1]
      touches.current.set(e.pointerId, now)
      const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
      const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      const ratio = dist(now, other) / (dist(finger, other) || 1)
      setView((v) => moveView(v, mid(finger, other), mid(now, other), ratio, stage, content, inset))
      return
    }
    if (finger) touches.current.set(e.pointerId, rel(e))
    if (press.current && !pan.current) {
      const far = Math.hypot(rel(e).x - press.current.x, rel(e).y - press.current.y) > DRAG_PX
      if (far && !armed.current) {
        // 長按之前就動了：普通的拖曳，取消長按；放開時也不當作點擊（不多出一個點）
        clearTimeout(longTimer.current)
        dragged.current = true
      }
      const fingerPan = e.pointerType === 'touch' && far && movable && !onHandle.current && !holding?.()
      if (viewing ? far && view.scale > 1 : armed.current || fingerPan) startPanAt(e)
    }
    const from = pan.current
    if (!from) return
    const to = rel(e)
    pan.current = to
    setView((v) => moveView(v, from, to, 1, stage, content, inset))
  }
  const endPan = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId)
    if (e.pointerType === 'touch' && !viewing && press.current && !dragged.current && !armed.current && touches.current.size === 0) {
      const p = rel(e)
      const prev = lastTap.current
      if (prev && e.timeStamp - prev.at < DOUBLE_TAP_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < DOUBLE_TAP_PX) {
        lastTap.current = null
        dragged.current = true
        doubleAt.current = performance.now()
        setGliding(true)
        setTimeout(() => setGliding(false), 350)
        setView(IDENTITY)
        onDoubleTap?.()
      } else lastTap.current = { at: e.timeStamp, p }
    }
    pan.current = null
    press.current = null
    clearTimeout(longTimer.current)
    if (armed.current) dragged.current = true
    armed.current = false
    setLong(false)
  }
  // 平移、拖曳之後放開，不要當作點了一下（多出一個點、選到路線）
  // 不靠計時：旗標留到下一次按下才清，click 多晚到都擋得住；沒有 click 也不會擋到之後的（鍵盤觸發的 click 不擋）
  const stopClick = (e: ReactMouseEvent) => {
    if (e.detail !== 0 && performance.now() - doubleAt.current < DOUBLE_TAP_QUIET_MS) {
      e.stopPropagation()
      e.preventDefault()
      return
    }
    if (!dragged.current || e.detail === 0) return
    dragged.current = false
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <div
      ref={box}
      className={`topo-zoom${gliding ? ' gliding' : ''}${space || hand || long ? ' panning' : ''}${viewing && view.scale > 1 ? ' draggable' : ''}${viewing ? '' : ' pinchable'}`}
      onPointerDownCapture={startPan}
      onClickCapture={stopClick}
      onPointerEnter={() => (hover.current = true)}
      onPointerLeave={() => (hover.current = false)}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div
        className="topo-zoom-inner"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, ...(aspect && { width: content.w, height: content.h }) }}
      >
        {children(view.scale)}
      </div>
      <div className="topo-zoom-controls">
        {!viewing && (
        <button type="button" className="topo-zoom-hand" aria-pressed={hand} aria-label={t('topo.zoomPan')} title={t('topo.zoomPan')} onClick={() => setHand(!hand)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
          </svg>
        </button>
        )}
        <button type="button" aria-label={t('topo.zoomOut')} title={t('topo.zoomOut')} onClick={() => zoomBy(1 / STEP)}>
          −
        </button>
        <button type="button" className="topo-zoom-fit" aria-label={t('topo.zoomFit')} title={t('topo.zoomFit')} onClick={() => setView(IDENTITY)}>
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" aria-label={t('topo.zoomIn')} title={t('topo.zoomIn')} onClick={() => zoomBy(STEP)}>
          +
        </button>
      </div>
    </div>
  )
}
