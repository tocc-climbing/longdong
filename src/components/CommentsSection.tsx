import { useState } from 'react'
import { useCloud } from '../personal/sync'
import { postComment, removeComment, report } from '../social/actions'
import { useLang } from '../i18n'
import { COMMENT_MAX } from '../social/model'
import { displayName, useComments, useSocial } from '../social/store'

export function CommentsSection({ routeId }: { routeId: string }) {
  const comments = useComments(routeId)
  const social = useSocial()
  const cloud = useCloud()
  const { lang, t } = useLang()
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

  return (
    <section className="comments">
      <h2>{t('comments.title')}{comments && comments.length > 0 && <span className="muted small"> {comments.length}</span>}</h2>

      {uid && (
        <form
          className="comment-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <textarea
            rows={3}
            maxLength={COMMENT_MAX}
            placeholder={t('comments.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="comment-form-row">
            <span className="muted small">
              {t('comments.postingAs', { name: displayName(social.profiles, uid), count: text.length, max: COMMENT_MAX })}
            </span>
            <button type="submit" className="action primary" disabled={busy || !text.trim()}>
              {t('comments.send')}
            </button>
          </div>
          {error && <p className="small error">{error}</p>}
        </form>
      )}

      {comments === undefined ? (
        <p className="muted small">{t('app.loading')}</p>
      ) : comments.length === 0 ? (
        <p className="muted small">{t('comments.none')}</p>
      ) : (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="comment-meta">
                <strong>{displayName(social.profiles, c.uid)}</strong>
                <span className="muted small">{new Date(c.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en')}</span>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
