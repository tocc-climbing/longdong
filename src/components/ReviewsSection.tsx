import { useEffect, useRef, useState } from 'react'
import { relativeTime } from '../format'
import { useLang, type MessageKey } from '../i18n'
import { sendStyle, SEND_SHORT } from '../personal/stats'
import { usePersonal } from '../personal/store'
import { useCloud } from '../personal/sync'
import { postComment, rate, removeComment, report, toggleLike } from '../social/actions'
import { COMMENT_MAX, FEELS, routeKey, summarize, type Comment, type Feel } from '../social/model'
import { displayName, useComments, useSocial } from '../social/store'
import { SentPicker } from './SentPicker'
import { Sheet } from './Sheet'
import { StarPicker } from './Stars'

/** 頭像底色：依使用者固定一個顏色 */
const AVATAR_COLORS = ['#0395c3', '#e0723a', '#1f7a45', '#7c4dbe', '#c2410c', '#0a6f90', '#b23a6b']
function avatarColor(uid: string): string {
  let h = 0
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

const Avatar = ({ uid, name }: { uid: string; name: string }) => (
  <span className="avatar" style={{ background: avatarColor(uid) }} aria-hidden>
    {[...name][0]?.toUpperCase()}
  </span>
)

type ErrorKey = Extract<MessageKey, 'rating.saveError' | 'rating.deleteError' | 'comments.sendError' | 'comments.deleteError' | 'comments.reportError'>

const Heart = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path
      d="M12 21s-7-4.4-9.5-9C.8 8.6 3 5 6.5 5c2 0 3.5 1.2 5.5 3 2-1.8 3.5-3 5.5-3C21 5 23.2 8.6 21.5 12 19 16.6 12 21 12 21z"
      fill={on ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
)

const StarIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
      fill={on ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
)

const CommentIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <path
      d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
)

const SentIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** 記錄攀登：月曆加號 */
const LogIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4M12 12.5v5M9.5 15h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path d="M3 20l18-8L3 4v6l12 2-12 2z" fill="currentColor" />
  </svg>
)

/** 送出評分、留言等：送出中停用按鈕，失敗時顯示錯誤 */
function useRun() {
  const { t } = useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
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
  return { busy, error, setError, run }
}

export type ReviewsSheet = 'rating' | 'comments' | 'sent'

/**
 * 評價與留言（像 IG 貼文下方）：只有圖示與數字（★ 平均星等、留言數），下面是最新一則留言的預覽。
 * 點星星從下方滑出評分（分佈、體感難度、自己打分），點留言圖示或預覽滑出留言（新的在下面，輸入框在最下方）。
 * 固定點（rateable 為 false）沒有評分，只有留言。sheet：目前打開的（標題卡上的星等也會打開評分）。
 * info：說明以外的路線資料，有的話留言右邊多一個 ⓘ，點了從下方滑出。
 */
