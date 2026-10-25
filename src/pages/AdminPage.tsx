import { useEffect, useState, type ReactNode } from 'react'
import { useIsAdmin } from '../admin'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import { LOCALES, localName, useLang } from '../i18n'
import { useCloud, withCloud } from '../personal/sync'
import { href } from '../router'
import type { Comment } from '../social/model'
import { displayName } from '../social/store'
import { MapReports } from './MapReports'
import { TopoAdmin } from './TopoAdmin'
import './AdminPage.css'

export type AdminTab = 'reports' | 'comments' | 'map' | 'topos'

/** 一則留言與它所在的路線（v2/comments/<routeKey>/<id>） */
interface AdminComment extends Comment {
  routeKey: string
  path: string
}

/** 一筆檢舉：被檢舉的留言（已刪除時為 undefined） */
interface AdminReport {
  id: string
  path: string
  uid: string
  reason?: string
  createdAt: number
  comment?: AdminComment
}

/**
 * 管理（/admin）：檢舉（刪除留言或忽略）、所有留言（新到舊，可刪除）、地圖回報（/reports 直接開這一頁）。
 * 入口只顯示給管理員（src/admin.ts）；刪除、讀檢舉的權限由資料庫規則把關。
 */
export function AdminPage({ data, initialTab = 'reports' }: { data: LoadedData; initialTab?: AdminTab }) {
  const { lang, t } = useLang()
  const cloud = useCloud()
  const admin = useIsAdmin()
  const [profiles, setProfiles] = useState<Record<string, { name: string; updatedAt: string }>>({})
  const [comments, setComments] = useState<AdminComment[]>()
  const [reports, setReports] = useState<AdminReport[]>()
  const [tab, setTab] = useState<AdminTab>(initialTab)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()

  const load = async () => {
    setError(undefined)
    try {
      const { m } = await withCloud()
      const { comments: raw, reports: reported, profiles: names } = await m.loadAdminData()
      setProfiles(Object.fromEntries(Object.entries(names).map(([uid, p]) => [uid, { name: p.name, updatedAt: '' }])))
      const all = Object.entries(raw)
        .flatMap(([routeKey, list]) => Object.entries(list).map(([id, c]) => ({ ...c, id, routeKey, path: `v2/comments/${routeKey}/${id}` })))
        .sort((a, b) => b.createdAt - a.createdAt)
      const byPath = new Map(all.map((c) => [c.path, c]))
      setComments(all)
      setReports(
        Object.entries(reported)
          .map(([id, r]) => ({ id, ...r, comment: byPath.get(r.path) }))
          .sort((a, b) => b.createdAt - a.createdAt),
      )
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    if (admin) void load()
  }, [admin])

  /** 刪除留言，連同檢舉這則留言的紀錄 */
  const removeComment = async (c: AdminComment) => {
    if (!confirm(t('admin.confirmDelete', { text: c.text.slice(0, 40) }))) return
    setBusy(c.path)
    try {
      const { m } = await withCloud()
      await m.adminDelete([c.path, ...(reports ?? []).filter((r) => r.path === c.path).map((r) => `v2/reports/${r.id}`)])
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  /** 忽略檢舉（留言保留） */
  const dismiss = async (r: AdminReport) => {
    setBusy(r.id)
    try {
      const { m } = await withCloud()
      await m.adminDelete([`v2/reports/${r.id}`])
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  const time = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  /** routeKey（longdong:jar2yu）→ 路線名稱與連結 */
  const routeOf = (routeKey: string) => {
    const ref = data.routeById.get(routeKey.replace(':', '/'))
    return ref ? { name: `${ref.route.number ? `#${ref.route.number} ` : ''}${localName(ref.route.name, lang).main}`, href: href.route(ref.route.id) } : { name: routeKey, href: undefined }
  }

  const commentCard = (c: AdminComment, extra?: ReactNode) => {
    const route = routeOf(c.routeKey)
    return (
      <>
        <p className="admin-meta small">
          {route.href ? <a href={route.href}>{route.name}</a> : route.name}
          <span className="muted">
            {' · '}
            {displayName(profiles, c.uid)} · {time(c.createdAt)}
            {c.hidden && ` · ${t('admin.hidden')}`}
          </span>
        </p>
        <p className="admin-text">{c.text}</p>
        <div className="admin-actions">
          {extra}
          <button type="button" className="action danger" disabled={busy === c.path} onClick={() => void removeComment(c)}>
            {t('admin.deleteComment')}
          </button>
        </div>
      </>
    )
  }

  return (
    <article className={`admin${tab === 'map' ? ' admin-map' : ''}`}>
      <h1>{t('admin.title')}</h1>
      {cloud.status !== 'signed-in' ? (
        <SignInPrompt message={t('reports.signIn')} />
      ) : admin === undefined ? (
        <p className="muted">{t('app.loading')}</p>
      ) : !admin ? (
        <p className="muted">{t('reports.notAdmin')}</p>
      ) : (
        <>
          <div className="segmented admin-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'reports'} onClick={() => setTab('reports')}>
              {t('admin.reports')}
              {reports && reports.length > 0 && <span className="admin-count">{reports.length}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'comments'} onClick={() => setTab('comments')}>
              {t('admin.comments')}
              {comments && <span className="admin-count muted">{comments.length}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'map'} onClick={() => setTab('map')}>
              {t('admin.mapReports')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'topos'} onClick={() => setTab('topos')}>
              {t('admin.topos')}
            </button>
          </div>
          {tab === 'map' && <MapReports data={data} profiles={profiles} />}
          {tab === 'topos' && <TopoAdmin data={data} profiles={profiles} time={time} />}

          {error && (
            <p className="error" role="alert">
              {t('reports.loadFailed', { error })}
            </p>
          )}
          {!error && (tab === 'reports' || tab === 'comments') && (!comments || !reports) && <p className="muted">{t('app.loading')}</p>}

          {tab === 'reports' && reports && (
            <ul className="admin-list">
              {reports.length === 0 && <li className="muted">{t('admin.noReports')}</li>}
              {reports.map((r) => (
                <li key={r.id}>
                  <p className="admin-report small">
                    <strong>{t('admin.reportedBy', { name: displayName(profiles, r.uid), time: time(r.createdAt) })}</strong>
                    {r.reason && <span>「{r.reason}」</span>}
                  </p>
                  {r.comment ? (
                    commentCard(
                      r.comment,
                      <button type="button" className="action" disabled={busy === r.id} onClick={() => void dismiss(r)}>
                        {t('admin.dismiss')}
                      </button>,
                    )
                  ) : (
                    <div className="admin-actions">
                      <span className="muted small">{t('admin.commentGone')}</span>
                      <button type="button" className="action" disabled={busy === r.id} onClick={() => void dismiss(r)}>
                        {t('admin.dismiss')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {tab === 'comments' && comments && (
            <ul className="admin-list">
              {comments.length === 0 && <li className="muted">{t('admin.noComments')}</li>}
              {comments.map((c) => (
                <li key={c.path}>{commentCard(c)}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  )
}
