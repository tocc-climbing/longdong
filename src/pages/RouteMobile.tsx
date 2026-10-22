import { BoltTable } from '../components/BoltTable'
import { CommentsSection } from '../components/CommentsSection'
import { GradePill } from '../components/GradePill'
import { PersonalPanel } from '../components/PersonalPanel'
import { RatingSection } from '../components/RatingSection'
import { SafetyLight } from '../components/SafetyLight'
import { ShareButton } from '../components/ShareButton'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import type { Route } from '../data/schema'
import { formatDate, typeText } from '../format'
import { localName, useLang } from '../i18n'
import { useCloud } from '../personal/sync'
import { href, useRouteLink } from '../router'
import { routeKey, summarize } from '../social/model'
import { useSocial } from '../social/store'
import { NotFound } from './AreaPage'
import { baseName } from './RoutePage'

/**
 * 手機版的路線頁：名稱、一行重點（難度、種類、高度、評分）、安全與狀態合併的一個色塊、
 * 記錄／收藏／分享、路線資訊；首攀、Bolt、Anchor 收在「更多資訊」；最後是評分與留言。
 */
export function RouteMobile({ data, id }: { data: LoadedData; id: string }) {
  const ref = data.routeById.get(id)
  const { lang, t } = useLang()
  const { link } = useRouteLink()
  const cloudStatus = useCloud().status
  const signedIn = cloudStatus === 'signed-in'
  const rating = summarize(useSocial().ratings[routeKey(id)])
  if (!ref) return <NotFound />
  const { route, sector, area } = ref
  const name = localName(route.name, lang)
  const pitches = route.pitch ? sector.routes.filter((r) => r.pitch && baseName(r.name.zh) === baseName(route.name.zh)) : []
  const more = [
    route.firstAscent && t('route.firstAscent'),
    route.bolts.length > 0 && 'Bolt',
    route.anchors.length > 0 && 'Anchor',
    route.anchorHardware.length > 0 && t('route.anchorHardware'),
    route.notes && t('route.notes'),
  ].filter(Boolean) as string[]

  return (
    <article className="route route-m">
      <nav className="crumbs">
        <a href={href.area(area.id)}>{localName(area.name, lang).main}</a>
        {area.sectors.length > 1 && (
          <>
            {' › '}
            <a href={href.sector(sector.id)}>{localName(sector.name, lang).main}</a>
          </>
        )}
      </nav>

      <h1>{name.main}</h1>
      {(route.number || name.sub) && <p className="route-sub">{[route.number && `#${route.number}`, name.sub].filter(Boolean).join(' · ')}</p>}

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

      {signedIn && !route.isFixture ? (
        <PersonalPanel route={route} extra={<ShareButton item={ref} />} />
      ) : (
        <div className="route-actions">
          <ShareButton item={ref} />
        </div>
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

      {route.description && (
        <section className="route-block">
          <h2>{t('route.info')}</h2>
          <p className="pre">{route.description}</p>
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
          {route.firstAscent && (
            <dl className="kv">
              <dt>{t('route.firstAscent')}</dt>
              <dd className="pre">
                {route.firstAscent}
                {route.firstAscentDate && <span className="muted"> · {formatDate(route.firstAscentDate)}</span>}
              </dd>
            </dl>
          )}
          {route.bolts.length > 0 && <BoltTable title="Bolt" bolts={route.bolts} data={data} />}
          {route.anchors.length > 0 && <BoltTable title="Anchor" bolts={route.anchors} data={data} />}
          {route.anchorHardware.length > 0 && (
            <section>
              <h2>{t('route.anchorHardware')}</h2>
              <ul className="plain">
                {route.anchorHardware.map((h, i) => (
                  <li key={i}>
                    {h.item}
                    {h.quantity && ` ×${h.quantity}`}
                    {h.spec && <span className="muted"> {h.spec}</span>}
                    {h.installed && <span className="muted"> · {t('route.installedOn', { date: formatDate(h.installed) })}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {route.notes && (
            <section>
              <h2>{t('route.notes')}</h2>
              <p className="pre small">{route.notes}</p>
            </section>
          )}
        </details>
      )}

      {!route.isFixture && (
        <div id="rating" className="route-block">
          <RatingSection routeId={route.id} />
        </div>
      )}

      <div className="route-block">
        <CommentsSection routeId={route.id} />
      </div>

      {!signedIn && cloudStatus !== 'loading' && (
        <div className="signin-hint">
          <SignInPrompt compact message={route.isFixture ? t('comments.signIn') : t('route.signInHint')} />
        </div>
      )}
    </article>
  )
}

/**
 * 安全燈號與路線狀態合併成一個色塊：
 * 第一行「正常 · 已更新」（燈號 · 狀態），第二行狀態日期與最近拉測；待移除、封閉一律為危險。
 */
function RouteStatus({ route }: { route: Route }) {
  const { lang, t } = useLang()
  const closed = route.status === 'closed' || route.status === 'to-remove'
  const level = closed || route.safety === 'red' ? 'danger' : route.safety === 'yellow' ? 'warn' : route.safety === 'green' ? 'ok' : 'unknown'
  const icon = { ok: '✓', warn: '!', danger: '!', unknown: '?' }[level]
  const safety = t(level === 'danger' ? 'safety.red' : route.safety ? `safety.${route.safety}` : 'safety.unrated')
  const status = route.status && (lang === 'zh' ? route.statusLabel : t(`status.${route.status}`))
  const detail = [
    route.statusDate && formatDate(route.statusDate),
    route.lastTested ? `${t('route.lastTested')} ${formatDate(route.lastTested)}` : `${t('route.lastTested')}：${t('route.noRecord')}`,
  ].filter(Boolean)
  return (
    <div className={`route-status ${level}`} role={level === 'danger' ? 'alert' : undefined}>
      <span className="route-status-icon" aria-hidden>
        {icon}
      </span>
      <span>
        <strong>{[safety, status].filter(Boolean).join(' · ')}</strong>
        <span className="small">{detail.join(' · ')}</span>
      </span>
    </div>
  )
}
