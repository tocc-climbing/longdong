import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { GradePill } from '../components/GradePill'
import type { Route } from '../data/schema'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { href, navigate } from '../router'
import { BoltToggle, useShowBolts } from './BoltToggle'
import { fillShared } from './shared'
import type { Crop, Marks } from '../core/topo/geometry'
import type { TopoPhoto } from './model'
import { ImageUrl } from '../core/topo/TopoView'
import { KitTopo, topoData } from './KitTopo'
import { routeInfo } from './routeInfo'

/**
 * 全螢幕 Topo：雙指縮放、拖曳平移；點路線只切換高亮，不離開全螢幕。
 * 左右滑換路線（照片沒有跟著橫移時：沒放大、或已經拖到邊）；點兩下放大，再點兩下回到整張。
 * 點擊（沒有拖曳）不鎖定指標，click 才會送到路線上；拖曳時才鎖定，放開後不會誤點。
 * 電腦版：滑鼠滾輪以游標為中心縮放、右下角的按鈕與 +／-／0；右邊是這張照片的路線清單（↑／↓ 切換），
 * 選到的路線在最下面顯示並可以開啟；手機版選到的路線顯示在照片下面。
 */
export function TopoFullscreen({
  photo,
  crop,
  marks: saved,
  labels,
  routes,
  initial,
  onClose,
  onEdit,
}: {
  photo: TopoPhoto
  crop?: Crop
  marks: Marks
  labels: Map<string, string>
  routes: Route[]
  initial?: string
  onClose: () => void
  /** 手機版：右上的「編輯」按鈕，在這一頁編輯這張照片 */
  onEdit?: () => void
}) {
  const { lang, t } = useLang()
  const wide = useWide()
  const marks = useMemo(() => fillShared(saved, routes), [saved, routes])
  const dialog = useRef<HTMLDialogElement>(null)
  const imageUrl = useContext(ImageUrl)!
  const [selected, setSelected] = useState(initial)
  const [showBolts] = useShowBolts()
  const hasBolts = Object.values(marks).some((m) => Object.keys(m.bolts ?? {}).length > 0)

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

  const route = routes.find((r) => r.id === selected)
  const annotations = useMemo(() => routeInfo(routes, (r) => localName(r.name, lang).main), [routes, lang])
  const data = useMemo(() => topoData(photo, imageUrl(photo.image), marks, crop, labels, annotations), [photo, imageUrl, marks, crop, labels, annotations])
  /** 這張照片上有標記的路線（依編號） */
  const listed = routes.filter((r) => marks[r.id]).sort((a, b) => Number(a.number ?? Infinity) - Number(b.number ?? Infinity))
  const step = (delta: number) => {
    const i = listed.findIndex((r) => r.id === selected)
    const next = listed[Math.min(listed.length - 1, Math.max(0, (i < 0 ? (delta > 0 ? -1 : listed.length) : i) + delta))]
    if (next) setSelected(next.id)
  }
  // ↑／↓ 換路線（縮放的 +／-／0 在 TopoKit）
  const latest = useRef(step)
  latest.current = step
  useEffect(() => {
    const el = dialog.current!
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      e.preventDefault()
      latest.current(e.key === 'ArrowUp' ? -1 : 1)
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
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
  ) : null

  return (
    <dialog ref={dialog} className={`topo-full${wide ? ' wide' : ''}`} onClose={onClose} aria-label={t('topo.title')}>
      <div className="topo-full-main">
        {!wide && (
          <>
            <button type="button" className="topo-full-close" aria-label={t('layout.close')} onClick={onClose}>
              ×
            </button>
            {hasBolts && <BoltToggle className="topo-bolt-toggle full" />}
            {onEdit && (
              <button type="button" className="topo-full-edit" aria-label={t('tools.edit')} title={t('tools.edit')} onClick={onEdit}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3" />
                </svg>
              </button>
            )}
          </>
        )}
        <KitTopo
          data={data}
          options={{ highlight: selected, bolts: showBolts, wheel: 'always', controls: wide, swipe: true, text: { zoomIn: t('topo.zoomIn'), zoomOut: t('topo.zoomOut'), zoomFit: t('topo.zoomFit') } }}
          onPick={setSelected}
          onSwipe={step}
          className="topo-full-stage"
        />
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
        </aside>
      )}
    </dialog>
  )
}
