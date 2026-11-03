import { useContext, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { ViewerOptions } from '../../vendor/climbio-topokit/index.js'
import type { Sector } from '../data/schema'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { navigate, useRouteLink } from '../router'
import { fillShared } from './shared'
import { FULL_CROP, SCALE } from '../core/topo/geometry'
import { useSectorTopos, type SectorTopo } from './store'
import { BoltToggle, useShowBolts } from './BoltToggle'
import { TopoFullscreen } from './TopoFullscreen'
import { ImageUrl } from './imageUrl'
import { px } from '../core/topo/geometry'
import type { Crop, Marks, TopoImage } from '../core/topo/geometry'
import { routeInfo, type RouteInfo } from './routeInfo'
import { routeCrop, widenCrop } from '../core/topo/viewport'
import { KitTopo } from './KitTopo'
import { topoData } from './topoData'

/** 路線 ID → 照片上顯示的編號（沒有編號的固定點等不顯示） */
export function routeLabels(sector: Sector): Map<string, string> {
  return new Map(sector.routes.filter((r) => r.number).map((r) => [r.id, r.number!]))
}

/**
 * 一張 Topo 的照片與線（TopoKit）：電腦版可以縮放、拖曳平移（Ctrl＋滾輪、右下角的按鈕、+／-／0），手機用全螢幕（雙指縮放）。
 * 大小：寬度跟外層，高度依顯示範圍的寬高比。
 */
function Photo({ photo, marks, crop, labels, info, alt, options, onPick }: { photo: TopoImage; marks: Marks; crop?: Crop; labels: Map<string, string>; info: Map<string, RouteInfo>; alt: string; options: ViewerOptions; onPick?: (id: string) => void }) {
  const imageUrl = useContext(ImageUrl)!
  // 標記、裁切每次重畫都是新的物件（fillShared、routeCrop）；內容沒變就不重新 setData（縮放會回到整張）
  const same = JSON.stringify([marks, crop])
  const data = useMemo(() => topoData(photo, imageUrl(photo.image), marks, crop, labels, info), [photo, imageUrl, same, labels, info])
  const [cw, ch] = px(photo, [(crop ?? FULL_CROP).w, (crop ?? FULL_CROP).h])
  return <KitTopo data={data} options={options} onPick={onPick} className="topo-kit" style={{ aspectRatio: `${cw} / ${ch}` }} label={alt} />
}

/**
 * 分區頁：這個分區有標記路線的 Topo（還沒人標記的照片只在 Topo 編輯器出現）。電腦版點線段換到那條路線；
 * 手機版照片上沒有按鈕，點照片開全螢幕（onEdit：全螢幕裡的「編輯」在這一頁編輯那一張）。
 */
export function SectorTopos({ sector, onEdit }: { sector: Sector; onEdit?: (photo: string) => void }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const topos = useSectorTopos(sector.id)?.filter((x): x is Required<SectorTopo> => !!x.latest)
  const { link, selected } = useRouteLink()
  const [showBolts] = useShowBolts()
  const [open, setOpen] = useState<SectorTopo>()
  const labels = useMemo(() => routeLabels(sector), [sector])
  const info = useMemo(() => routeInfo(sector.routes, (r) => localName(r.name, lang).main), [sector, lang])
  if (!topos || topos.length === 0) return null
  return (
    <section className="topos" aria-label={t('topo.title')}>
      {topos.map((topo) => (
        <TopoFigure key={topo.photo.id} onOpen={wide ? undefined : () => setOpen(topo)} label={t('topo.fullscreen')}>
          <Photo
            photo={topo.photo}
            marks={fillShared(topo.latest.marks, sector.routes)}
            crop={topo.latest.crop}
            labels={labels}
            info={info}
            alt={t('topo.alt', { name: localName(sector.name, lang).main })}
            options={{ highlight: selected, bolts: showBolts, interactive: wide, zoom: wide, controls: wide }}
            onPick={(id) => navigate(link(id))}
          />
          {wide && <FullscreenButton topo={topo} sector={sector} initial={selected} />}
        </TopoFigure>
      ))}
      {open && <Fullscreen topo={open} sector={sector} initial={selected} onClose={() => setOpen(undefined)} onEdit={onEdit} />}
    </section>
  )
}

/**
 * 路線卡片照片四邊的淡出要落在看得到的那一塊：照片放大過，照片元素比畫面大，
 * 所以淡出的遮罩（styles.css 的 .route-topo）只蓋住裁切範圍——大小是裁切佔整張的比例，位置換成 mask-position 的百分比。
 */
function edgeFade(c: Crop): CSSProperties {
  const at = (start: number, size: number) => (size >= SCALE ? 0 : (start / (SCALE - size)) * 100)
  return { '--fade-size': `${(c.w / SCALE) * 100}% ${(c.h / SCALE) * 100}%`, '--fade-pos': `${at(c.x, c.w)}% ${at(c.y, c.h)}%` } as CSSProperties
}

/** 路線卡片的 Topo 固定的寬高比（同 styles.css 的 .route-topo）；照片不夠寬時兩邊是卡片底色（narrow） */
const ROUTE_TOPO_ASPECT = 4 / 5

/**
 * 路線頁：有標記這條路線的 Topo（直接放在卡片裡，沒有標題、沒有按鈕），這條路線是唯一的主角：
 * 照片放大到這條路線附近、灰階，只有這條路線周圍是原色；其他路線淡淡的、不標編號。
 * 點照片開全螢幕；手機版（onEdit）全螢幕裡的「編輯」在這一頁編輯這張照片；沒有 Topo 時整段不顯示。
 */
export function RouteTopos({ sector, routeId, onEdit }: { sector: Sector; routeId: string; onEdit?: (photo: string) => void }) {
  const { lang, t } = useLang()
  const topos = useSectorTopos(sector.id)?.filter((x) => x.latest?.marks[routeId])
  const [showBolts] = useShowBolts()
  const [open, setOpen] = useState<SectorTopo>()
  const labels = useMemo(() => routeLabels(sector), [sector])
  const info = useMemo(() => routeInfo(sector.routes, (r) => localName(r.name, lang).main), [sector, lang])
  if (!topos || topos.length === 0) return null
  return (
    <section className="route-block topos" aria-label={t('topo.title')}>
      {topos.map((topo) => {
        const marks = fillShared(topo.latest!.marks, sector.routes)
        const base = topo.latest!.crop ?? FULL_CROP
        const crop = widenCrop(topo.photo, routeCrop(topo.photo, base, marks[routeId]), base, ROUTE_TOPO_ASPECT)
        const [cw, ch] = px(topo.photo, [crop.w, crop.h])
        return (
          <TopoFigure key={topo.photo.id} className={`topo route-topo${cw / ch < ROUTE_TOPO_ASPECT ? ' narrow' : ''}`} style={edgeFade(crop)} onOpen={() => setOpen(topo)} label={t('topo.fullscreen')}>
            <Photo
              photo={topo.photo}
              marks={marks}
              crop={crop}
              labels={labels}
              info={info}
              alt={t('topo.alt', { name: localName(sector.name, lang).main })}
              options={{ highlight: routeId, bolts: showBolts ? [routeId] : [], solo: true, reveal: true, interactive: false, zoom: false, controls: false }}
            />
          </TopoFigure>
        )
      })}
      {open && <Fullscreen topo={open} sector={sector} initial={routeId} onClose={() => setOpen(undefined)} onEdit={onEdit} />}
    </section>
  )
}

/** 全螢幕看一張 Topo；onEdit：關掉全螢幕、在這一頁編輯這張照片 */
function Fullscreen({ topo, sector, initial, onClose, onEdit }: { topo: SectorTopo; sector: Sector; initial?: string; onClose: () => void; onEdit?: (photo: string) => void }) {
  return (
    <TopoFullscreen
      photo={topo.photo}
      crop={topo.latest!.crop}
      marks={topo.latest!.marks}
      labels={routeLabels(sector)}
      routes={sector.routes}
      initial={initial}
      onClose={onClose}
      onEdit={
        onEdit &&
        (() => {
          onClose()
          onEdit(topo.photo.id)
        })
      }
    />
  )
}

/** 一張 Topo；onOpen 有值時整張是按鈕（點了開全螢幕） */
function TopoFigure({ onOpen, label, className = 'topo', style, children }: { onOpen?: () => void; label?: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <figure
      className={`${className}${onOpen ? ' openable' : ''}`}
      style={style}
      {...(onOpen && {
        role: 'button',
        tabIndex: 0,
        'aria-label': label,
        onClick: onOpen,
        onKeyDown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen()),
      })}
    >
      {children}
    </figure>
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
