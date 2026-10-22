import { useState } from 'react'
import { useCloud } from '../personal/sync'
import { postComment, removeComment, report } from '../social/actions'
import { useLang } from '../i18n'
import { COMMENT_MAX } from '../social/model'
import { displayName, useComments, useSocial } from '../social/store'
import { relativeTime } from '../format'

/** 頭像底色：依使用者固定一個顏色 */
const AVATAR_COLORS = ['#0395c3', '#e0723a', '#1f7a45', '#7c4dbe', '#c2410c', '#0a6f90', '#b23a6b']
function avatarColor(uid: string): string {
  let h = 0
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function CommentsSection({ routeId }: { routeId: string }) {
  const comments = useComments(routeId)
  const social = useSocial()
  const cloud = useCloud()
  const { t } = useLang()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    if (!navigator.onLine) {
      setError(t('comments.offline'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await postComment(routeId, text)
      setText('')
    } catch (err) {
      setError(t('comments.sendError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    if (!confirm(t('comments.confirmDelete'))) return
    try {
      await removeComment(routeId, id)
    } catch (err) {
      setError(t('comments.deleteError', { error: (err as Error).message }))
    }
  }

  const onReport = async (id: string) => {
    const reason = prompt(t('comments.reportPrompt'))
    if (reason === null) return
    try {
      await report(routeId, id, reason)
      alert(t('comments.reported'))
    } catch (err) {
      setError(t('comments.reportError', { error: (err as Error).message }))
    }
  }

  // 手機版：頭像＋名字＋多久以前，下方是內容；輸入框在最下面，右邊一個送出鈕
  return (
    <section className="comments comments-m">
      <h2>
        {t('comments.title')}
        {comments && comments.length > 0 && <span className="muted"> {comments.length}</span>}
      </h2>
      {comments === undefined ? (
        <p className="muted small">{t('app.loading')}</p>
      ) : comments.length === 0 ? (
        <p className="muted small">{t('comments.none')}</p>
      ) : (
        <ul className="comment-m-list">
          {comments.map((c) => {
            const who = displayName(social.profiles, c.uid)
            return (
              <li key={c.id}>
                <span className="avatar" style={{ background: avatarColor(c.uid) }} aria-hidden>
                  {[...who][0]?.toUpperCase()}
                </span>
                <div>
                  <div className="comment-m-meta">
                    <strong>{who}</strong>
                    <span>{relativeTime(new Date(c.createdAt).toISOString(), t)}</span>
                    {uid === c.uid ? (
                      <button className="link-button" onClick={() => void onDelete(c.id)}>
                        {t('comments.delete')}
                      </button>
                    ) : (
                      uid && (
                        <button className="link-button" onClick={() => void onReport(c.id)}>
                          {t('comments.report')}
                        </button>
                      )
                    )}
                  </div>
                  <p className="pre">{c.text}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {uid && (
        <form
          className="comment-m-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <textarea rows={1} maxLength={COMMENT_MAX} placeholder={t('comments.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="send" disabled={busy || !text.trim()} aria-label={t('comments.send')} title={t('comments.send')}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M3 20l18-8L3 4v6l12 2-12 2z" fill="currentColor" />
            </svg>
          </button>
        </form>
      )}
      {uid && text.length > COMMENT_MAX * 0.8 && <p className="muted small">{text.length}/{COMMENT_MAX}</p>}
      {error && <p className="small error">{error}</p>}
    </section>
  )
}
