import { SectorShape } from '../components/AreaShape'
import { BoltTable } from '../components/BoltTable'
import { GradePill } from '../components/GradePill'
import { PageHero } from '../components/PageHero'
import { PersonalPanel } from '../components/PersonalPanel'
import { ReviewsFold } from '../components/ReviewsSection'
import { SafetyLight } from '../components/SafetyLight'
import { TitleTools } from '../components/TitleTools'
import type { LoadedData } from '../data/dataset'
import type { Route } from '../data/schema'
import { CommunityText } from '../edit/CommunityText'
import type { ToolScope } from '../edit/PageTools'
import { textTarget } from '../edit/textEdits'
import { formatDate, quickdraws, typeLabel } from '../format'
import { localName, useLang } from '../i18n'
import { useState, type ReactNode } from 'react'
import { useWide } from '../layout'
import { useCloud } from '../personal/sync'
import { href, useRouteLink } from '../router'
import { currentRouteUrl, shareText } from '../share'
import { routeKey, summarize } from '../social/model'
import { RouteTopos } from '../topo/TopoSection'
import { useSocial } from '../social/store'
import { areaSectorColor, NotFound } from './AreaPage'

/**
 * 路線頁（手機版與電腦版的右側相同）：整頁是一張路線卡片。上方是標題卡（與區域、分區頁相同；右上是收藏、回報位置、更多），
 * 名稱下面是難度、長度、快扣、種類；接著是安全與狀態合併的一個色塊、Topo、說明（直接顯示內容）、路線資料（安全與拉測、首攀、
 * Bolt 的摘要，明細點了才展開）；最後是評價與留言（預設收起，只看到摘要與最新一則）。
 * 手機版點說明進入說明編輯，長按 Topo 進入 Topo 編輯；左右滑動換到上一張、下一張卡片。
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
  const rating = summarize(useSocial().ratings[routeKey(id)])
  const [tickOpen, setTickOpen] = useState(false)
  const [reviewsOpen, setReviewsOpen] = useState(false)
  const wide = useWide()
  if (!ref) return <NotFound />
  const { route, sector, area } = ref
  const name = localName(route.name, lang)
  const pitches = route.pitch ? sector.routes.filter((r) => r.pitch && baseName(r.name.zh) === baseName(route.name.zh)) : []
  const qd = quickdraws(route)
  const scope: ToolScope = { areaId: area.id, text: { target: textTarget.route(route.id), label: t('edit.routeText'), original: route.description }, sectors: [sector], topoEdit: true }

  return (
    <article className="route route-m">
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
            <GradePill grade={route.grade} value={route.gradeValue} size="lg" />
            {route.heightM && <span>{route.heightM} m</span>}
            {qd && <span>{t('type.quickdraws', { n: qd })}</span>}
            {(route.type || route.isFixture) && <span>{route.isFixture ? t('type.fixture') : typeLabel(route.type!, t)}</span>}
            {rating && (
              <button
                type="button"
                className="route-facts-rating"
                onClick={() => {
                  setReviewsOpen(true)
                  requestAnimationFrame(() => document.getElementById('rating')?.scrollIntoView({ behavior: 'smooth' }))
                }}
              >
                ★ {rating.average.toFixed(1)}
              </button>
            )}
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
          />
        }
        shape={<SectorShape area={area} sector={sector} color={areaSectorColor(area, sector)} single className="area-hero-shape" />}
        compact
      />

      {!route.isFixture && <RouteStatus route={route} />}

      {signedIn && !route.isFixture && <PersonalPanel route={route} open={tickOpen} onClose={() => setTickOpen(false)} />}

      {!topoInList && <RouteTopos sector={sector} routeId={route.id} editable={!wide} />}

      <CommunityText target={textTarget.route(route.id)} original={route.description} editTo={wide ? undefined : href.edit('text', textTarget.route(route.id))} />

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

      <RouteData data={data} route={route} />

      <div id="rating" className="route-block">
        <ReviewsFold routeId={route.id} rateable={!route.isFixture} open={reviewsOpen} onOpen={() => setReviewsOpen(true)} />
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
 * 頁面上方只在安全不是綠燈（小心、危險、封閉、待移除）時顯示警告色塊；
 * 正常、尚未評級的不佔版面，安全與拉測的資訊在路線資料（RouteData）。
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
      <span>
        <strong>{[safety, status].filter(Boolean).join(' · ')}</strong>
        {route.statusDate && <span className="small">{formatDate(route.statusDate)}</span>}
      </span>
    </div>
  )
}

/**
 * 路線資料：一行一項（安全與拉測、首攀、Bolt、備註），左邊是項目、右邊是內容；
 * Bolt 只列摘要（幾支 bolt、幾個 anchor、材質、安裝年），明細（每一支的位置、材質、安裝、拉測）點了才在下面展開、滿寬。
 */
function RouteData({ data, route }: { data: LoadedData; route: Route }) {
  const { lang, t } = useLang()
  const level = safetyLevel(route)
  const safety = t(level === 'danger' ? 'safety.red' : route.safety ? `safety.${route.safety}` : 'safety.unrated')
  const status = route.status && (lang === 'zh' ? route.statusLabel : t(`status.${route.status}`))
  const fixings = [...route.bolts, ...route.anchors]
  const materials = [...new Set(fixings.map((b) => b.material).filter(Boolean))]
  const years = fixings.map((b) => b.installed?.slice(0, 4)).filter(Boolean).sort() as string[]
  const installed = years.length ? (years[0] === years.at(-1) ? years[0] : `${years[0]}–${years.at(-1)}`) : undefined
  const counts = [route.bolts.length > 0 && t('route.bolts', { n: route.bolts.length }), route.anchors.length > 0 && t('route.anchors', { n: route.anchors.length })]
  const rows: [string, ReactNode][] = []
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
  if (route.notes) rows.push([t('route.notes'), <span className="pre">{route.notes}</span>])
  if (rows.length === 0 && fixings.length === 0) return null
  return (
    <div className="route-data route-block">
      {rows.map(([label, value]) => (
        <div key={label} className="route-data-row">
          <span className="route-data-label">{label}</span>
          <span>{value}</span>
        </div>
      ))}
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
