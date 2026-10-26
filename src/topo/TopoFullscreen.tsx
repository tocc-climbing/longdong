import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GradePill } from '../components/GradePill'
import type { Route } from '../data/schema'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { href, navigate } from '../router'
import { BoltToggle, useShowBolts } from './BoltToggle'
import { FULL_CROP, type Crop, type Marks, type TopoPhoto } from './model'
import { fitSize, IDENTITY, moveView, type Pt, type Size, type View } from './viewport'
import { px, TopoFrame, TopoLines } from './TopoView'

/** 手指移動超過這個距離（螢幕像素）才算拖曳，之前都當作點擊 */
const DRAG_PX = 8

/** 一次按 ＋／－ 或鍵盤 +／- 的縮放倍率 */
const STEP = 1.5

/**
 * 全螢幕 Topo：雙指縮放、拖曳平移；點路線只切換高亮，不離開全螢幕。
 * 點擊（沒有拖曳）不鎖定指標，click 才會送到路線上；拖曳時才鎖定，放開後不會誤點。
 * 電腦版：滑鼠滾輪以游標為中心縮放、右下角的按鈕與 +／-／0；右邊是這張照片的路線清單（↑／↓ 切換），
 * 選到的路線在最下面顯示並可以開啟；手機版選到的路線顯示在照片下面。
 */
