import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useLang } from '../i18n'
import { clampView, IDENTITY, moveView, type Pt, type Size, type View } from './viewport'

/** 一次按 ＋／－ 或鍵盤 +／- 的縮放倍率 */
const STEP = 1.5
/** 觀看用：滑鼠移動超過這個距離（螢幕像素）才算拖曳，之前都當作點擊 */
const DRAG_PX = 5

/**
 * 編輯用的縮放區（電腦版）：滾輪或 +／- 縮放（以游標位置為中心）、0 回到整張；
 * 放大後按住空白鍵拖曳（或按滑鼠中鍵拖曳）平移；沒有中鍵的觸控板用右下角的「移動」按鈕，開啟後左鍵拖曳就是平移。
 * 左鍵平常留給標記，所以平移要另外的操作。
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
  /** 觀看用：左鍵按下的位置；移動超過 DRAG_PX 才開始平移，之後放開時擋掉那一次點擊 */
  const press = useRef<Pt | null>(null)
  const dragged = useRef(false)

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

  // 平移：在捕獲階段攔下，照片上的點、把手收不到這次按下；指標鎖在這個區域，放開後也不會觸發點擊加點
  const startPan = (e: ReactPointerEvent) => {
    // 控制按鈕自己要能按（包括關掉「移動」）
    if ((e.target as Element).closest('.topo-zoom-controls')) return
    if (viewing && e.button === 0) {
      press.current = rel(e)
      dragged.current = false
      return
    }
    if (e.button !== 1 && !(e.button === 0 && (space || hand))) return
    e.preventDefault()
    e.stopPropagation()
    box.current!.setPointerCapture(e.pointerId)
    pan.current = rel(e)
  }
  const movePan = (e: ReactPointerEvent) => {
    if (viewing && !pan.current && press.current && view.scale > 1 && Math.hypot(rel(e).x - press.current.x, rel(e).y - press.current.y) > DRAG_PX) {
      box.current!.setPointerCapture(e.pointerId)
      pan.current = press.current
      dragged.current = true
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
  }
  // 拖曳平移後放開，不要當作點了照片上的路線
  const stopClick = (e: ReactMouseEvent) => {
    if (!dragged.current) return
    dragged.current = false
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <div
      ref={box}
      className={`topo-zoom${space || hand ? ' panning' : ''}${viewing && view.scale > 1 ? ' draggable' : ''}`}
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
