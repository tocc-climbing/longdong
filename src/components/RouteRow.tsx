import type { RouteRef } from '../data/dataset'
import type { Route } from '../data/schema'
import { typeText } from '../format'
import { SEND_SHORT, sendStyle, type SendStyle } from '../personal/stats'
import { usePersonal } from '../personal/store'
import { useCloud } from '../personal/sync'
import { routeKey, summarize } from '../social/model'
import { useSocial } from '../social/store'
import { useRouteLink } from '../router'
import { localName, useLang } from '../i18n'
import { StarsBadge } from './Stars'
import { StatusBadge } from './StatusBadge'

/**
 * 路線清單的一列：編號（下面是自己的完攀方式 OS／RP／TR）、名稱與種類、難度（沒有底色）與評分；
 * 小心、危險（兩個字）接在種類後面。table 為電腦版的表格欄位（與 RouteList 的欄位標題對齊）
 */
export function RouteRow({ item, showPlace = false, table = false }: { item: RouteRef; showPlace?: boolean; table?: boolean }) {
  const { route, sector, area } = item
  const { lang, t } = useLang()
  const name = localName(route.name, lang)
  const personal = usePersonal()
  const signedIn = useCloud().status === 'signed-in'
  const rating = summarize(useSocial().ratings[routeKey(route.id)])
  const { link, selected } = useRouteLink()
  const send = signedIn ? sendStyle(personal.ticks, personal.best, route.id) : undefined

  const selectedRow = selected === route.id
  const number = (
    <span className="route-no">
      {route.number ? `#${route.number}` : '—'}
      {send && <SendTag style={send} />}
    </span>
  )
  const zh = (
    <span className="zh">
      {name.main}
    </span>
  )
  const place = showPlace && (
    <span className="place">
      {localName(area.name, lang).main} · {localName(sector.name, lang).main}
    </span>
  )
  const grade = route.grade && <span className="route-row-grade">{route.grade}</span>

  if (table) {
    return (
      <li>
        <a className={`route-row rt-row${selectedRow ? ' selected' : ''}`} href={link(route.id)} aria-current={selectedRow ? 'true' : undefined}>
          {number}
          <span className="rt-name">
            <span className="route-name">
              {zh}
              {name.sub && <span className="en">{name.sub}</span>}
              {place}
            </span>
            <span className="rt-type-inline">{typeText(route, t)}</span>
            {route.status && <StatusBadge status={route.status} compact />}
          </span>
          {/* 每一格都包一層，沒有內容時欄位也對齊 */}
          <span>{grade}</span>
          <span className="type">{typeText(route, t)}</span>
          <span>{!route.isFixture && <RouteFlag route={route} />}</span>
          <span>
            <StarsBadge summary={rating} />
          </span>
        </a>
      </li>
    )
  }

  // 手機版：名稱下面一行種類、快扣數、高度（傳攀還是運攀、要帶幾把快扣），接著小心、危險；其他資訊在路線頁
  const facts = [typeText(route, t), route.heightM && `${route.heightM} m`].filter(Boolean).join(' · ')
  return (
    <li>
      <a className={`route-row${selectedRow ? ' selected' : ''}`} href={link(route.id)} aria-current={selectedRow ? 'true' : undefined}>
        {number}
        <span className="route-name">
          {zh}
          {place}
          <span className="route-row-facts">
            {facts && <span className="route-row-text">{facts}</span>}
            {!route.isFixture && <RouteFlag route={route} />}
          </span>
        </span>
        <span className="route-row-end">
          {grade}
          <StarsBadge summary={rating} />
        </span>
      </a>
    </li>
  )
}

/** 自己最好的完攀方式：OS、RP、TR（顏色同路線清單、難度金字塔） */
function SendTag({ style }: { style: SendStyle }) {
  const { t } = useLang()
  const short = SEND_SHORT[style]
  return (
    <span className={`send-tag style-${short.toLowerCase()}`} title={t('mark.sent')} aria-label={`${t('mark.sent')} ${short}`}>
      {short}
    </span>
  )
}

/** 需要注意的路線：黃燈「小心」、紅燈「危險」（待移除、封閉也是危險）；其他不顯示。alert：路線頁（危險時讀出來） */
export function RouteFlag({ route, alert }: { route: Route; alert?: boolean }) {
  const { t } = useLang()
  const closed = route.status === 'closed' || route.status === 'to-remove'
  const level = closed || route.safety === 'red' ? 'danger' : route.safety === 'yellow' ? 'warn' : undefined
  if (!level) return null
  return (
    <span className={`route-status ${level}`} role={alert && level === 'danger' ? 'alert' : undefined}>
      <span className="route-status-icon" aria-hidden>
        !
      </span>
      {t(level === 'danger' ? 'safety.red' : 'safety.yellow')}
    </span>
  )
}
