import { useEffect, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { useLang, type MessageKey } from '../i18n'
import { MapReports } from '../pages/MapReports'
import { Filters, ItemDetail, PendingDetail, TypeBadge, UserDetail } from './parts'
import { SECTIONS, type AdminModel } from './useAdminModel'

const PAGE = 30

/**
 * 手機版：上方分類可以左右滑，下面一張一張的卡片；點卡片在原地展開完整內容與操作（不換頁、不用另一欄）。
 * 篩選收在搜尋列下面，類型的標籤可以左右滑。
 */
export function MobileView({ m, data }: { m: AdminModel; data: LoadedData }) {
  const { t } = useLang()
  const [shown, setShown] = useState(PAGE)
  useEffect(() => setShown(PAGE), [m.section, m.types, m.uid, m.query, m.range])

  const tabs = (
    <div className="admin-mtabs" role="tablist">
      {SECTIONS.map((s) => (
        <button key={s} type="button" role="tab" aria-selected={m.section === s} onClick={() => m.setSection(s)}>
          {t(`admin.section.${s}` as MessageKey)}
          {s === 'pending' && m.pending.length > 0 && <span className="admin-count">{m.pending.length}</span>}
        </button>
      ))}
    </div>
  )
  if (m.section === 'map') {
    return (
      <>
        {tabs}
        <MapReports data={data} profiles={m.profiles} />
      </>
    )
  }

  const toggle = (key: string) => m.setSelected(m.selected === key ? undefined : key)
  const cards =
    m.section === 'pending'
      ? m.visiblePending.map((p) => ({
          key: p.id,
          head: (
            <>
              <TypeBadge type="comment" label={m.typeLabel('comment')} />
              <b>{p.comment?.target ?? t('admin.commentGone')}</b>
            </>
          ),
          preview: p.comment?.summary ?? p.reason ?? '',
          foot: `${p.who} · ${m.time(p.createdAt)}`,
          body: <PendingDetail report={p} m={m} compact />,
        }))
      : m.section === 'users'
        ? m.visibleUsers.map((u) => ({
            key: u.uid,
            head: <b>{u.name}</b>,
            preview: '',
            foot: u.total ? `${t('admin.userTotal', { n: u.total })} · ${t('admin.lastActive', { time: m.time(u.last) })}` : t('admin.noInput'),
            body: <UserDetail user={u} m={m} compact />,
          }))
        : m.visible.map((i) => ({
            key: i.key,
            head: (
              <>
                <TypeBadge type={i.type} label={m.typeLabel(i.type)} />
                <b>{i.target}</b>
                {i.reportCount ? <span className="admin-count">!</span> : null}
              </>
            ),
            preview: i.summary,
            foot: `${i.who} · ${m.time(i.createdAt)}`,
            body: <ItemDetail item={i} m={m} compact />,
          }))
  const total = m.section === 'pending' ? m.pending.length : m.section === 'users' ? m.users.length : m.feed.length

  return (
    <>
      {tabs}
      <Filters m={m} />
      <p className="muted small admin-summary">{t('admin.reportCount', { n: cards.length, total })}</p>
      {m.raw && cards.length === 0 && <p className="muted">{t(m.section === 'pending' ? 'admin.noReports' : m.section === 'users' ? 'admin.emptyUsers' : 'admin.emptyFeed')}</p>}
      <ul className="admin-cards">
        {cards.slice(0, shown).map((c) => (
          <li key={c.key} className={`admin-card${m.selected === c.key ? ' open' : ''}`}>
            <button type="button" className="admin-card-head" aria-expanded={m.selected === c.key} onClick={() => toggle(c.key)}>
              <span className="admin-item-head">{c.head}</span>
              {c.preview && <span className={`admin-card-preview${m.selected === c.key ? ' full' : ''}`}>{c.preview}</span>}
              <span className="muted small">{c.foot}</span>
            </button>
            {m.selected === c.key && <div className="admin-card-body">{c.body}</div>}
          </li>
        ))}
      </ul>
      {cards.length > shown && (
        <button type="button" className="action admin-more" onClick={() => setShown((n) => n + PAGE)}>
          {t('admin.more', { n: cards.length - shown })}
        </button>
      )}
    </>
  )
}
