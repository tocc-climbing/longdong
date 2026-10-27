import { useLang, type MessageKey } from '../i18n'
import { imageUrl } from '../topo/model'
import { FEED_GROUPS, FEED_TYPES, type FeedItem, type FeedType, type PendingReport, type UserSummary } from './feed'
import { RANGES, type AdminModel, type Range } from './useAdminModel'

/** 電腦版、手機版共用的小零件：類型標籤、篩選列、一筆輸入／檢舉／使用者的內容與操作 */

export function TypeBadge({ type, label }: { type: FeedType; label: string }) {
  return <span className={`admin-type ${type}`}>{label}</span>
}

/** 搜尋、時間範圍、類型（多選，只列這個區塊有的類型）、目前的使用者篩選 */
export function Filters({ m, search = true, types = true }: { m: AdminModel; search?: boolean; types?: boolean }) {
  const { t } = useLang()
  const pool = m.group ? FEED_GROUPS[m.group] : FEED_TYPES
  return (
    <>
      <div className="admin-toolbar">
        {search && <input type="search" className="admin-search" value={m.query} onChange={(e) => m.setQuery(e.target.value)} placeholder={t('admin.search')} aria-label={t('admin.search')} />}
        {m.section !== 'users' && m.section !== 'pending' && (
          <select value={m.range} onChange={(e) => m.setRange(Number(e.target.value) as Range)} aria-label={t('admin.range')}>
            {RANGES.map((d) => (
              <option key={d} value={d}>
                {t(`admin.range.${d}` as MessageKey)}
              </option>
            ))}
          </select>
        )}
      </div>
      {(types || m.uid) && m.section !== 'users' && m.section !== 'pending' && (
        <div className="admin-chips" role="group" aria-label={t('admin.types')}>
          {types && (pool.length > 1 || !m.group) && (
            <>
              <button type="button" className={`admin-chip${m.types.size === 0 ? ' on' : ''}`} onClick={m.clearTypes}>
                {t('admin.type.all')}
              </button>
              {pool.map((type) => (
                <button key={type} type="button" className={`admin-chip${m.types.has(type) ? ' on' : ''}`} onClick={() => m.toggleType(type)}>
                  {m.typeLabel(type)}
                  <span className="admin-chip-n">{m.typeCounts[type]}</span>
                </button>
              ))}
            </>
          )}
          {m.uid && (
            <span className="admin-chip on">
              {t('admin.userFilter', { name: m.userName(m.uid) })}
              <button type="button" aria-label={t('admin.clearFilter')} onClick={() => m.setUid(undefined)}>
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </>
  )
}

/** 一筆輸入的內容與操作：對象與連結、完整內容、Topo 照片、被檢舉的提示、輸入者與時間 */
export function ItemDetail({ item, m, actions, compact }: { item: FeedItem; m: AdminModel; actions?: React.ReactNode; compact?: boolean }) {
  const { t } = useLang()
  return (
    <div className="admin-detail-item">
      {!compact && (
        <div className="admin-item-head">
          <TypeBadge type={item.type} label={m.typeLabel(item.type)} />
          <span className="admin-target">{item.target}</span>
        </div>
      )}
      <p className="admin-text">{item.summary}</p>
      {item.photo && <img className="admin-photo" src={imageUrl(item.photo.image)} alt={item.target} loading="lazy" />}
      {item.reportCount ? <p className="admin-flag small">{t('admin.reportedTimes', { n: item.reportCount })}</p> : null}
      <p className="muted small">
        <button type="button" className="admin-who" onClick={() => m.showUser(item.uid)} title={t('admin.showUser')}>
          {item.who}
        </button>
        {!compact && ` · ${m.time(item.createdAt)}`}
      </p>
      <div className="admin-actions">
        {actions ?? <ItemActions item={item} m={m} />}
      </div>
    </div>
  )
}

/** 開啟（修改模式的項目；留言與評分的連結在對象名稱上）與刪除（規則允許時；評分只有本人能刪） */
export function ItemActions({ item, m }: { item: FeedItem; m: AdminModel }) {
  const { t } = useLang()
  return (
    <>
      {item.href && item.type !== 'comment' && item.type !== 'rating' && (
        <a className="action small" href={item.href}>
          {t('admin.open')}
        </a>
      )}
      {item.href && (item.type === 'comment' || item.type === 'rating') && (
        <a className="action small" href={item.href}>
          {t('admin.openRoute')}
        </a>
      )}
      {m.canDelete(item) ? (
        <button type="button" className="action small danger" disabled={m.busy === item.key} onClick={() => m.removeItem(item)}>
          {t('admin.delete')}
        </button>
      ) : (
        item.type === 'rating' && <span className="muted small">{t('admin.ownerOnly')}</span>
      )}
    </>
  )
}

/** 一筆檢舉：檢舉人與原因、被檢舉的留言與處理（忽略、刪除留言） */
export function PendingDetail({ report, m, compact }: { report: PendingReport; m: AdminModel; compact?: boolean }) {
  const { t } = useLang()
  return (
    <div className="admin-detail-report">
      <p className="admin-report small">
        <strong>{t('admin.reportedBy', { name: report.who, time: m.time(report.createdAt) })}</strong>
        {report.reason && <span>「{report.reason}」</span>}
      </p>
      {report.comment ? (
        <ItemDetail
          item={report.comment}
          m={m}
          compact={compact}
          actions={
            <>
              <button type="button" className="action small" disabled={m.busy === report.id} onClick={() => m.dismiss(report.id)}>
                {t('admin.dismiss')}
              </button>
              <button type="button" className="action small danger" disabled={m.busy === report.comment.key} onClick={() => m.removeReported(report.comment!)}>
                {t('admin.deleteComment')}
              </button>
            </>
          }
        />
      ) : (
        <div className="admin-actions">
          <span className="muted small">{t('admin.commentGone')}</span>
          <button type="button" className="action small" disabled={m.busy === report.id} onClick={() => m.dismiss(report.id)}>
            {t('admin.dismiss')}
          </button>
        </div>
      )}
    </div>
  )
}

/** 一位使用者：各類輸入的數量、最近一次、最近的幾筆，按鈕看他所有的輸入 */
export function UserDetail({ user, m, compact }: { user: UserSummary; m: AdminModel; compact?: boolean }) {
  const { t } = useLang()
  const recent = m.feed.filter((i) => i.uid === user.uid).slice(0, 6)
  return (
    <div className="admin-detail-user">
      {!compact && (
        <>
          <h3>{user.name}</h3>
          <p className="muted small">
            {user.uid} · {user.last ? t('admin.lastActive', { time: m.time(user.last) }) : t('admin.noInput')}
          </p>
        </>
      )}
      <p className="admin-badges">
        {FEED_TYPES.filter((type) => user.counts[type] > 0).map((type) => (
          <TypeBadge key={type} type={type} label={`${m.typeLabel(type)} ${user.counts[type]}`} />
        ))}
      </p>
      {recent.length > 0 && (
        <ul className="admin-recent">
          {recent.map((i) => (
            <li key={i.key}>
              <TypeBadge type={i.type} label={m.typeLabel(i.type)} />
              <span className="admin-recent-text">
                <b>{i.target}</b>
                <span className="muted small">{i.summary}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {user.total > 0 && (
        <button type="button" className="action small" onClick={() => m.showUser(user.uid)}>
          {t('admin.showUserAll', { n: user.total })}
        </button>
      )}
    </div>
  )
}
