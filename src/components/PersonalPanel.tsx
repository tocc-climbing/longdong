import { useState, type ReactNode } from 'react'
import type { Route } from '../data/schema'
import { formatDate } from '../format'
import { useLang } from '../i18n'
import { deleteTick, setFavorite, usePersonal } from '../personal/store'
import { TickSheet } from './TickSheet'

/** 路線頁上的按鈕列（記錄攀登、收藏）與個人攀登紀錄；extra 放在收藏後面（回報位置、分享） */
export function PersonalPanel({ route, extra }: { route: Route; extra?: ReactNode }) {
  const personal = usePersonal()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const favorite = personal.favorites.has(route.id)
  const ticks = personal.ticks.filter((t) => t.routeId === route.id)

  if (personal.error) return null

  return (
    <section className="personal">
      {/* 記錄攀登為主按鈕（整行）；下一列等寬：收藏，接著 extra（回報位置、分享），都是圖示加文字 */}
      <div className="route-actions">
        <button className="action primary" onClick={() => setOpen(true)} disabled={!personal.ready || open}>
          {t('tick.add')}
        </button>
        <div className="route-actions-more">
          <button
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
          {extra}
        </div>
      </div>

      <TickSheet route={route} open={open} onClose={() => setOpen(false)} />

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
