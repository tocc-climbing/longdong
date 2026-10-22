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

  // 手機版：大字平均＋各星等分佈、體感難度比例條、你的評分
  const feelTotal = summary ? summary.feel.soft + summary.feel.fair + summary.feel.hard : 0
  return (
    <section className="rating rating-m">
      <h2>{t('rating.title')}</h2>
      {summary ? (
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
      )}

      {cloud.status === 'signed-in' && (
        <div className="rating-m-mine">
          <div>
            <span className="muted small">{mine ? t('rating.yours') : t('rating.ask')}</span>
            <StarPicker value={mine?.stars ?? 0} disabled={busy} onChange={(stars) => void save(stars, mine?.feel)} />
          </div>
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
            {mine && (
              <button className="link-button small" onClick={() => void clear()} disabled={busy}>
                {t('rating.delete')}
              </button>
            )}
          </div>
          {error && <p className="small error">{error}</p>}
        </div>
      )}
    </section>
  )
}
