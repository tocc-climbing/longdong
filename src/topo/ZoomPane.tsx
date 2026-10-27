import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useLang } from '../i18n'
import { clampView, IDENTITY, moveView, type Pt, type Size, type View } from './viewport'

/** 一次按 ＋／－ 或鍵盤 +／- 的縮放倍率 */
const STEP = 1.5
/** 滑鼠移動超過這個距離（螢幕像素）才算拖曳，之前都當作點擊 */
const DRAG_PX = 5
/** 編輯用：在照片上按住不動超過這個時間（毫秒），接著拖曳就是平移 */
const LONG_PRESS_MS = 350
/** 平移結束後，放開滑鼠緊接著的那一次點擊要擋掉；過了這個時間還沒有點擊就不擋了（避免擋到之後真正的點擊） */
const CLICK_GUARD_MS = 80

/**
 * 編輯用的縮放區（電腦版）：滾輪或 +／- 縮放（以游標位置為中心）、0 回到整張；
 * 放大後平移有四種方式：照片上長按（按住不動一下）再拖曳、按住空白鍵拖曳、滑鼠中鍵拖曳、右下角的「移動」按鈕（開啟後左鍵拖曳就是平移）。
 * 左鍵平常留給標記；平移（或拖曳超過幾個像素）結束放開時，不會當作點了一下而多出一個點。
 * children 收到目前倍率，點、線、把手依此反向調整，放大後仍維持相同的螢幕大小；
 * 位置換算用 getBoundingClientRect，已經包含縮放與平移。
 * 觀看用（viewing）：照片上沒有要標記的東西，放大後直接按住左鍵拖曳平移（沒拖動就是點路線）；
 * 頁面要能捲動，所以滾輪要按住 Ctrl（⌘、觸控板的雙指縮放）才縮放，+／-／0 只在游標停在照片上時有效。
 */
export function ZoomPane({ children, viewing }: { children: (zoom: number) => ReactNode; viewing?: boolean }) {
  const { t } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [view, setView] = useState<View>(IDENTITY)
  const [space, setSpace] = useState(false)
  const [hand, setHand] = useState(false)
  const pan = useRef<Pt | null>(null)
  const hover = useRef(false)
  /** 左鍵按下的位置；移動超過 DRAG_PX 才算拖曳（觀看時開始平移），之後放開時擋掉那一次點擊 */
  const press = useRef<Pt | null>(null)
  const dragged = useRef(false)
  /** 編輯用：按住不動的計時；時間到之後（long）拖曳就是平移 */
  const longTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [long, setLong] = useState(false)
  const armed = useRef(false)

  useLayoutEffect(() => {
    const el = box.current!
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 照片的寬高比變了（裁切、視窗大小）：放大後的位置重新限制在照片範圍內
  useEffect(() => setView((v) => clampView(v, stage, stage)), [stage])

  useEffect(() => () => clearTimeout(longTimer.current), [])

  /** 滑鼠位置換成以舞台中心為原點的座標 */
  const rel = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
  }
  const zoomBy = (ratio: number, at: Pt = { x: 0, y: 0 }) => setView((v) => moveView(v, at, at, ratio, stage, stage))

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
    // 控制按鈕自己要能按（包括關掉「移動」）
    if ((e.target as Element).closest('.topo-zoom-controls')) return
    if (e.button === 0) {
      press.current = rel(e)
      dragged.current = false
    }
    if (viewing && e.button === 0) return
    if (e.button !== 1 && !(e.button === 0 && (space || hand))) {
      // 編輯：照片上按住不動一下，接著拖曳就是平移（點、把手、裁切框、分岔點自己要能拖，不算）
      if (e.button === 0 && !(e.target as Element).closest('.topo-handles, .topo-fork, .topo-crop')) {
        clearTimeout(longTimer.current)
        longTimer.current = setTimeout(() => {
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
    if (press.current && !pan.current) {
      const far = Math.hypot(rel(e).x - press.current.x, rel(e).y - press.current.y) > DRAG_PX
      if (far && !armed.current) {
        // 長按之前就動了：普通的拖曳，取消長按；放開時也不當作點擊（不多出一個點）
        clearTimeout(longTimer.current)
        dragged.current = true
      }
      if (viewing ? far && view.scale > 1 : armed.current) startPanAt(e)
    }
    const from = pan.current
    if (!from) return
    const to = rel(e)
    pan.current = to
    setView((v) => moveView(v, from, to, 1, stage, stage))
  }
  const endPan = () => {
    pan.current = null
    press.current = null
    clearTimeout(longTimer.current)
    if (armed.current) dragged.current = true
    armed.current = false
    setLong(false)
    // 放開之後緊接著會有一次 click：擋掉；之後沒有 click 的話不再擋
    if (dragged.current) setTimeout(() => (dragged.current = false), CLICK_GUARD_MS)
  }
  // 平移、拖曳之後放開，不要當作點了一下（多出一個點、選到路線）
  const stopClick = (e: ReactMouseEvent) => {
    if (!dragged.current) return
    dragged.current = false
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <div
      ref={box}
      className={`topo-zoom${space || hand || long ? ' panning' : ''}${viewing && view.scale > 1 ? ' draggable' : ''}`}
      onPointerDownCapture={startPan}
      onClickCapture={stopClick}
      onPointerEnter={() => (hover.current = true)}
      onPointerLeave={() => (hover.current = false)}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="topo-zoom-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
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
