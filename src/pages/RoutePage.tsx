import type { LoadedData } from '../data/dataset'
import { BoltTable } from '../components/BoltTable'
import { CommentsSection } from '../components/CommentsSection'
import { GradePill } from '../components/GradePill'
import { PersonalPanel } from '../components/PersonalPanel'
import { RatingSection } from '../components/RatingSection'
import { SignInPrompt } from '../components/SignInPrompt'
import { SafetyLight } from '../components/SafetyLight'
import { ShareButton } from '../components/ShareButton'
import { StarsBadge } from '../components/Stars'
import { useCloud } from '../personal/sync'
import { feelConsensus, routeKey, summarize } from '../social/model'
import { localName, useLang, type Translate } from '../i18n'
import { useSocial } from '../social/store'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate, typeText, yearsSince } from '../format'
import { href, useRouteLink } from '../router'
import { NotFound } from './AreaPage'
import { RouteMobile } from './RouteMobile'
import { useWide } from '../layout'

export function RoutePage({ data, id }: { data: LoadedData; id: string }) {
  // 手機版：精簡的版面（RouteMobile）；電腦版不變
  if (!useWide()) return <RouteMobile data={data} id={id} />
  return <RouteDesktop data={data} id={id} />
}

function RouteDesktop({ data, id }: { data: LoadedData; id: string }) {
  const ref = data.routeById.get(id)
  const { lang, t } = useLang()
  const { link } = useRouteLink()
  const cloudStatus = useCloud().status
  const signedIn = cloudStatus === 'signed-in'
  const rating = summarize(useSocial().ratings[routeKey(id)])
  if (!ref) return <NotFound />
  const { route, sector, area } = ref
  const danger = route.status === 'closed' || route.status === 'to-remove'
  const name = localName(route.name, lang)
  const consensus = feelConsensus(rating)
  const pitches = route.pitch ? sector.routes.filter((r) => r.pitch && baseName(r.name.zh) === baseName(route.name.zh)) : []

  return (
    <article className="route">
      <nav className="crumbs">
        <a href={href.area(area.id)}>{localName(area.name, lang).main}</a>
        {area.sectors.length > 1 && (
          <>
            {' / '}
            <a href={href.sector(sector.id)}>{localName(sector.name, lang).main}</a>
          </>
        )}
      </nav>

      <header className="route-head">
        {route.number && <span className="route-no big">#{route.number}</span>}
        <h1>
          {name.main}
          {name.sub && <span className="en">{name.sub}</span>}
        </h1>
        <div className="facts">
          <GradePill grade={route.grade} value={route.gradeValue} size="lg" />
          {(route.type || route.isFixture) && <span className="fact">{typeText(route, t)}</span>}
          {route.heightM && <span className="fact">{route.heightM} m</span>}
          <ShareButton item={ref} />
        </div>
        {!route.isFixture && (
          <div className="safety-row">
            <SafetyLight safety={route.safety} />
            {rating && (
              <button
                type="button"
                className="rating-link"
                onClick={() => document.getElementById('rating')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <StarsBadge summary={rating} />
                {consensus && <span className="muted small"> · {t('route.feel', { feel: t(`feel.${consensus}`) })}</span>}
              </button>
            )}
          </div>
        )}
      </header>

      {danger && (
        <p className="alert" role="alert">
          {t('route.closedAlert', { label: lang === 'zh' ? (route.statusLabel ?? '') : t(`status.${route.status!}`) })}
        </p>
      )}

      {!route.isFixture && signedIn && <PersonalPanel route={route} />}

      {/* 路線欄夠寬時分成兩欄：左邊狀態與路線資訊，右邊 Bolt、評分、留言（手機上依序排列，順序不變） */}
      <div className="route-main">
        <section className="panel">
          <dl className="kv">
            <dt>{t('route.status')}</dt>
            <dd>
              {route.status ? <StatusBadge status={route.status} /> : <span className="muted">{t('route.notRecorded')}</span>}
              {route.statusDate && <span className="muted"> {formatDate(route.statusDate)}</span>}
            </dd>
            <dt>{t('route.lastTested')}</dt>
            <dd>
              {route.lastTested ? (
                <>
                  {formatDate(route.lastTested)} <span className="muted">({ageText(route.lastTested, t)})</span>
                </>
              ) : (
                <span className="muted">{t('route.noRecord')}</span>
              )}
            </dd>
            {route.boltCount !== undefined && route.boltCount > 0 && (
              <>
                <dt>{t('route.boltCount')}</dt>
                <dd>{route.boltCount}</dd>
              </>
            )}
            {route.firstAscent && (
              <>
                <dt>{t('route.firstAscent')}</dt>
                <dd className="pre">
                  {route.firstAscent}
                  {route.firstAscentDate && <span className="muted">{'\n'}{formatDate(route.firstAscentDate)}</span>}
                </dd>
              </>
            )}
          </dl>
        </section>

        {pitches.length > 1 && (
          <section>
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
          <section>
            <h2>{t('route.info')}</h2>
            <p className="pre">{route.description}</p>
          </section>
        )}
      </div>

      <div className="route-side">
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

        {!route.isFixture && (
          <div id="rating">
            <RatingSection routeId={route.id} />
          </div>
        )}

        <CommentsSection routeId={route.id} />

        {/* 未登入時只在頁尾提醒一次，不打斷路線資料 */}
        {!signedIn && cloudStatus !== 'loading' && (
          <div className="signin-hint">
            <SignInPrompt compact message={route.isFixture ? t('comments.signIn') : t('route.signInHint')} />
          </div>
        )}
      </div>
    </article>
  )
}

/** 「自由裂隙 | P2 右」→「自由裂隙」，用來找出同一條多繩距路線的各段 */
export function baseName(zh: string): string {
  return zh.replace(/\s*\|\s*P\d+.*$/i, '').trim()
}

export function ageText(date: string, t: Translate): string {
  const y = yearsSince(date)
  return y === undefined ? '' : y === 0 ? t('time.withinYear') : t('time.yearsAgo', { n: y })
}
