import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { LocationHelp } from '../components/LocationHelp'
import { useGeolocation, type GeoState } from '../components/MyLocation'
import { AREA_RESCUE, EMERGENCY_NUMBERS, EMS_LOCATIONS, RESCUE_POINTS, RESCUE_SOURCE, formatCoords, type RescuePoint } from '../data/rescue'
import { whereabouts, type Direction, type LatLng, type Whereabouts } from '../geo'
import type { KitMapFocus } from '../map/KitMap'
import { LOCALES, localName, useLang, type Translate } from '../i18n'

/** 誤差超過這個距離（公尺）時提醒到開闊處 */
const POOR_ACCURACY_M = 50

const RescueMap = lazy(() => import('./RescueMap').then((m) => ({ default: m.RescueMap })))

/**
 * 救援：撥緊急電話、說出自己在哪裡。一打開就定位，依位置調整顯示：
 * 準確定位於岩場附近時顯示最近的救援點與器材；其餘情況保留完整清單。
 * 全部在離線快取裡，GPS 不需要網路。
 */
export function RescuePage({ data }: { data: LoadedData }) {
  const { t } = useLang()
  const [geo, start] = useGeolocation()
  useEffect(start, [start])
  const where = geo.status === 'ok' ? whereabouts(geo.coords) : undefined
  const nearby = geo.status === 'ok' && geo.accuracy <= POOR_ACCURACY_M && where?.kind === 'crag'
  const [first, ...others] = EMERGENCY_NUMBERS
  const [focus, setFocus] = useState<KitMapFocus>()
  const mapElement = useRef<HTMLDivElement>(null)
  const selection = useRef(0)
  const select = (target: Omit<KitMapFocus, 'key'>) => {
    setFocus({ ...target, key: `selected:${++selection.current}` })
    mapElement.current?.scrollIntoView({ block: 'nearest' })
  }
  const selectAt = (at: LatLng) => select({ coords: [at], tight: true })
  const selectPoint = (point: RescuePoint) => {
    if (point.coords) return selectAt(point.coords)
    // 沒有官方座標的點只顯示資料中對應的區域，不推測精確位置。
    const area = Object.entries(AREA_RESCUE).find(([, info]) => info.points.includes(point.no))![0]
    select({ area: `${data.dataset.crag.id}/${area}` })
  }

  return (
    <article className="rescue">
      <div className="rescue-intro">
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

        <Location geo={geo} where={where} start={start} nearby={nearby} onSelect={selectAt} />
      </div>
      <div className="rescue-map" ref={mapElement}>
        <Suspense fallback={<p className="muted small map-status" role="status">{t('app.loading')}</p>}>
          <RescueMap data={data} geo={geo} nearby={nearby && where?.kind === 'crag' ? where : undefined} focus={focus} />
        </Suspense>
      </div>
      {!nearby && <AllRescueInfo onSelectPoint={selectPoint} onSelect={selectAt} />}

      <div className="rescue-footer">
        <p className="sos-line">
          <a href={RESCUE_SOURCE.lineGroupUrl} target="_blank" rel="noreferrer">
            {t('rescue.line')}
          </a>
          <span className="muted small"> {t('rescue.linePassword', { password: RESCUE_SOURCE.lineGroupPassword })}</span>
        </p>

        <p className="muted small">{t('rescue.disclaimer')}</p>
      </div>
    </article>
  )
}

function formatDistance(m: number, t: Translate): string {
  return m < 1000 ? t('myloc.m', { n: Math.round(m) }) : t('myloc.km', { n: (m / 1000).toFixed(1) })
}

/** 定位的結果：通報地點與最近的急救器材（在岩場附近時）、座標與誤差；定位失敗時說明怎麼處理 */
function Location({ geo, where, start, nearby, onSelect }: { geo: GeoState; where?: Whereabouts; start: () => void; nearby: boolean; onSelect: (at: LatLng) => void }) {
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
      {where.kind === 'crag' && nearby ? (
        <>
          <h2>{t('rescue.place')}</h2>
          <button type="button" className="sos-spot rescue-select" onClick={() => onSelect(where.point.point.coords)}>
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
          </button>
        </>
      ) : where.kind === 'outside' ? (
        <p className="muted small">{t('myloc.outside', { dist: formatDistance(where.distance, t) })}</p>
      ) : null}

      <div className="my-coords">
        <span className="mono" aria-label={t('myloc.coordsAria')}>
          {formatCoords(geo.coords)}
        </span>
      </div>
      <p className="muted small" role="status">
        {t('myloc.accuracy', {
          m: Math.round(geo.accuracy),
          time: new Date(geo.time).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        })}
      </p>
      {geo.accuracy > POOR_ACCURACY_M && <p className="small warn">{t('myloc.poor')}</p>}

      {where.kind === 'crag' && nearby && (
        <>
          <h2>{t('rescue.nearestEms')}</h2>
          <button type="button" className="sos-spot rescue-select" onClick={() => onSelect(where.ems.point.coords)}>
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
          </button>
        </>
      )}
    </section>
  )
}

/** 無可靠的岩場內定位時，包含沒有座標的救援點，全部都能查閱。 */
function AllRescueInfo({ onSelectPoint, onSelect }: { onSelectPoint: (point: RescuePoint) => void; onSelect: (at: LatLng) => void }) {
  const { lang, t } = useLang()
  return (
    <section className="rescue-all">
      <h2>{t('rescue.points')}</h2>
      <ul className="list-card rescue-points">
        {RESCUE_POINTS.map((point) => (
          <li key={point.key}>
            <button type="button" className="rescue-select rescue-row-select" onClick={() => onSelectPoint(point)}>
              <span className="sos-spot">
                <span className="point-no" aria-hidden>{point.no}</span>
                <strong><span className="visually-hidden">#{point.no} </span>{localName(point.name, lang).main}</strong>
              </span>
              {point.coords && (
                <span className="my-coords">
                  <span className="mono">{formatCoords(point.coords)}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <h2>{t('rescue.equipment')}</h2>
      <ul className="list-card rescue-equipment">
        {EMS_LOCATIONS.map((ems) => (
          <li key={ems.no}>
            <button type="button" className="rescue-select rescue-row-select" onClick={() => onSelect(ems.coords)}>
              <span className="sos-spot">
                <span className="ems-icon" aria-hidden>+</span>
                <span>
                  <strong>{localName(ems.name, lang).main}</strong>
                  <span className="muted"> · {localName(ems.where, lang).main}</span>
                  {ems.sked && <> <span className="sked-badge" title={t('rescue.skedTitle')}>SKED</span></>}
                </span>
              </span>
              <span className="my-coords">
                <span className="mono">{formatCoords(ems.coords)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
