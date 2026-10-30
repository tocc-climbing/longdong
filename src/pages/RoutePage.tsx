import { SectorShape } from '../components/AreaShape'
import { BoltTable } from '../components/BoltTable'
import { GradePill } from '../components/GradePill'
import { PageHero } from '../components/PageHero'
import { PersonalPanel } from '../components/PersonalPanel'
import { ReviewsSection } from '../components/ReviewsSection'
import { SafetyLight } from '../components/SafetyLight'
import { TitleTools } from '../components/TitleTools'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import type { Route } from '../data/schema'
import { CommunityText } from '../edit/CommunityText'
import type { ToolScope } from '../edit/PageTools'
import { textTarget } from '../edit/textEdits'
import { formatDate, typeText } from '../format'
import { localName, useLang } from '../i18n'
import { useState } from 'react'
import { useWide } from '../layout'
import { useCloud } from '../personal/sync'
import { href, useRouteLink } from '../router'
import { currentRouteUrl, shareText } from '../share'
import { routeKey, summarize } from '../social/model'
import { RouteTopos } from '../topo/TopoSection'
import { useSocial } from '../social/store'
import { areaSectorColor, NotFound } from './AreaPage'

/**
 * 路線頁（手機版與電腦版的右側相同）：標題卡（與區域、分區頁相同；右上是收藏、回報位置、更多）、
 * 一行重點（難度、種類、高度、評分）、安全與狀態合併的一個色塊、Topo、路線資訊；首攀、Bolt、Anchor 收在「更多資訊」；
 * 最後是評分與留言。手機版點路線資訊進入說明編輯，長按 Topo 進入 Topo 編輯。
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
  const wide = useWide()
  if (!ref) return <NotFound />
  const { route, sector, area } = ref
  const name = localName(route.name, lang)
  const pitches = route.pitch ? sector.routes.filter((r) => r.pitch && baseName(r.name.zh) === baseName(route.name.zh)) : []
  const fixings = [...route.bolts, ...route.anchors]
  const more = [
    !route.isFixture && t('route.safetyTests'),
    route.firstAscent && t('route.firstAscent'),
    fixings.length > 0 && 'Bolt / Anchor',
    route.notes && t('route.notes'),
  ].filter(Boolean) as string[]
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
        shape={<SectorShape area={area} sector={sector} color={areaSectorColor(area, sector)} className="area-hero-shape" />}
        compact
      />

      <div className="route-facts">
        <GradePill grade={route.grade} value={route.gradeValue} size="lg" />
        {(route.type || route.isFixture) && <span>{typeText(route, t)}</span>}
        {route.heightM && <span>{route.heightM} m</span>}
        {rating && (
          <button type="button" className="route-facts-rating" onClick={() => document.getElementById('rating')?.scrollIntoView({ behavior: 'smooth' })}>
            ★ {rating.average.toFixed(1)}
          </button>
        )}
      </div>

      {!route.isFixture && <RouteStatus route={route} />}

      {signedIn && !route.isFixture && <PersonalPanel route={route} open={tickOpen} onClose={() => setTickOpen(false)} />}

      {!topoInList && <RouteTopos sector={sector} routeId={route.id} editable={!wide} />}

      <CommunityText target={textTarget.route(route.id)} original={route.description} title={t('route.info')} editTo={wide ? undefined : href.edit('text', textTarget.route(route.id))} />

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

      {more.length > 0 && (
        <details className="route-block route-more">
          <summary>
            <span>
              <strong>{t('route.more')}</strong>
              <span className="muted small">{more.join('、')}</span>
            </span>
          </summary>
          {!route.isFixture && <RouteStatusInfo route={route} />}
          {route.firstAscent && (
            <dl className="kv">
              <dt>{t('route.firstAscent')}</dt>
              <dd className="pre">
                {route.firstAscent}
                {route.firstAscentDate && <span className="muted"> · {formatDate(route.firstAscentDate)}</span>}
                {route.firstAscentDateLabel && <span className="muted"> · {route.firstAscentDateLabel}</span>}
              </dd>
            </dl>
          )}
          {fixings.length > 0 && (
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
              {route.notes && <p className="pre small">{route.notes}</p>}
            </BoltTable>
          )}
          {fixings.length === 0 && route.notes && <p className="pre small">{route.notes}</p>}
        </details>
      )}

      <div id="rating" className="route-block">
        <ReviewsSection routeId={route.id} rateable={!route.isFixture} />
      </div>

      {!signedIn && cloudStatus !== 'loading' && (
        <div className="signin-hint">
          <SignInPrompt compact message={route.isFixture ? t('comments.signIn') : t('route.signInHint')} />
        </div>
      )}
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
 * 正常、尚未評級的不佔版面，安全與拉測的資訊在「更多資訊」（RouteStatusInfo）。
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

/** 「更多資訊」裡的安全與拉測：安全評級、狀態、最近拉測 */
function RouteStatusInfo({ route }: { route: Route }) {
  const { lang, t } = useLang()
  const level = safetyLevel(route)
  const safety = t(level === 'danger' ? 'safety.red' : route.safety ? `safety.${route.safety}` : 'safety.unrated')
  const status = route.status && (lang === 'zh' ? route.statusLabel : t(`status.${route.status}`))
  return (
    <dl className="kv">
      <dt>{t('route.safetyTests')}</dt>
      <dd>
        {[safety, status, route.statusDate && formatDate(route.statusDate)].filter(Boolean).join(' · ')}
        <span className="muted"> · {route.lastTested ? `${t('route.lastTested')} ${formatDate(route.lastTested)}` : `${t('route.lastTested')}：${t('route.noRecord')}`}</span>
      </dd>
    </dl>
  )
}

/** 「自由裂隙 | P2 右」→「自由裂隙」，用來找出同一條多繩距路線的各段 */
function baseName(zh: string): string {
  return zh.replace(/\s*\|\s*P\d+.*$/i, '').trim()
}
