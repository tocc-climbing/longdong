import { useState } from 'react'
import { useCloud } from '../personal/sync'
import { rate } from '../social/actions'
import { useLang } from '../i18n'
import { FEELS, routeKey, summarize, type Feel } from '../social/model'
import { useSocial } from '../social/store'
import { StarPicker } from './Stars'

export function RatingSection({ routeId }: { routeId: string }) {
  const social = useSocial()
  const cloud = useCloud()
  const { t } = useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const ratings = social.ratings[routeKey(routeId)]
  const summary = summarize(ratings)
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const mine = uid ? ratings?.[uid] : undefined

  const save = async (stars: number, feel: Feel | undefined) => {
    setBusy(true)
    setError(undefined)
    try {
      await rate(routeId, { stars, ...(feel ? { feel } : {}) })
    } catch (err) {
      setError(t('rating.saveError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try {
      await rate(routeId, null)
    } catch (err) {
      setError(t('rating.deleteError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rating">
      <h2>{t('rating.title')}</h2>
      {summary ? (
        <div className="rating-summary">
          <div className="rating-average">
            <strong>{summary.average.toFixed(1)}</strong>
            <span className="stars-static" aria-hidden>
              {'★★★★★'.slice(0, Math.round(summary.average))}
              <span className="dim">{'★★★★★'.slice(Math.round(summary.average))}</span>
            </span>
            <span className="muted small">{t('rating.count', { n: summary.count })}</span>
          </div>
          <ul className="rating-bars" aria-label={t('rating.barsAria')}>
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n}>
                <span>{n}</span>
                <span className="bar">
                  <span style={{ width: `${(summary.stars[n - 1] / summary.count) * 100}%` }} />
                </span>
                <span className="muted">{summary.stars[n - 1]}</span>
              </li>
            ))}
          </ul>
          {summary.feel.soft + summary.feel.fair + summary.feel.hard > 0 && (
            <p className="small">
              {t('rating.feelSummary')}
              {FEELS.map((f) => `${t(`feel.${f}`)} ${summary.feel[f]}`).join(' · ')}
            </p>
          )}
        </div>
      ) : (
        <p className="muted small">{social.ratingsLoaded ? t('rating.none') : t('app.loading')}</p>
      )}

      {cloud.status === 'signed-in' && (
        <div className="my-rating">
          <p className="small">{mine ? t('rating.yours') : t('rating.ask')}</p>
          <StarPicker value={mine?.stars ?? 0} disabled={busy} onChange={(stars) => void save(stars, mine?.feel)} />
          <div className="chips" role="group" aria-label={t('rating.feelAria')}>
            {FEELS.map((f) => (
              <button
                key={f}
                className="chip"
                aria-pressed={mine?.feel === f}
                disabled={busy || !mine}
                title={mine ? undefined : t('rating.starsFirst')}
                onClick={() => mine && void save(mine.stars, mine.feel === f ? undefined : f)}
              >
                {t(`feel.${f}`)}
              </button>
            ))}
          </div>
          {mine && (
            <button className="link-button" onClick={() => void clear()} disabled={busy}>
              {t('rating.delete')}
            </button>
          )}
          {mine?.feel && <p className="muted small">{t('rating.youFeel', { feel: t(`feel.${mine.feel}`) })}</p>}
          {error && <p className="small error">{error}</p>}
        </div>
      )}
    </section>
  )
}
