import { useEffect, useState } from 'react'
import { relativeTime } from '../format'
import { useLang, type MessageKey } from '../i18n'
import { useCloud } from '../personal/sync'
import { postComment, rate, removeComment, report } from '../social/actions'
import { COMMENT_MAX, FEELS, routeKey, summarize, type Feel } from '../social/model'
import { displayName, useComments, useSocial } from '../social/store'
import { StarPicker } from './Stars'

/** 頭像底色：依使用者固定一個顏色 */
const AVATAR_COLORS = ['#0395c3', '#e0723a', '#1f7a45', '#7c4dbe', '#c2410c', '#0a6f90', '#b23a6b']
function avatarColor(uid: string): string {
  let h = 0
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** 一開始顯示幾則留言，其餘按「顯示全部」 */
const SHOWN = 5

const Avatar = ({ uid, name }: { uid: string; name: string }) => (
  <span className="avatar" style={{ background: avatarColor(uid) }} aria-hidden>
    {[...name][0]?.toUpperCase()}
  </span>
)

type ErrorKey = Extract<MessageKey, 'rating.saveError' | 'rating.deleteError' | 'comments.sendError' | 'comments.deleteError' | 'comments.reportError'>

/**
 * 評價與留言（社群 App 的做法）：上面是大字平均與分佈、體感難度；
 * 登入後在頭像旁邊直接打分、寫留言（一個輸入框）；留言按時間排，名字旁邊帶這個人給的星等與體感，
 * 刪除、檢舉收在每則留言的「⋯」。留言太多時先顯示最新幾則。
 * 固定點（rateable 為 false）沒有評分，只有留言。
 */
export function ReviewsSection({ routeId, rateable }: { routeId: string; rateable: boolean }) {
  const social = useSocial()
  const comments = useComments(routeId)
  const cloud = useCloud()
  const { t } = useLang()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const ratings = social.ratings[routeKey(routeId)]
  const summary = summarize(ratings)
  const mine = uid ? ratings?.[uid] : undefined
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [all, setAll] = useState(false)
  const [menu, setMenu] = useState<string>()

  // 點選單外面關閉
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => !(e.target as Element).closest('.comment-menu') && setMenu(undefined)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  const run = async (action: () => Promise<void>, errorKey: ErrorKey) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (err) {
      setError(t(errorKey, { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }
  const save = (stars: number, feel: Feel | undefined) => run(() => rate(routeId, { stars, ...(feel ? { feel } : {}) }), 'rating.saveError')
  const send = () => {
    if (!navigator.onLine) return setError(t('comments.offline'))
    void run(async () => {
      await postComment(routeId, text)
      setText('')
    }, 'comments.sendError')
  }
  const onDelete = (id: string) => {
    setMenu(undefined)
    if (confirm(t('comments.confirmDelete'))) void run(() => removeComment(routeId, id), 'comments.deleteError')
  }
  const onReport = (id: string) => {
    setMenu(undefined)
    const reason = prompt(t('comments.reportPrompt'))
    if (reason === null) return
    void run(async () => {
      await report(routeId, id, reason)
      alert(t('comments.reported'))
    }, 'comments.reportError')
  }

  const feelTotal = summary ? summary.feel.soft + summary.feel.fair + summary.feel.hard : 0
  const shown = comments && !all ? comments.slice(0, SHOWN) : comments
  const me = uid ? displayName(social.profiles, uid) : ''

  return (
    <section className="reviews">
      <h2>
        {t('reviews.title')}
        {comments && comments.length > 0 && <span className="muted"> {comments.length}</span>}
      </h2>

      {rateable &&
        (summary ? (
          <>
            <div className="rating-m-summary">
              <div className="rating-m-average">
                <strong>{summary.average.toFixed(1)}</strong>
                <span className="stars-static" aria-hidden>
                  {'★★★★★'.slice(0, Math.round(summary.average))}
                  <span className="dim">{'★★★★★'.slice(Math.round(summary.average))}</span>
                </span>
                <span className="muted small">{t('rating.count', { n: summary.count })}</span>
              </div>
              <ul className="rating-m-bars" aria-label={t('rating.barsAria')}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <li key={n} title={`${n}★ ${summary.stars[n - 1]}`}>
                    <span>{n}</span>
                    <span className="bar">
                      <span style={{ width: `${(summary.stars[n - 1] / summary.count) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {feelTotal > 0 && (
              <div className="rating-m-feel" role="img" aria-label={`${t('rating.feelAria')}：${FEELS.map((f) => `${t(`feel.${f}`)} ${summary.feel[f]}`).join('、')}`}>
                {FEELS.filter((f) => summary.feel[f] > 0).map((f) => (
                  <span key={f} className={`feel-${f}`} style={{ flexGrow: summary.feel[f] }}>
                    {t(`feel.${f}`)} {summary.feel[f]}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted small">{social.ratingsLoaded ? t('rating.none') : t('app.loading')}</p>
        ))}

      {uid && (
        <div className="review-compose">
          <Avatar uid={uid} name={me} />
          <div className="review-compose-body">
            {rateable && (
              <div className="review-rate">
                <span className="muted small">{mine ? t('rating.yours') : t('rating.ask')}</span>
                <StarPicker value={mine?.stars ?? 0} disabled={busy} onChange={(stars) => void save(stars, mine?.feel)} />
                {mine && (
                  <div className="chips" role="group" aria-label={t('rating.feelAria')}>
                    {FEELS.map((f) => (
                      <button key={f} type="button" className="chip" aria-pressed={mine.feel === f} disabled={busy} onClick={() => void save(mine.stars, mine.feel === f ? undefined : f)}>
                        {t(`feel.${f}`)}
                      </button>
                    ))}
                    <button type="button" className="link-button small" onClick={() => void run(() => rate(routeId, null), 'rating.deleteError')} disabled={busy}>
                      {t('rating.delete')}
                    </button>
                  </div>
                )}
              </div>
            )}
            <form
              className="comment-m-form"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <textarea rows={1} maxLength={COMMENT_MAX} placeholder={t('comments.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
              <button type="submit" className="send" disabled={busy || !text.trim()} aria-label={t('comments.send')} title={t('comments.send')}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                  <path d="M3 20l18-8L3 4v6l12 2-12 2z" fill="currentColor" />
                </svg>
              </button>
            </form>
            {text.length > COMMENT_MAX * 0.8 && (
              <p className="muted small">
                {text.length}/{COMMENT_MAX}
              </p>
            )}
          </div>
        </div>
      )}
      {error && <p className="small error">{error}</p>}

      {shown === undefined ? (
        <p className="muted small">{t('app.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="muted small">{t('comments.none')}</p>
      ) : (
        <ul className="comment-m-list">
          {shown.map((c) => {
            const who = displayName(social.profiles, c.uid)
            const given = ratings?.[c.uid]
            return (
              <li key={c.id}>
                <Avatar uid={c.uid} name={who} />
                <div>
                  <div className="comment-m-meta">
                    <strong>{who}</strong>
                    {given && (
                      <span className="comment-rated">
                        ★{given.stars}
                        {given.feel && ` · ${t(`feel.${given.feel}`)}`}
                      </span>
                    )}
                    <span>{relativeTime(new Date(c.createdAt).toISOString(), t)}</span>
                    {uid && (
                      <span className="comment-menu">
                        <button
                          type="button"
                          className="comment-menu-button"
                          aria-label={t('comments.menu')}
                          aria-haspopup="menu"
                          aria-expanded={menu === c.id}
                          onClick={() => setMenu(menu === c.id ? undefined : c.id)}
                        >
                          ⋯
                        </button>
                        {menu === c.id && (
                          <span className="comment-menu-list" role="menu">
                            {uid === c.uid ? (
                              <button type="button" role="menuitem" onClick={() => onDelete(c.id)}>
                                {t('comments.delete')}
                              </button>
                            ) : (
                              <button type="button" role="menuitem" onClick={() => onReport(c.id)}>
                                {t('comments.report')}
                              </button>
                            )}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="pre">{c.text}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {comments && comments.length > SHOWN && !all && (
        <button type="button" className="comment-more" onClick={() => setAll(true)}>
          {t('comments.all', { n: comments.length })}
        </button>
      )}
    </section>
  )
}
