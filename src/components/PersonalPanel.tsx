import { useState, type ReactNode } from 'react'
import type { Route } from '../data/schema'
import { formatDate } from '../format'
import { useLang } from '../i18n'
import { TICK_STYLES, today, type TickStyle } from '../personal/model'
import { addTick, deleteTick, setFavorite, usePersonal } from '../personal/store'

/** 路線頁上的按鈕列（記錄攀登、收藏的愛心）與個人攀登紀錄；extra 放在按鈕列最後（分享） */
export function PersonalPanel({ route, extra }: { route: Route; extra?: ReactNode }) {
  const personal = usePersonal()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const favorite = personal.favorites.has(route.id)
  const ticks = personal.ticks.filter((t) => t.routeId === route.id)

  if (personal.error) return null

  return (
    <section className="personal">
      {/* 記錄攀登為主按鈕，收藏是愛心圖示，extra（回報位置、分享）接在後面 */}
      <div className="route-actions">
        <button className="action primary" onClick={() => setOpen(true)} disabled={!personal.ready || open}>
          {t('tick.add')}
        </button>
        <button
          className={`action icon-action${favorite ? ' on' : ''}`}
          aria-pressed={favorite}
          aria-label={favorite ? t('fav.on') : t('fav.off')}
          title={favorite ? t('fav.on') : t('fav.off')}
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
        </button>
        {extra}
      </div>

      {open && <TickForm routeId={route.id} onDone={() => setOpen(false)} />}

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

function TickForm({ routeId, onDone }: { routeId: string; onDone: () => void }) {
  const { t } = useLang()
  const [date, setDate] = useState(today)
  const [style, setStyle] = useState<TickStyle>('redpoint')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    await addTick({ routeId, date, style, note: note.trim() || undefined })
    onDone()
  }

  return (
    <form
      className="tick-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label>
        {t('tick.date')}
        <input type="date" value={date} max={today()} required onChange={(e) => setDate(e.target.value)} />
      </label>
      <fieldset>
        <legend>{t('tick.style')}</legend>
        <div className="chips">
          {TICK_STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              className="chip"
              aria-pressed={style === s.value}
              onClick={() => setStyle(s.value)}
            >
              {t(`style.${s.value}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        {t('tick.note')}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" className="action primary" disabled={saving || !date}>
          {t('action.save')}
        </button>
        <button type="button" className="action" onClick={onDone}>
          {t('action.cancel')}
        </button>
      </div>
    </form>
  )
}
