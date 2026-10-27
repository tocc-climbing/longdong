import { useEffect, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { useLang, type MessageKey } from '../i18n'
import { MapReports } from '../pages/MapReports'
import { Filters, ItemDetail, PendingDetail, TypeBadge, UserDetail } from './parts'
import { SECTIONS, type AdminModel, type AdminSection } from './useAdminModel'

const PAGE = 100

/**
 * 電腦版：左邊分類（有數字），中間一行一筆的清單（可用 ↑ ↓ 切換），右邊是選到那筆的完整內容與操作。
 * 地圖回報要整個畫面（地圖與清單並排），不分三欄。
 */
export function DesktopView({ m, data }: { m: AdminModel; data: LoadedData }) {
  const { t } = useLang()
  const [shown, setShown] = useState(PAGE)
  useEffect(() => setShown(PAGE), [m.section, m.types, m.uid, m.query, m.range])

  const count = (s: AdminSection): number | undefined =>
    s === 'all' ? m.feed.length : s === 'pending' ? m.pending.length : s === 'users' ? m.users.length : s === 'map' ? undefined : m.feed.filter((i) => (s === 'content' ? i.type === 'comment' || i.type === 'rating' : i.type !== 'comment' && i.type !== 'rating')).length

  const nav = (
    <div className="admin-rail" role="tablist" aria-orientation="vertical" aria-label={t('admin.title')}>
      {SECTIONS.map((s) => (
        <button key={s} type="button" role="tab" aria-selected={m.section === s} className={m.section === s ? 'on' : ''} onClick={() => m.setSection(s)}>
          <span>{t(`admin.section.${s}` as MessageKey)}</span>
          {s === 'pending' && m.pending.length > 0 ? <span className="admin-count">{m.pending.length}</span> : count(s) !== undefined && <span className="admin-rail-n">{count(s)}</span>}
        </button>
      ))}
    </div>
  )

  if (m.section === 'map') {
    return (
      <div className="admin-desk map">
        {nav}
        <div className="admin-desk-main">
          <MapReports data={data} profiles={m.profiles} />
        </div>
      </div>
    )
  }

  const rows =
    m.section === 'pending'
      ? m.visiblePending.map((p) => ({ key: p.id, node: <PendingRow p={p} m={m} /> }))
      : m.section === 'users'
        ? m.visibleUsers.map((u) => ({ key: u.uid, node: <UserRow u={u} m={m} /> }))
        : m.visible.map((i) => ({ key: i.key, node: <ItemRow item={i} m={m} /> }))
  const total = m.section === 'pending' ? m.pending.length : m.section === 'users' ? m.users.length : m.feed.length

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rows.findIndex((r) => r.key === m.selected)
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) m.setSelected(next.key)
  }

  const detail = (() => {
    if (!m.selected) return <p className="muted admin-empty">{t('admin.pickOne')}</p>
    if (m.section === 'pending') {
      const p = m.pending.find((r) => r.id === m.selected)
      return p && <PendingDetail report={p} m={m} />
    }
    if (m.section === 'users') {
      const u = m.users.find((x) => x.uid === m.selected)
      return u && <UserDetail user={u} m={m} />
    }
    const item = m.feed.find((i) => i.key === m.selected)
    return item && <ItemDetail item={item} m={m} />
  })()

  return (
    <div className="admin-desk">
      {nav}
      <section className="admin-desk-main" onKeyDown={move}>
        <Filters m={m} />
        <p className="muted small admin-summary">{t('admin.reportCount', { n: rows.length, total })}</p>
        {m.raw && rows.length === 0 && <p className="muted">{t(m.section === 'pending' ? 'admin.noReports' : m.section === 'users' ? 'admin.emptyUsers' : 'admin.emptyFeed')}</p>}
        <ul className="admin-rows" role="listbox" aria-label={t('admin.title')}>
          {rows.slice(0, shown).map((r) => (
            <li key={r.key} role="option" aria-selected={m.selected === r.key}>
              <button type="button" className={`admin-row${m.selected === r.key ? ' on' : ''}`} onClick={() => m.setSelected(r.key)}>
                {r.node}
              </button>
            </li>
          ))}
        </ul>
        {rows.length > shown && (
          <button type="button" className="action admin-more" onClick={() => setShown((n) => n + PAGE)}>
            {t('admin.more', { n: rows.length - shown })}
          </button>
        )}
      </section>
      <aside className="admin-desk-detail" aria-label={t('admin.detail')}>
        {detail}
      </aside>
    </div>
  )
}

const ItemRow = ({ item, m }: { item: AdminModel['feed'][number]; m: AdminModel }) => (
  <>
    <TypeBadge type={item.type} label={m.typeLabel(item.type)} />
    <span className="admin-row-main">
      <b>{item.target}</b>
      <span className="muted">{item.summary}</span>
    </span>
    {item.reportCount ? <span className="admin-count">!</span> : null}
    <span className="admin-row-who">{item.who}</span>
    <span className="admin-row-time muted">{m.time(item.createdAt)}</span>
  </>
)

const PendingRow = ({ p, m }: { p: AdminModel['pending'][number]; m: AdminModel }) => (
  <>
    <TypeBadge type="comment" label={m.typeLabel('comment')} />
    <span className="admin-row-main">
      <b>{p.comment?.target ?? '—'}</b>
      <span className="muted">{p.comment?.summary ?? p.reason ?? ''}</span>
    </span>
    <span className="admin-row-who">{p.who}</span>
    <span className="admin-row-time muted">{m.time(p.createdAt)}</span>
  </>
)

const UserRow = ({ u, m }: { u: AdminModel['users'][number]; m: AdminModel }) => (
  <>
    <span className="admin-row-main">
      <b>{u.name}</b>
      <span className="muted">{u.uid.slice(0, 8)}</span>
    </span>
    <span className="admin-row-who">{u.total}</span>
    <span className="admin-row-time muted">{u.last ? m.time(u.last) : ''}</span>
  </>
)