export function TopoFullscreen({
  photo,
  crop,
  marks,
  labels,
  routes,
  initial,
  onClose,
}: {
  photo: TopoPhoto
  crop?: Crop
  marks: Marks
  labels: Map<string, string>
  routes: Route[]
  initial?: string
  onClose: () => void
}) {
  const { lang, t } = useLang()
  const wide = useWide()
  const dialog = useRef<HTMLDialogElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [view, setView] = useState<View>(IDENTITY)
  const [selected, setSelected] = useState(initial)
  const [showBolts] = useShowBolts()
  const hasBolts = Object.values(marks).some((m) => Object.keys(m.bolts ?? {}).length > 0)
  const pointers = useRef(new Map<number, Pt>())
  const moved = useRef(0)

  useEffect(() => {
    const el = dialog.current!
    el.showModal()
    // 觸控不往上傳：App 的左右滑動（swipe.ts）掛在外層，全螢幕裡的拖曳與縮放不能換頁
    const stop = (e: Event) => e.stopPropagation()
    const events = ['touchstart', 'touchmove', 'touchend', 'touchcancel']
    for (const name of events) el.addEventListener(name, stop)
    return () => {
      for (const name of events) el.removeEventListener(name, stop)
    }
  }, [])
  useLayoutEffect(() => {
    const el = stageRef.current!
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const c = crop ?? FULL_CROP
  const [cw, ch] = px(photo, [c.w, c.h])
  const content = fitSize(stage, cw / ch)
  const route = routes.find((r) => r.id === selected)
  /** 這張照片上有標記的路線（依編號） */
  const listed = routes.filter((r) => marks[r.id]).sort((a, b) => Number(a.number ?? Infinity) - Number(b.number ?? Infinity))

  const rel = (e: ReactPointerEvent): Pt => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
  }
  const down = (e: ReactPointerEvent) => {
    if (pointers.current.size === 0) moved.current = 0
    pointers.current.set(e.pointerId, rel(e))
  }
  const move = (e: ReactPointerEvent) => {
    const before = pointers.current.get(e.pointerId)
    if (!before) return
    const now = rel(e)
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p)
    pointers.current.set(e.pointerId, now)
    moved.current = Math.max(moved.current, Math.hypot(now.x - before.x, now.y - before.y))
    const pinching = others.length > 0
    if (!pinching && moved.current < DRAG_PX) return
    stageRef.current!.setPointerCapture(e.pointerId)
    if (pinching) {
      const o = others[0]
      const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
      const ratio = dist(now, o) / (dist(before, o) || 1)
      const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      setView((v) => moveView(v, mid(before, o), mid(now, o), ratio, stage, content))
    } else {
      setView((v) => moveView(v, before, now, 1, stage, content))
    }
  }
  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
  }
  const zoomBy = (ratio: number, at: Pt = { x: 0, y: 0 }) => setView((v) => moveView(v, at, at, ratio, stage, content))
  // 事件處理只註冊一次，從這裡讀最新的狀態
  const latest = useRef({ zoomBy, step: (_: number) => {} })
  latest.current = {
    zoomBy,
    step: (delta: number) => {
      const i = listed.findIndex((r) => r.id === selected)
      const next = listed[Math.min(listed.length - 1, Math.max(0, (i < 0 ? (delta > 0 ? -1 : listed.length) : i) + delta))]
      if (next) setSelected(next.id)
    },
  }
  // 滾輪縮放（要能 preventDefault，所以不用 React 的 onWheel）；+／-／0 縮放、↑／↓ 換路線
  useEffect(() => {
    const stageEl = stageRef.current!
    const dialogEl = dialog.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = stageEl.getBoundingClientRect()
      latest.current.zoomBy(Math.exp((-e.deltaY * (e.deltaMode === 1 ? 16 : 1)) / 500), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') latest.current.zoomBy(STEP)
      else if (e.key === '-') latest.current.zoomBy(1 / STEP)
      else if (e.key === '0') setView(IDENTITY)
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        latest.current.step(e.key === 'ArrowUp' ? -1 : 1)
      }
    }
    stageEl.addEventListener('wheel', onWheel, { passive: false })
    dialogEl.addEventListener('keydown', onKey)
    return () => {
      stageEl.removeEventListener('wheel', onWheel)
      dialogEl.removeEventListener('keydown', onKey)
    }
  }, [])
  // 選到的路線在清單裡看得到
  useEffect(() => {
    dialog.current?.querySelector('.topo-full-row.on')?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const openRoute = () => {
    if (!route) return
    onClose()
    navigate(href.route(route.id))
  }
  const info = route ? (
    <>
      <span className="topo-route-no">{route.number ?? '·'}</span>
      <span className="topo-full-name">{localName(route.name, lang).main}</span>
      <GradePill grade={route.grade} value={route.gradeValue} size="sm" />
      <button type="button" className="action primary" onClick={openRoute}>
        {t('topo.openRoute')}
      </button>
    </>
  ) : (
    <span className="muted">{t('topo.pickHint')}</span>
  )

  return (
    <dialog ref={dialog} className={`topo-full${wide ? ' wide' : ''}`} onClose={onClose} aria-label={t('topo.title')}>
      <div className="topo-full-main">
        {!wide && (
          <>
            <button type="button" className="topo-full-close" aria-label={t('layout.close')} onClick={onClose}>
              ×
            </button>
            {hasBolts && <BoltToggle className="topo-bolt-toggle full" />}
          </>
        )}
        <div ref={stageRef} className="topo-full-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {stage.w > 0 && (
            <div
              className="topo-full-content"
              style={{
                width: content.w,
                height: content.h,
                left: (stage.w - content.w) / 2,
                top: (stage.h - content.h) / 2,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
            >
              <TopoFrame photo={photo} crop={crop} alt="">
                {(k) => (
                  <TopoLines
                    photo={photo}
                    marks={marks}
                    labels={labels}
                    k={k / view.scale}
                    highlight={selected}
                    bolts={showBolts ? (selected ? [selected] : Object.keys(marks)) : []}
                    onPick={setSelected}
                    crop={crop}
                  />
                )}
              </TopoFrame>
            </div>
          )}
          {wide && (
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
          )}
        </div>
        {!wide && <div className="topo-full-info">{info}</div>}
      </div>
      {wide && (
        <aside className="topo-full-side">
          <header>
            <h2>{t('topo.fullRoutes', { n: listed.length })}</h2>
            {hasBolts && <BoltToggle className="topo-bolt-toggle inline" />}
            <button type="button" className="topo-full-close inline" aria-label={t('layout.close')} onClick={onClose}>
              ×
            </button>
          </header>
          <ul className="topo-full-routes">
            {listed.map((r) => (
              <li key={r.id}>
                <button type="button" className={`topo-full-row${r.id === selected ? ' on' : ''}`} onClick={() => setSelected(r.id)}>
                  <span className="topo-route-no">{r.number ?? '·'}</span>
                  <span className="topo-route-name">{localName(r.name, lang).main}</span>
                  <GradePill grade={r.grade} value={r.gradeValue} size="sm" />
                </button>
              </li>
            ))}
          </ul>
          <div className="topo-full-info side">{info}</div>
          <p className="topo-full-keys muted small">{t('topo.fullKeys')}</p>
        </aside>
      )}
    </dialog>
  )
}
