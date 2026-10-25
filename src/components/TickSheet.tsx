import { useState } from 'react'
import type { Route } from '../data/schema'
import { formatDate } from '../format'
import { localName, useLang } from '../i18n'
import { checklistStyle, daysAgo, NOTE_MAX, TICK_STYLES, today, type TickStyle } from '../personal/model'
import { addTick } from '../personal/store'
import { GradePill } from './GradePill'
import { Sheet } from './Sheet'

/** 攀登方式按鈕的顏色（同路線清單）：OS、RP（含 Flash）、TR（含跟攀）；嘗試沿用文字色 */
const STYLE_CLASS = { onsight: 'style-os', redpoint: 'style-rp', toprope: 'style-tr' } as const
const styleClass = (style: TickStyle) => {
  const best = checklistStyle(style)
  return best ? STYLE_CLASS[best] : ''
}

/** 記錄攀登：手機從下方滑出的面板。日期預設今天（一鍵改昨天），攀登方式用大按鈕，心得收在「加心得」後面 */
export function TickSheet({ route, open, onClose }: { route: Route; open: boolean; onClose: () => void }) {
  const { lang, t } = useLang()
  const [date, setDate] = useState(today)
  const [style, setStyle] = useState<TickStyle>('redpoint')
  const [note, setNote] = useState('')
  const [noting, setNoting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const now = today()
  const yesterday = daysAgo(1)

  const save = async () => {
    setSaving(true)
    setError(undefined)
    try {
      await addTick({ routeId: route.id, date, style, note: note.trim() || undefined })
      setNote('')
      setNoting(false)
      setDate(today())
      onClose()
    } catch (err) {
      setError(t('tick.saveError', { error: (err as Error).message }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('tick.sheetTitle')}>
      <form
        className="tick-sheet"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="tick-route">
          {route.number && <span className="tick-route-no">{route.number}</span>}
          <span className="tick-route-name">{localName(route.name, lang).main}</span>
          <GradePill grade={route.grade} value={route.gradeValue} size="sm" />
        </p>

        <fieldset>
          <legend>{t('tick.date')}</legend>
          <div className="tick-dates">
            <button type="button" className="chip" aria-pressed={date === now} onClick={() => setDate(now)}>
              {t('tick.today')}
            </button>
            <button type="button" className="chip" aria-pressed={date === yesterday} onClick={() => setDate(yesterday)}>
              {t('tick.yesterday')}
            </button>
            <label className="chip tick-date-other" aria-pressed={date !== now && date !== yesterday}>
              <span>{date !== now && date !== yesterday ? formatDate(date) : t('tick.otherDate')}</span>
              <input type="date" value={date} max={now} required onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('tick.style')}</legend>
          <div className="tick-styles">
            {TICK_STYLES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`tick-style-button ${styleClass(s.value)}`}
                aria-pressed={style === s.value}
                onClick={() => setStyle(s.value)}
              >
                {t(`style.${s.value}`)}
              </button>
            ))}
          </div>
        </fieldset>

        {noting ? (
          <label>
            {t('tick.note')}
            <textarea rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </label>
        ) : (
          <button type="button" className="link-button tick-add-note" onClick={() => setNoting(true)}>
            {t('tick.addNote')}
          </button>
        )}

        {error && (
          <p className="small error" role="alert">
            {error}
          </p>
        )}
        <div className="tick-save">
          <button type="submit" className="action primary" disabled={saving || !date}>
            {t('action.save')}
          </button>
          <button type="button" className="action" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
