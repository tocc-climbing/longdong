import type { RouteRef } from '../data/dataset'
import { typeText } from '../format'
import { isSent } from '../personal/model'
import { usePersonal } from '../personal/store'
import { useCloud } from '../personal/sync'
import { routeKey, summarize } from '../social/model'
import { useSocial } from '../social/store'
import { useRouteLink } from '../router'
import { localName, useLang } from '../i18n'
import { GradePill } from './GradePill'
import { SafetyLight } from './SafetyLight'
import { StarsBadge } from './Stars'
import { StatusBadge } from './StatusBadge'

export function RouteRow({ item, showPlace = false }: { item: RouteRef; showPlace?: boolean }) {
  const { route, sector, area } = item
  const { lang, t } = useLang()
  const name = localName(route.name, lang)
  const personal = usePersonal()
  const signedIn = useCloud().status === 'signed-in'
  const rating = summarize(useSocial().ratings[routeKey(route.id)])
  const favorite = signedIn && personal.favorites.has(route.id)
  const { link, selected } = useRouteLink()
  const sent = signedIn && personal.ticks.some((t) => t.routeId === route.id && isSent(t.style))

  return (
    <li>
      <a
        className={`route-row${selected === route.id ? ' selected' : ''}`}
        href={link(route.id)}
        aria-current={selected === route.id ? 'true' : undefined}
      >
        <span className="route-no">{route.number ? `#${route.number}` : '—'}</span>
        <span className="route-name">
          <span className="zh">
            {name.main}
            {(favorite || sent) && (
              <span className="marks">
                {sent && (
                  <span title={t('mark.sent')} aria-label={t('mark.sent')}>
                    ✓
                  </span>
                )}
                {favorite && (
                  <span title={t('mark.fav')} aria-label={t('mark.fav')}>
                    ★
                  </span>
                )}
              </span>
            )}
          </span>
          {name.sub && <span className="en">{name.sub}</span>}
          {showPlace && (
            <span className="place">
              {localName(area.name, lang).main} · {localName(sector.name, lang).main}
            </span>
          )}
        </span>
        <span className="route-meta">
          <span className="grade-line">
            {!route.isFixture && <SafetyLight safety={route.safety} />}
            <GradePill grade={route.grade} value={route.gradeValue} />
          </span>
          <span className="type">{typeText(route, t)}</span>
          <span className="meta-line">
            <StarsBadge summary={rating} />
            {route.status && <StatusBadge status={route.status} compact />}
          </span>
        </span>
      </a>
    </li>
  )
}
