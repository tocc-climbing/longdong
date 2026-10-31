import { SectorShape } from '../components/AreaShape'
import { BoltTable } from '../components/BoltTable'
import { GradePill } from '../components/GradePill'
import { PageHero } from '../components/PageHero'
import { PersonalPanel } from '../components/PersonalPanel'
import { ReviewsBar, type ReviewsSheet } from '../components/ReviewsSection'
import { SafetyLight } from '../components/SafetyLight'
import { TitleTools } from '../components/TitleTools'
import type { LoadedData } from '../data/dataset'
import type { Route } from '../data/schema'
import { useInlineEditing } from '../edit/backGuard'
import { CommunityText } from '../edit/CommunityText'
import type { ToolScope } from '../edit/PageTools'
import { textTarget } from '../edit/textEdits'
import { formatDate, quickdraws, typeLabel } from '../format'
import { localName, useLang, type Lang, type Translate } from '../i18n'
import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from 'react'
import { useWide } from '../layout'
import { useCloud } from '../personal/sync'
import { href, useRouteLink } from '../router'
import { currentRouteUrl, shareText } from '../share'
import { RouteTopos } from '../topo/TopoSection'
import { areaSectorColor, NotFound } from './AreaPage'

// 編輯器只有要編輯時才載入
const InlineTopoEditor = lazy(() => import('../topo/TopoEditor').then((m) => ({ default: m.InlineTopoEditor })))

/**
 * 路線頁（手機版與電腦版的右側相同）：整頁是一張路線卡片。上方是標題卡（與區域、分區頁相同；右上是收藏、回報位置、更多），
 * 名稱下面是難度、長度、快扣、種類；接著是安全與狀態合併的一個色塊、Topo、說明（直接顯示內容）、路線資料（安全與拉測、首攀、
 * Bolt 的摘要，明細點了才展開）；最後是評價與留言（預設收起，只看到摘要與最新一則）。
 * 手機版點說明在卡片裡編輯，點 Topo 開全螢幕、按裡面的「編輯」才打開整個畫面的 Topo 編輯器（都不換頁；「更多」選單的編輯也一樣）；左右滑動換到上一張、下一張卡片。
 */
/**
 * topoInList：電腦版左邊的分區清單已經顯示這個分區的 Topo（選到的路線在上面亮色、可以切換 bolt），這裡不再重複顯示同一張。
 */
