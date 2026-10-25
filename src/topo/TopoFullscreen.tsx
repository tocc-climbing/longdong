import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GradePill } from '../components/GradePill'
import type { Route } from '../data/schema'
import { localName, useLang } from '../i18n'
import { href, navigate } from '../router'
import { FULL_CROP, type Crop, type Marks, type TopoPhoto } from './model'
import { fitSize, IDENTITY, moveView, type Pt, type Size, type View } from './viewport'
import { px, TopoFrame, TopoLines } from './TopoView'

/** 手指移動超過這個距離（螢幕像素）才算拖曳，之前都當作點擊 */
const DRAG_PX = 8

/**
 * 全螢幕 Topo：雙指縮放、拖曳平移；點路線只切換高亮並在下方顯示名稱與難度，不離開全螢幕。
 * 點擊（沒有拖曳）不鎖定指標，click 才會送到路線上；拖曳時才鎖定，放開後不會誤點。
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
  const dialog = useRef<HTMLDialogElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [view, setView] = useState<View>(IDENTITY)
  const [selected, setSelected] = useState(initial)
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

  return (
    <dialog ref={dialog} className="topo-full" onClose={onClose} aria-label={t('topo.title')}>
      <button type="button" className="topo-full-close" aria-label={t('layout.close')} onClick={onClose}>
        ×
      </button>
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
              {(k) => <TopoLines photo={photo} marks={marks} labels={labels} k={k / view.scale} highlight={selected} onPick={setSelected} crop={crop} />}
            </TopoFrame>
          </div>
        )}
      </div>
      <div className="topo-full-info">
        {route ? (
          <>
            <span className="topo-route-no">{route.number ?? '·'}</span>
            <span className="topo-full-name">{localName(route.name, lang).main}</span>
            <GradePill grade={route.grade} value={route.gradeValue} size="sm" />
            <button
              type="button"
              className="action primary"
              onClick={() => {
                onClose()
                navigate(href.route(route.id))
              }}
            >
              {t('topo.openRoute')}
            </button>
          </>
        ) : (
          <span className="muted">{t('topo.pickHint')}</span>
        )}
      </div>
    </dialog>
  )
}
