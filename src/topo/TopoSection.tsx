import { useState, type ReactNode } from 'react'
import type { Sector } from '../data/schema'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { useCloud } from '../personal/sync'
import { useRouteLink } from '../router'
import { useSectorTopos, type SectorTopo } from './store'
import { BoltToggle, useShowBolts } from './BoltToggle'
import { TopoFullscreen } from './TopoFullscreen'
import { TopoFrame, TopoLines } from './TopoView'
import { UploadButton } from './TopoUpload'
import { ZoomPane } from './ZoomPane'

/** 路線 ID → 照片上顯示的編號（沒有編號的固定點等不顯示） */
export function routeLabels(sector: Sector): Map<string, string> {
  return new Map(sector.routes.filter((r) => r.number).map((r) => [r.id, r.number!]))
}

/** 電腦版、登入後才能上傳與編輯 */
function useCanEdit(): boolean {
  const wide = useWide()
  return useCloud().status === 'signed-in' && wide
}

/**
 * 一張 Topo 的照片與線：電腦版可以縮放、拖曳平移（Ctrl＋滾輪、右下角的按鈕、+／-／0），手機用全螢幕（雙指縮放）。
 * render 收到「一個螢幕像素等於幾個照片像素」，線與編號依此維持相同的螢幕大小。
 */
function Photo({ topo, alt, render }: { topo: SectorTopo; alt: string; render: (k: number) => ReactNode }) {
  const wide = useWide()
  const frame = (zoom: number) => (
    <TopoFrame photo={topo.photo} crop={topo.latest?.crop} alt={alt}>
      {(k) => render(k / zoom)}
    </TopoFrame>
  )
  return wide ? <ZoomPane viewing>{frame}</ZoomPane> : frame(1)
}

/** 分區頁：這個分區的所有 Topo，點線段換到那條路線；電腦版登入後可以新增照片、編輯 */
export function SectorTopos({ sector }: { sector: Sector }) {
  const { lang, t } = useLang()
  const topos = useSectorTopos(sector.id)
  const canEdit = useCanEdit()
  const { link, selected } = useRouteLink()
  const [showBolts] = useShowBolts()
  if (!topos || (topos.length === 0 && !canEdit)) return null
  const labels = routeLabels(sector)
  return (
    <section className="topos" aria-label={t('topo.title')}>
      {topos.map((topo) => (
        <figure key={topo.photo.id} className="topo">
          <Photo
            topo={topo}
            alt={t('topo.alt', { name: localName(sector.name, lang).main })}
            render={(k) =>
              topo.latest && (
                <TopoLines
                  photo={topo.photo}
                  marks={topo.latest.marks}
                  labels={labels}
                  k={k}
                  highlight={selected}
                  bolts={showBolts ? (selected ? [selected] : Object.keys(topo.latest.marks)) : []}
                  link={link}
                  crop={topo.latest.crop}
                />
              )
            }
          />
          {topo.latest && <FullscreenButton topo={topo} sector={sector} initial={selected} />}
        </figure>
      ))}
      {canEdit && <UploadButton sector={sector.id} />}
    </section>
  )
}

/** 路線頁：有標記這條路線的 Topo，這條用亮色並標出 bolt */
export function RouteTopos({ sector, routeId }: { sector: Sector; routeId: string }) {
  const { lang, t } = useLang()
  const topos = useSectorTopos(sector.id)?.filter((x) => x.latest?.marks[routeId])
  const [showBolts] = useShowBolts()
  if (!topos || topos.length === 0) return null
  const labels = routeLabels(sector)
  return (
    <section className="route-block topos">
      <h2>{t('topo.title')}</h2>
      {topos.map((topo) => (
        <figure key={topo.photo.id} className="topo">
          <Photo
            topo={topo}
            alt={t('topo.alt', { name: localName(sector.name, lang).main })}
            render={(k) => <TopoLines photo={topo.photo} marks={topo.latest!.marks} labels={labels} k={k} highlight={routeId} bolts={showBolts ? [routeId] : []} crop={topo.latest!.crop} />}
          />
          <FullscreenButton topo={topo} sector={sector} initial={routeId} />
        </figure>
      ))}
    </section>
  )
}

/** 照片右上角的全螢幕按鈕（左邊是顯示／隱藏 bolt 的按鈕）；全螢幕裡點路線只切換高亮，不離開 */
function FullscreenButton({ topo, sector, initial }: { topo: SectorTopo; sector: Sector; initial?: string }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* bolt 只在有標記的照片上有意義 */}
      {Object.values(topo.latest!.marks).some((m) => Object.keys(m.bolts ?? {}).length > 0) && <BoltToggle />}
      <button type="button" className="topo-full-open" aria-label={t('topo.fullscreen')} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
      {open && (
        <TopoFullscreen
          photo={topo.photo}
          crop={topo.latest!.crop}
          marks={topo.latest!.marks}
          labels={routeLabels(sector)}
          routes={sector.routes}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