export function RoutePage({ data, id, topoInList }: { data: LoadedData; id: string; topoInList?: boolean }) {
  const ref = data.routeById.get(id)
  const { lang, t } = useLang()
  const { link } = useRouteLink()
  const cloudStatus = useCloud().status
  const signedIn = cloudStatus === 'signed-in'
  const [tickOpen, setTickOpen] = useState(false)
  const [reviews, setReviews] = useState<ReviewsSheet>()
  const [editing, setEditing] = useInlineEditing(id)
  const wide = useWide()
  if (!ref) return <NotFound />
  const { route, sector, area } = ref
  const name = localName(route.name, lang)
  const pitches = route.pitch ? sector.routes.filter((r) => r.pitch && baseName(r.name.zh) === baseName(route.name.zh)) : []
  const qd = quickdraws(route)
  const scope: ToolScope = { areaId: area.id, text: { target: textTarget.route(route.id), label: t('edit.routeText'), original: route.description }, sectors: [sector], topoEdit: true }

  return (
    <article className="route route-m" style={{ '--area-color': areaSectorColor(area, sector) } as CSSProperties}>
      <PageHero
        crumbs={[
          { label: localName(data.dataset.crag.name, lang).main, href: href.home() },
          { label: localName(area.name, lang).main, href: href.area(area.id) },
          ...(area.sectors.length > 1 ? [{ label: localName(sector.name, lang).main, href: href.sector(sector.id) }] : []),
        ]}
        color={areaSectorColor(area, sector)}
        name={name.main}
        sub={[route.number && `#${route.number}`, name.sub].filter(Boolean).join(' · ')}
        facts={
          <p className="route-facts">
            {route.grade && <span className="route-grade">{route.grade}</span>}
            {route.heightM && <span>{route.heightM} m</span>}
            {qd && <span>{t('type.quickdraws', { n: qd })}</span>}
            {(route.type || route.isFixture) && <span>{route.isFixture ? t('type.fixture') : typeLabel(route.type!, t)}</span>}
          </p>
        }
        tools={
          <TitleTools
            data={data}
            favoriteId={route.isFixture ? undefined : route.id}
            report={{ area, sector, route }}
            share={{ url: currentRouteUrl(route.id), text: shareText(ref, lang, t) }}
            signedIn={signedIn}
            scope={scope}
            onTick={route.isFixture ? undefined : () => setTickOpen(true)}
            inlineEdit={wide ? undefined : { text: () => setEditing({ kind: 'text' }), topo: () => setEditing({ kind: 'topo' }) }}
          />
        }
        shape={<SectorShape area={area} sector={sector} color={areaSectorColor(area, sector)} single className="area-hero-shape" />}
        badge={!route.isFixture && <RouteStatus route={route} />}
        compact
      />

      {signedIn && !route.isFixture && <PersonalPanel route={route} open={tickOpen} onClose={() => setTickOpen(false)} />}

      {!topoInList && <RouteTopos sector={sector} routeId={route.id} onEdit={wide ? undefined : (photo) => setEditing({ kind: 'topo', photo })} />}

      <CommunityText
        target={textTarget.route(route.id)}
        original={route.description}
        editing={editing?.kind === 'text'}
        onEdit={wide ? undefined : (on) => setEditing(on ? { kind: 'text' } : undefined)}
        owner={route.id}
      />

      {!wide && editing?.kind === 'topo' && (
        <Suspense>
          <InlineTopoEditor data={data} sector={sector} routeId={route.id} photo={editing.photo} owner={route.id} onClose={() => setEditing(undefined)} />
        </Suspense>
      )}


      {pitches.length > 1 && (
        <section className="route-block">
          <h2>{t('route.pitches')}</h2>
          <ul className="route-list">
            {pitches.map((p) => (
              <li key={p.id}>
                <a className={`pitch-row${p.id === route.id ? ' current' : ''}`} href={link(p.id)}>
                  <span className="pitch-no">P{p.pitch}</span>
                  <span className="route-name">
                    <span className="zh">{localName(p.name, lang).main}</span>
                    {p.heightM && <span className="en">{p.heightM} m</span>}
                  </span>
                  <span className="grade-line">
                    <SafetyLight safety={p.safety} />
                    <GradePill grade={p.grade} value={p.gradeValue} size="sm" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div id="rating" className="route-block">
        <ReviewsBar routeId={route.id} rateable={!route.isFixture} sheet={reviews} onSheet={setReviews} info={hasRouteData(route) ? <RouteData data={data} route={route} /> : undefined} />
      </div>
    </article>
  )
}

type Level = 'ok' | 'warn' | 'danger' | 'unknown'

/** 安全等級：待移除、封閉一律為危險 */
function safetyLevel(route: Route): Level {
  const closed = route.status === 'closed' || route.status === 'to-remove'
  return closed || route.safety === 'red' ? 'danger' : route.safety === 'yellow' ? 'warn' : route.safety === 'green' ? 'ok' : 'unknown'
}

/**
 * 標題卡的地圖上只在安全不是綠燈（小心、危險、封閉、待移除）時疊一個警告標示（不佔版面）；
 * 正常、尚未評級的不顯示；狀態的日期、拉測等資訊在路線資料（RouteData）。
 */
function RouteStatus({ route }: { route: Route }) {
  const { lang, t } = useLang()
  const level = safetyLevel(route)
  if (level === 'ok' || level === 'unknown') return null
  const safety = t(level === 'danger' ? 'safety.red' : 'safety.yellow')
  const status = route.status && (lang === 'zh' ? route.statusLabel : t(`status.${route.status}`))
  return (
    <div className={`route-status ${level}`} role={level === 'danger' ? 'alert' : undefined}>
      <span className="route-status-icon" aria-hidden>
        !
      </span>
      <strong>{[safety, status].filter(Boolean).join(' · ')}</strong>
    </div>
  )
}

type Rows = [string, ReactNode][]

/** 安全與拉測、首攀 */
function infoRows(route: Route, lang: Lang, t: Translate): Rows {
  const level = safetyLevel(route)
  const safety = t(level === 'danger' ? 'safety.red' : route.safety ? `safety.${route.safety}` : 'safety.unrated')
  const status = route.status && (lang === 'zh' ? route.statusLabel : t(`status.${route.status}`))
  const rows: Rows = []
  if (!route.isFixture)
    rows.push([
      t('route.safetyTests'),
      <>
        {[safety, status, route.statusDate && formatDate(route.statusDate)].filter(Boolean).join(' · ')}
        <span className="muted">
          {' '}
          · {t('route.lastTested')} {route.lastTested ? formatDate(route.lastTested) : t('route.noRecord')}
        </span>
      </>,
    ])
  if (route.firstAscent)
    rows.push([
      t('route.firstAscent'),
      <>
        {route.firstAscent}
        {route.firstAscentDate && <span className="muted"> · {formatDate(route.firstAscentDate)}</span>}
        {route.firstAscentDateLabel && <span className="muted"> · {route.firstAscentDateLabel}</span>}
      </>,
    ])
  return rows
}

/** 一行一項：左邊是項目、右邊是內容 */
function DataRows({ rows }: { rows: Rows }) {
  return rows.map(([label, value]) => (
    <div key={label} className="route-data-row">
      <span className="route-data-label">{label}</span>
      <span>{value}</span>
    </div>
  ))
}

/** 有沒有說明以外的路線資料（沒有時不顯示 ⓘ） */
function hasRouteData(route: Route): boolean {
  return !route.isFixture || !!route.firstAscent || !!route.notes || route.bolts.length + route.anchors.length > 0
}

/**
 * 說明以外的路線資料（安全與拉測、首攀、備註、Bolt）：評價與留言旁邊的 ⓘ，點了從下方滑出；
 * 一行一項，左邊是項目、右邊是內容。Bolt 只列摘要（幾支 bolt、幾個 anchor、材質、安裝年），
 * 明細（每一支的位置、材質、安裝、拉測）點了才在下面展開、滿寬。
 */
function RouteData({ data, route }: { data: LoadedData; route: Route }) {
  const { lang, t } = useLang()
  const fixings = [...route.bolts, ...route.anchors]
  const materials = [...new Set(fixings.map((b) => b.material).filter(Boolean))]
  const years = fixings.map((b) => b.installed?.slice(0, 4)).filter(Boolean).sort() as string[]
  const installed = years.length ? (years[0] === years.at(-1) ? years[0] : `${years[0]}–${years.at(-1)}`) : undefined
  const counts = [route.bolts.length > 0 && t('route.bolts', { n: route.bolts.length }), route.anchors.length > 0 && t('route.anchors', { n: route.anchors.length })]
  const rows = infoRows(route, lang, t)
  if (route.notes) rows.push([t('route.notes'), <span className="pre">{route.notes}</span>])
  return (
    <div className="route-data">
      <DataRows rows={rows} />
      {fixings.length > 0 && (
        <details className="route-bolts">
          <summary className="route-data-row">
            <span className="route-data-label">Bolt</span>
            <span>{[...counts, materials.join('、'), installed].filter(Boolean).join(' · ')}</span>
          </summary>
          <BoltTable title="Bolt / Anchor" bolts={fixings} data={data}>
            {route.anchorHardware.length > 0 && (
              <ul className="plain small">
                {route.anchorHardware.map((h, i) => (
                  <li key={i}>
                    {h.item}
                    {h.quantity && ` ×${h.quantity}`}
                    {h.spec && <span className="muted"> {h.spec}</span>}
                    {h.installed && <span className="muted"> · {t('route.installedOn', { date: formatDate(h.installed) })}</span>}
                  </li>
                ))}
              </ul>
            )}
          </BoltTable>
        </details>
      )}
    </div>
  )
}

/** 「自由裂隙 | P2 右」→「自由裂隙」，用來找出同一條多繩距路線的各段 */
function baseName(zh: string): string {
  return zh.replace(/\s*\|\s*P\d+.*$/i, '').trim()
}
