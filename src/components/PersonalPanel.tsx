import { useState, type ReactNode } from 'react'
import type { Route } from '../data/schema'
import { formatDate } from '../format'
import { useLang } from '../i18n'
import { deleteTick, setFavorite, usePersonal } from '../personal/store'
import { TickSheet } from './TickSheet'

/**
 * 路線頁的按鈕列：第一層是常用的（收藏、分享、更多），第二層「更多」展開才看到（記錄攀登、回報位置）；
 * 已經有的攀登紀錄列在下面。沒登入或個人資料讀不到時沒有收藏與記錄攀登，只剩分享與回報位置。
 * share、report 是分享與回報位置的按鈕（各自有自己的選單與視窗）。
 */
export function PersonalPanel({ route, signedIn, share, report }: { route: Route; signedIn: boolean; share: ReactNode; report: ReactNode }) {
  const personal = usePersonal()
  const { t } = useLang()
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState(false)
  const mine = signedIn && !route.isFixture && !personal.error
  const favorite = personal.favorites.has(route.id)
  const ticks = mine ? personal.ticks.filter((x) => x.routeId === route.id) : []

  return (
    <section className="personal">
      <div className="route-actions">
        <div className="route-actions-main">
          {mine && (
            <button
              type="button"
              className={`action icon-action${favorite ? ' on' : ''}`}
              aria-pressed={favorite}
              onClick={() => setFavorite(route.id, !favorite)}
              disabled={!personal.ready}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
                <path
                  d="M12 21s-7-4.4-9.5-9C.8 8.6 3 5 6.5 5c2 0 3.5 1.2 5.5 3 2-1.8 3.5-3 5.5-3C21 5 23.2 8.6 21.5 12 19 16.6 12 21 12 21z"
                  fill={favorite ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              {favorite ? t('fav.on') : t('fav.off')}
            </button>
          )}
          {share}
          <button type="button" className="action icon-action route-more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <circle cx="5" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <circle cx="19" cy="12" r="2" fill="currentColor" />
            </svg>
            {t('route.actionsMore')}
          </button>
        </div>
        {more && (
          <div className="route-actions-sub">
            {mine && (
              <button type="button" className="action icon-action" onClick={() => setOpen(true)} disabled={!personal.ready || open}>
                {t('tick.add')}
              </button>
            )}
            {report}
          </div>
        )}
      </div>

      {mine && <TickSheet route={route} open={open} onClose={() => setOpen(false)} />}

      {ticks.length > 0 && (
        <ul className="my-ticks">
          {ticks.map((tick) => (
            <li key={tick.id}>
              <span className="tick-date">{formatDate(tick.date)}</span>
              <span className={`tick-style style-${tick.style}`}>{t(`style.${tick.style}`)}</span>
              {tick.note && <span className="tick-note">{tick.note}</span>}
              <button
                className="link-button"
                aria-label={t('tick.deleteAria')}
                onClick={() => confirm(t('tick.confirmDelete')) && deleteTick(tick.id)}
              >
                {t('tick.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
