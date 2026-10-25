import type { CSSProperties } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, LocalizedName, Route, Sector } from '../data/schema'
import { AreaShape } from '../components/AreaShape'
import { GradeDistribution } from '../components/Charts'
import { RescueButton } from '../components/RescueButton'
import { RouteList } from '../components/RouteList'
import { CommunityText } from '../edit/CommunityText'
import { textTarget } from '../edit/textEdits'
import { SectorTopos } from '../topo/TopoSection'
import { gradeDistribution, sectorColor, typeSummary } from '../format'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { href } from '../router'

/**
 * 區域頁：列出分區，點進去才看路線（只有一個分區時直接顯示路線）。
 * 上方是用區域顏色淡淡上色的標題卡：岩場名、名稱、路線數與救援按鈕，右側是這個區域的地圖形狀。
 * 電腦版畫面寬：標題區多放英文名、難度範圍、Bolt 數、路線種類、需要注意的路線數與整區的難度分佈；
 * 分區也多放英文名、難度範圍、種類與需要注意的路線數。
 */
export function AreaPage({ data, id }: { data: LoadedData; id: string }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const area = data.areaById.get(id)
  if (!area) return <NotFound />
  const routes = area.sectors.flatMap((s) => s.routes).filter((r) => !r.isFixture)
  const routeCount = routes.length
  const name = localName(area.name, lang)
  const range = gradeRange(routes)
  const sub = (
    <p className="muted small page-sub">
      {area.sectors.length > 1 && `${t('count.sectors', { n: area.sectors.length })} · `}
      {t('count.routes', { n: routeCount })}
    </p>
  )

  return (
    <>
      <div className="area-hero" style={{ '--area-color': area.color ?? 'var(--brand)' } as CSSProperties}>
        <div className="area-hero-text">
          <p className="area-hero-crag">{localName(data.dataset.crag.name, lang).main}</p>
          <h1>
            {name.main}
            {wide && name.sub && <span className="en">{name.sub}</span>}
          </h1>
          {sub}
          {wide && (
            <p className="area-hero-facts">
              {[range, area.summary?.bolts && t('count.bolts', { n: area.summary.bolts }), typeSummary(routes, t)].filter(Boolean).join(' · ')}
              <Alerts routes={routes} />
            </p>
          )}
          <RescueButton areaId={area.id} />
        </div>
        {wide && (
          <div className="area-hero-chart">
            <GradeDistribution bands={gradeDistribution(routes)} />
          </div>
        )}
        <AreaShape area={area} className="area-hero-shape" />
      </div>

      <CommunityText target={textTarget.area(area.id.slice(area.id.indexOf('/') + 1))} title={t('text.areaTitle')} />

      {area.sectors.length === 1 ? (
        <SectorRoutes data={data} sector={area.sectors[0]} />
      ) : (
        <ul className="area-list">
          {area.sectors.map((sector, i) => (
            <li key={sector.id}>
              <SectorCard sector={sector} color={sectorColor(area.color, i, area.sectors.length)} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function SectorCard({ sector, color }: { sector: Sector; color?: string }) {
  const { lang, t } = useLang()
  const routes = sector.routes.filter((r) => !r.isFixture)
  const range = gradeRange(routes)
  const name = localName(sector.name, lang)
  return (
    <a className="area-row" href={href.sector(sector.id)} style={{ '--area-color': color } as CSSProperties}>
      <span className="area-info">
        <span className="sector-name">{name.main}</span>
        {name.sub && <span className="en">{name.sub}</span>}
        <span className="area-count">
          {t('count.routesShort', { n: routes.length })}
          {/* 空白放在 nowrap 外面，寬度不夠時難度範圍換到下一行 */}
          {range && (
            <>
              {' '}
              <span className="muted nowrap">· {range}</span>
            </>
          )}
        </span>
        <span className="area-types">
          {typeSummary(routes, t)}
          <Alerts routes={routes} />
        </span>
      </span>
      <GradeDistribution bands={gradeDistribution(routes)} />
    </a>
  )
}

/** 需要注意的路線數：小心（黃燈）、危險（紅燈，含待移除、封閉）；都沒有時不顯示 */
function Alerts({ routes }: { routes: Route[] }) {
  const { t } = useLang()
  const danger = routes.filter((r) => r.safety === 'red' || r.status === 'closed' || r.status === 'to-remove').length
  const warn = routes.filter((r) => r.safety === 'yellow' && r.status !== 'closed' && r.status !== 'to-remove').length
  if (!danger && !warn) return null
  return (
    <span className="area-alerts">
      {warn > 0 && <span className="warn">● {t('safety.yellow')} {warn}</span>}
      {danger > 0 && <span className="danger">● {t('safety.red')} {danger}</span>}
    </span>
  )
}

/** 區域、分區頁的標題：識別色圓點＋依語言排列的名稱，右側是所在大區域的「救援」按鈕 */
function Title({ name, color, areaId }: { name: LocalizedName; color?: string; areaId: string }) {
  const { lang } = useLang()
  const n = localName(name, lang)
  return (
    <div className="page-title">
      <h1>
        {color && <span className="color-dot" style={{ background: color }} aria-hidden />}
        {n.main} {n.sub && <span className="en">{n.sub}</span>}
      </h1>
      <RescueButton areaId={areaId} />
    </div>
  )
}

export function areaSectorColor(area: Area, sector: Sector): string | undefined {
  return sectorColor(area.color, area.sectors.indexOf(sector), area.sectors.length)
}

/** 分區頁：Topo 與路線清單，可排序、篩選 */
export function SectorPage({ data, id }: { data: LoadedData; id: string }) {
  const { lang } = useLang()
  const found = data.sectorById.get(id)
  if (!found) return <NotFound />
  const { sector, area } = found
  return (
    <>
      <nav className="crumbs">
        <a href={href.area(area.id)}>{localName(area.name, lang).main}</a>
      </nav>
      <Title name={sector.name} color={areaSectorColor(area, sector)} areaId={area.id} />
      <SectorRoutes data={data} sector={sector} />
    </>
  )
}

function SectorRoutes({ data, sector }: { data: LoadedData; sector: Sector }) {
  return (
    <>
      <SectorTopos sector={sector} />
      <RouteList items={sector.routes.map((r) => data.routeById.get(r.id)!)} defaultLabel="list.sort.number" />
    </>
  )
}

/** 「5.7–5.12a」；只有一種難度時只顯示一個 */
function gradeRange(routes: Route[]): string | undefined {
  const graded = routes.filter((r) => r.grade && r.gradeValue !== undefined)
  if (graded.length === 0) return undefined
  const sorted = [...graded].sort((a, b) => a.gradeValue! - b.gradeValue!)
  const lo = sorted[0].grade!.replace(/\s.*$/, '')
  const hi = sorted[sorted.length - 1].grade!.replace(/\s.*$/, '')
  return lo === hi ? lo : `${lo}–${hi}`
}

export function NotFound() {
  const { t } = useLang()
  return (
    <div className="empty">
      <p>{t('app.notFound')}</p>
      <a href={href.home()}>{t('app.backHome')}</a>
    </div>
  )
}
