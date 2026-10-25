import { useEffect, useRef, useState } from 'react'
import type { RouteRef } from '../data/dataset'
import { useLang, type MessageKey } from '../i18n'
import { canSystemShare, copy, currentRouteUrl, shareText, systemShare, targetUrl, type ShareTarget } from '../share'

/** fb-messenger:// 只有手機 App 能開 */
const isPhone = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

const TARGETS: { target: ShareTarget; label: string; badge: string; phoneOnly?: boolean }[] = [
  { target: 'line', label: 'LINE', badge: 'L' },
  { target: 'facebook', label: 'Facebook', badge: 'f' },
  { target: 'messenger', label: 'Messenger', badge: 'm', phoneOnly: true },
]

type Status = 'copied' | 'failed'

/** 路線頁的分享按鈕：展開分享選單（LINE、Facebook、Messenger、複製連結、更多…） */
export function ShareButton({ item }: { item: RouteRef }) {
  const { lang, t } = useLang()
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const [status, setStatus] = useState<Status>()
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(undefined), 2500)
    return () => clearTimeout(timer)
  }, [status])

  // 點選單外面或按 Esc 關閉
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    // 按鈕靠右時選單往左展開，不超出畫面
    const rect = box.current?.getBoundingClientRect()
    setAlignRight(!!rect && rect.left + 240 > window.innerWidth - 16)
    setOpen((o) => !o)
  }

  const url = currentRouteUrl(item.route.id)
  const text = shareText(item, lang, t)

  const run = async (action: () => Promise<Status | void>) => {
    setOpen(false)
    try {
      const result = await action()
      if (result) setStatus(result)
    } catch {
      setStatus('failed')
    }
  }

  const goTo = (target: ShareTarget) =>
    run(async () => {
      const link = targetUrl(target, url, text)
      // 網頁分享頁開新分頁；App 的網址（fb-messenger://）直接切換過去
      if (link.startsWith('https:')) window.open(link, '_blank', 'noopener')
      else location.href = link
    })

  const label: Record<Status, MessageKey> = { copied: 'share.copied', failed: 'share.failed' }

  return (
    <span className="share" ref={box}>
      <button type="button" className="fact share-button" aria-label={t('share.button')} title={t('share.button')} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
          <path
            d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {status && (
        <span className="share-status" role="status">
          {t(label[status])}
        </span>
      )}
      {open && (
        <span className={`share-menu${alignRight ? ' right' : ''}`} role="menu">
          {TARGETS.filter((x) => !x.phoneOnly || isPhone()).map((x) => (
            <button key={x.target} type="button" role="menuitem" onClick={() => void goTo(x.target)}>
              <span className={`share-badge ${x.target}`} aria-hidden>
                {x.badge}
              </span>
              {x.label}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => void run(async () => (await copy(text, url), 'copied'))}>
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
            {t('share.copy')}
          </button>
          {canSystemShare() && (
            <button type="button" role="menuitem" onClick={() => void run(() => systemShare(text, url))}>
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
        </span>
      )}
    </span>
  )
}