export function ReviewsBar({
  routeId,
  rateable,
  sheet,
  onSheet,
  onLog,
}: {
  routeId: string
  rateable: boolean
  sheet?: ReviewsSheet
  onSheet: (sheet: ReviewsSheet | undefined) => void
  /** 打開記錄攀登的視窗；有值時才顯示完攀與記錄攀登（登入、不是固定點） */
  onLog?: () => void
}) {
  const social = useSocial()
  const comments = useComments(routeId)
  const { t } = useLang()
  const summary = summarize(social.ratings[routeKey(routeId)])
  const top = (comments ?? []).filter((c) => !c.parent)
  // 留言由新到舊（social/store.ts）
  const latest = top[0]
  const personal = usePersonal()
  const sent = onLog && sendStyle(personal.ticks, personal.best, routeId)
  return (
    <div className="reviews-bar">
      <div className="reviews-bar-icons">
        {rateable && (
          <button type="button" className={`reviews-icon rating${summary ? ' rated' : ''}`} aria-label={t('rating.title')} onClick={() => onSheet('rating')}>
            <StarIcon on={!!summary} />
            {summary && <span>{summary.average.toFixed(1)}</span>}
          </button>
        )}
        <button type="button" className="reviews-icon comments" aria-label={t('comments.title')} onClick={() => onSheet('comments')}>
          <CommentIcon />
          {top.length > 0 && <span>{top.length}</span>}
        </button>
        {onLog && (
          <>
            <button
              type="button"
              className={`reviews-icon sent${sent ? ` on style-${SEND_SHORT[sent].toLowerCase()}` : ''}`}
              aria-label={t('sent.title')}
              onClick={() => onSheet('sent')}
            >
              <SentIcon />
              {sent && <span>{SEND_SHORT[sent]}</span>}
            </button>
            <button type="button" className="reviews-icon log" aria-label={t('tick.menu')} disabled={!personal.ready} onClick={onLog}>
              <LogIcon />
            </button>
          </>
        )}
      </div>
      {latest && (
        <button type="button" className="reviews-latest" onClick={() => onSheet('comments')}>
          <strong>{displayName(social.profiles, latest.uid)}</strong> {latest.text}
        </button>
      )}
      {rateable && (
        <Sheet open={sheet === 'rating'} onClose={() => onSheet(undefined)} title={t('rating.title')}>
          <RatingPanel routeId={routeId} />
        </Sheet>
      )}
      <Sheet open={sheet === 'comments'} onClose={() => onSheet(undefined)} title={t('comments.title')} className="comments-sheet">
        <CommentsPanel routeId={routeId} />
      </Sheet>
      {onLog && (
        <Sheet open={sheet === 'sent'} onClose={() => onSheet(undefined)} title={t('sent.title')}>
          <SentPicker routeId={routeId} label={t('sent.title')} />
        </Sheet>
      )}
    </div>
  )
}

