import { useEffect } from 'react'
import { CopyButton } from '../components/CopyButton'
import { LocationHelp } from '../components/LocationHelp'
import { useGeolocation, type GeoState } from '../components/MyLocation'
import { EMERGENCY_NUMBERS, RESCUE_SOURCE, formatCoords } from '../data/rescue'
import { whereabouts, type Direction, type Whereabouts } from '../geo'
import { LOCALES, localName, useLang, type Translate } from '../i18n'

/** 誤差超過這個距離（公尺）時提醒到開闊處 */
const POOR_ACCURACY_M = 50

/**
 * 救援：撥緊急電話、說出自己在哪裡。一打開就定位，依位置調整顯示：
 * 在岩場附近時是最近的救援點（通報的地點）與最近的急救器材；不在岩場附近只有座標。
 * 全部在離線快取裡，GPS 不需要網路。
 */
export function RescuePage() {
  const { t } = useLang()
  const [geo, start] = useGeolocation()
  useEffect(start, [start])
  const where = geo.status === 'ok' ? whereabouts(geo.coords) : undefined
  const [first, ...others] = EMERGENCY_NUMBERS

  return (
    <article className="rescue">
      <h1>{t('rescue.title')}</h1>
      <a className="sos-call" href={`tel:${first}`}>
        <strong>{first}</strong>
        <span>{t(`rescue.call${first}`)}</span>
      </a>
      <div className="sos-calls">
        {others.map((n) => (
          <a key={n} className="sos-call" href={`tel:${n}`}>
            <strong>{n}</strong>
            <span>{t(`rescue.call${n}`)}</span>
          </a>
        ))}
      </div>

      <Location geo={geo} where={where} start={start} />

      {/* 通報社群只有在岩場附近（或還不知道在哪裡）時有用 */}
      {where?.kind !== 'outside' && (
        <p className="sos-line">
          <a href={RESCUE_SOURCE.lineGroupUrl} target="_blank" rel="noreferrer">
            {t('rescue.line')}
          </a>
          <span className="muted small"> {t('rescue.linePassword', { password: RESCUE_SOURCE.lineGroupPassword })}</span>
        </p>
      )}

      <p className="muted small">{t('rescue.disclaimer')}</p>
    </article>
  )
}

function formatDistance(m: number, t: Translate): string {
  return m < 1000 ? t('myloc.m', { n: Math.round(m) }) : t('myloc.km', { n: (m / 1000).toFixed(1) })
}

/** 定位的結果：通報地點與最近的急救器材（在岩場附近時）、座標（可複製唸給 119）、誤差；定位失敗時說明怎麼處理 */
function Location({ geo, where, start }: { geo: GeoState; where?: Whereabouts; start: () => void }) {
  const { lang, t } = useLang()

  if (geo.status === 'error')
    return (
      <section className="sos-where">
        <p className="small error" role="alert">
          {t(`myloc.${geo.code}`)}
        </p>
        <div className="actions">
          {geo.code === 'denied' && <LocationHelp />}
          {geo.code !== 'unsupported' && (
            <button type="button" className="action" onClick={start}>
              {t('myloc.retry')}
            </button>
          )}
        </div>
      </section>
    )

  if (geo.status !== 'ok' || !where)
    return (
      <section className="sos-where">
        <p className="muted small" role="status">
          {t('myloc.locating')}
        </p>
      </section>
    )

  const away = (n: { direction: Direction; distance: number }) => t('myloc.away', { dir: t(`dir.${n.direction}`), dist: formatDistance(n.distance, t) })
  return (
    <section className="sos-where" aria-label={t('myloc.title')}>
      {where.kind === 'crag' ? (
        <>
          <h2>{t('rescue.place')}</h2>
          <p className="sos-spot">
            <span className="point-no" aria-hidden>
              {where.point.point.no}
            </span>
            <span>
              <strong>
                <span className="visually-hidden">#{where.point.point.no} </span>
                {localName(where.point.point.name, lang).main}
              </strong>
              <br />
              <span className="small">{away(where.point)}</span>
            </span>
          </p>
        </>
      ) : (
        <p className="muted small">{t('myloc.outside', { dist: formatDistance(where.distance, t) })}</p>
      )}

      <div className="my-coords">
        <span className="mono" aria-label={t('myloc.coordsAria')}>
          {formatCoords(geo.coords)}
        </span>
        <CopyButton text={formatCoords(geo.coords)} className="action primary" />
      </div>
      <p className="muted small" role="status">
        {t('myloc.accuracy', {
          m: Math.round(geo.accuracy),
          time: new Date(geo.time).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        })}
      </p>
      {geo.accuracy > POOR_ACCURACY_M && <p className="small warn">{t('myloc.poor')}</p>}

      {where.kind === 'crag' && (
        <>
          <h2>{t('rescue.nearestEms')}</h2>
          <p className="sos-spot">
            <span className="ems-icon" aria-hidden>
              +
            </span>
            <span>
              <strong>{localName(where.ems.point.name, lang).main}</strong>
              <span className="muted"> · {localName(where.ems.point.where, lang).main}</span>
              {where.ems.point.sked && (
                <>
                  {' '}
                  <span className="sked-badge" title={t('rescue.skedTitle')}>
                    SKED
                  </span>
                </>
              )}
              <br />
              <span className="small">{away(where.ems)}</span>
            </span>
          </p>
        </>
      )}
    </section>
  )
}
