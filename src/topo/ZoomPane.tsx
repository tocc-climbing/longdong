import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useLang } from '../i18n'
import { clampView, IDENTITY, moveView, type Pt, type Size, type View } from './viewport'

/** 一次按 ＋／－ 或鍵盤 +／- 的縮放倍率 */
const STEP = 1.5

/**
 * 編輯用的縮放區（電腦版）：滾輪或 +／- 縮放（以游標位置為中心）、0 回到整張；
 * 放大後按住空白鍵拖曳（或按滑鼠中鍵拖曳）平移。左鍵留給標記，所以平移要另外的操作。
 * children 收到目前倍率，點、線、把手依此反向調整，放大後仍維持相同的螢幕大小；
 * 位置換算用 getBoundingClientRect，已經包含縮放與平移。
 */
export function ZoomPane({ children }: { children: (zoom: number) => ReactNode }) {
  const { t } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [view, setView] = useState<View>(IDENTITY)
  const [space, setSpace] = useState(false)
  const pan = useRef<Pt | null>(null)
  const hover = useRef(false)

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
      if (e.key === '+' || e.key === '=') zoomBy(STEP)
      else if (e.key === '-') zoomBy(1 / STEP)
      else if (e.key === '0') setView(IDENTITY)
      // 空白鍵只在游標停在照片上時當作平移：游標在別處時留給按鈕、表單原本的用途
      else if (e.key === ' ' && hover.current) {
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
    if (e.button !== 1 && !(e.button === 0 && space)) return
    e.preventDefault()
    e.stopPropagation()
    box.current!.setPointerCapture(e.pointerId)
    pan.current = rel(e)
  }
  const movePan = (e: ReactPointerEvent) => {
    const from = pan.current
    if (!from) return
    const to = rel(e)
    pan.current = to
    setView((v) => moveView(v, from, to, 1, stage, stage))
  }
  const endPan = () => {
    pan.current = null
  }

  return (
    <div
      ref={box}
      className={`topo-zoom${space ? ' panning' : ''}`}
      onPointerDownCapture={startPan}
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
