import { useEffect, useState } from 'react'
import type { RouteRef } from '../data/dataset'
import { useLang } from '../i18n'
import { canSystemShare, copy, currentRouteUrl, shareText, systemShare, targetUrl, type ShareTarget } from '../share'

/** fb-messenger:// 只有手機 App 能開 */
const isPhone = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

const TARGETS: { target: ShareTarget; label: string; badge: string; phoneOnly?: boolean }[] = [
  { target: 'line', label: 'LINE', badge: 'L' },
  { target: 'facebook', label: 'Facebook', badge: 'f' },
  { target: 'messenger', label: 'Messenger', badge: 'm', phoneOnly: true },
]

/** 路線頁「更多」選單裡的分享選項（LINE、Facebook、Messenger、複製連結、更多…）；onDone：分享動作送出後（關閉選單） */
export function ShareItems({ item, onDone }: { item: RouteRef; onDone: () => void }) {
  const { lang, t } = useLang()
  const [status, setStatus] = useState<'copied' | 'failed'>()

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(undefined), 2500)
    return () => clearTimeout(timer)
  }, [status])

  const url = currentRouteUrl(item.route.id)
  const text = shareText(item, lang, t)

  const goTo = (target: ShareTarget) => {
    const link = targetUrl(target, url, text)
    onDone()
    // 網頁分享頁開新分頁；App 的網址（fb-messenger://）直接切換過去
    if (link.startsWith('https:')) window.open(link, '_blank', 'noopener')
    else location.href = link
  }

  return (
    <>
      {TARGETS.filter((x) => !x.phoneOnly || isPhone()).map((x) => (
        <button key={x.target} type="button" role="menuitem" className="share-item" onClick={() => goTo(x.target)}>
          <span className={`share-badge ${x.target}`} aria-hidden>
            {x.badge}
          </span>
          {x.label}
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        className="share-item"
        onClick={() => void copy(text, url).then(() => setStatus('copied'), () => setStatus('failed'))}
      >
        <span className="share-badge plain" aria-hidden>
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path
              d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        {status ? t(status === 'copied' ? 'share.copied' : 'share.failed') : t('share.copy')}
      </button>
      {canSystemShare() && (
        <button
          type="button"
          role="menuitem"
          className="share-item"
          onClick={() => {
            onDone()
            void systemShare(text, url).catch(() => undefined)
          }}
        >
          <span className="share-badge plain" aria-hidden>
            <svg viewBox="0 0 24 24" width="16" height="16">
              <circle cx="5" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <circle cx="19" cy="12" r="2" fill="currentColor" />
            </svg>
          </span>
          {t('share.more')}
        </button>
      )}
    </>
  )
}