/** 評分：大字平均與各星等人數、體感難度；登入後直接點星星打分（再點一次同一顆是取消）、選體感 */
function RatingPanel({ routeId }: { routeId: string }) {
  const social = useSocial()
  const cloud = useCloud()
  const { t } = useLang()
  const { busy, error, run } = useRun()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const ratings = social.ratings[routeKey(routeId)]
  const summary = summarize(ratings)
  const mine = uid ? ratings?.[uid] : undefined
  const save = (stars: number, feel: Feel | undefined) => run(() => rate(routeId, { stars, ...(feel ? { feel } : {}) }), 'rating.saveError')
  const feelTotal = summary ? summary.feel.soft + summary.feel.fair + summary.feel.hard : 0
  return (
    <div className="reviews">
      {summary && (
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
      )}
      {uid && (
        <div className="review-rate">
          <StarPicker
            value={mine?.stars ?? 0}
            disabled={busy}
            onChange={(stars) => void (stars === mine?.stars ? run(() => rate(routeId, null), 'rating.deleteError') : save(stars, mine?.feel))}
          />
          {mine && (
            <div className="chips" role="group" aria-label={t('rating.feelAria')}>
              {FEELS.map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={mine.feel === f} disabled={busy} onClick={() => void save(mine.stars, mine.feel === f ? undefined : f)}>
                  {t(`feel.${f}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="small error">{error}</p>}
    </div>
  )
}

/**
 * 留言（像 IG 的留言視窗）：由舊到新，新的在下面、打開時捲到最下面；登入後輸入框固定在最下方。
 * 名字旁邊帶這個人給的星等與體感，刪除、檢舉收在每則留言的「⋯」，讚與回覆在內容下面。
 */
function CommentsPanel({ routeId }: { routeId: string }) {
  const social = useSocial()
  const comments = useComments(routeId)
  const cloud = useCloud()
  const { t } = useLang()
  const { busy, error, setError, run } = useRun()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const ratings = social.ratings[routeKey(routeId)]
  const [text, setText] = useState('')
  const [menu, setMenu] = useState<string>()
  /** 正在回覆哪一則、回覆的內容；展開了回覆的留言 */
  const [replyTo, setReplyTo] = useState<string>()
  const [replyText, setReplyText] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const end = useRef<HTMLDivElement>(null)

  // 點選單外面關閉
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => !(e.target as Element).closest('.comment-menu') && setMenu(undefined)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  const top = comments?.filter((c) => !c.parent).reverse()
  // 打開、送出新留言後捲到最下面（最新的一則）；scrollIntoView 在新版瀏覽器會回傳 Promise，不能當成 effect 的回傳值
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [top?.length])

  const send = () => {
    if (!navigator.onLine) return setError(t('comments.offline'))
    void run(async () => {
      await postComment(routeId, text)
      setText('')
    }, 'comments.sendError')
  }
  const sendReply = (parent: string) => {
    if (!navigator.onLine) return setError(t('comments.offline'))
    void run(async () => {
      await postComment(routeId, replyText, parent)
      setReplyText('')
      setReplyTo(undefined)
      setOpen((o) => new Set(o).add(parent))
    }, 'comments.sendError')
  }
  const like = (id: string, on: boolean) => void run(() => toggleLike(routeId, id, on), 'comments.sendError')
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

  const likes = social.likes[routeKey(routeId)] ?? {}
  const repliesOf = (id: string) => (comments ?? []).filter((c) => c.parent === id).sort((a, b) => a.createdAt - b.createdAt)
  const me = uid ? displayName(social.profiles, uid) : ''

  /** 一則留言或回覆：頭像、名字（帶星等與體感）、時間、「⋯」選單、內容、讚與回覆 */
  const commentBody = (c: Comment, isReply = false) => {
    const who = displayName(social.profiles, c.uid)
    const given = ratings?.[c.uid]
    const likers = likes[c.id] ?? []
    const liked = !!uid && likers.includes(uid)
    return (
      <div className="comment-item">
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
          <div className="comment-actions">
            {uid ? (
              <button type="button" className="comment-like" aria-pressed={liked} aria-label={t('comments.like')} disabled={busy} onClick={() => like(c.id, !liked)}>
                <Heart on={liked} />
                {likers.length > 0 && <span>{likers.length}</span>}
              </button>
            ) : (
              likers.length > 0 && (
                <span className="comment-like static">
                  <Heart on={false} />
                  <span>{likers.length}</span>
                </span>
              )
            )}
            {uid && !isReply && (
              <button type="button" className="comment-reply-button" onClick={() => (setReplyTo(replyTo === c.id ? undefined : c.id), setReplyText(''))}>
                {t('comments.reply')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="reviews">
      {top === undefined ? (
        <p className="muted small">{t('app.loading')}</p>
      ) : (
        top.length > 0 && (
          <ul className="comment-m-list">
            {top.map((c) => {
              const replies = repliesOf(c.id)
              const expanded = open.has(c.id)
              return (
                <li key={c.id}>
                  {commentBody(c)}
                  {replies.length > 0 && (
                    <button
                      type="button"
                      className="comment-thread-toggle"
                      aria-expanded={expanded}
                      onClick={() => setOpen((o) => (o.has(c.id) ? new Set([...o].filter((x) => x !== c.id)) : new Set(o).add(c.id)))}
                    >
                      {expanded ? t('comments.hideReplies') : t('comments.viewReplies', { n: replies.length })}
                    </button>
                  )}
                  {(expanded || replyTo === c.id) && (
                    <div className="comment-replies">
                      {expanded &&
                        replies.map((r) => (
                          <div key={r.id} className="comment-reply">
                            {commentBody(r, true)}
                          </div>
                        ))}
                      {replyTo === c.id && (
                        <form
                          className="comment-m-form reply-form"
                          onSubmit={(e) => {
                            e.preventDefault()
                            sendReply(c.id)
                          }}
                        >
                          <textarea
                            rows={1}
                            autoFocus
                            maxLength={COMMENT_MAX}
                            placeholder={t('comments.replyPlaceholder', { name: displayName(social.profiles, c.uid) })}
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                          />
                          {replyText.trim() && (
                            <button type="submit" className="send" disabled={busy} aria-label={t('comments.send')} title={t('comments.send')}>
                              <SendIcon />
                            </button>
                          )}
                        </form>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )
      )}
      <div ref={end} />
      {error && <p className="small error">{error}</p>}
      {uid && (
        <div className="review-compose">
          <Avatar uid={uid} name={me} />
          <form
            className="comment-m-form"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <textarea rows={1} maxLength={COMMENT_MAX} aria-label={t('comments.title')} value={text} onChange={(e) => setText(e.target.value)} />
            {/* 打了字才出現送出鍵 */}
            {text.trim() && (
              <button type="submit" className="send" disabled={busy} aria-label={t('comments.send')} title={t('comments.send')}>
                <SendIcon />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
