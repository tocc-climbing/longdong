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

/** 路線清單的一列；table 為電腦版的表格欄位（與 RouteList 的欄位標題對齊） */
export function RouteRow({ item, showPlace = false, table = false }: { item: RouteRef; showPlace?: boolean; table?: boolean }) {
  const { route, sector, area } = item
  const { lang, t } = useLang()
  const name = localName(route.name, lang)
  const personal = usePersonal()
  const signedIn = useCloud().status === 'signed-in'
  const rating = summarize(useSocial().ratings[routeKey(route.id)])
  const favorite = signedIn && personal.favorites.has(route.id)
  const { link, selected } = useRouteLink()
  const sent = signedIn && (personal.best.has(route.id) || personal.ticks.some((t) => t.routeId === route.id && isSent(t.style)))

  const selectedRow = selected === route.id
  const nameCell = (
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
  )

  if (table) {
    return (
      <li>
        <a className={`route-row rt-row${selectedRow ? ' selected' : ''}`} href={link(route.id)} aria-current={selectedRow ? 'true' : undefined}>
          <span className="route-no">{route.number ? `#${route.number}` : '—'}</span>
          <span className="rt-name">
            {nameCell}
            <span className="rt-type-inline">{typeText(route, t)}</span>
            {route.status && <StatusBadge status={route.status} compact />}
          </span>
          {/* 每一格都包一層，沒有內容時欄位也對齊 */}
          <span>
            <GradePill grade={route.grade} value={route.gradeValue} />
          </span>
          <span className="type">{typeText(route, t)}</span>
          <span>{!route.isFixture && <SafetyLight safety={route.safety} />}</span>
          <span>
            <StarsBadge summary={rating} />
          </span>
        </a>
      </li>
    )
  }

  return (
    <li>
      <a
        className={`route-row${selectedRow ? ' selected' : ''}`}
        href={link(route.id)}
        aria-current={selectedRow ? 'true' : undefined}
      >
        <span className="route-no">{route.number ? `#${route.number}` : '—'}</span>
        {nameCell}
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
