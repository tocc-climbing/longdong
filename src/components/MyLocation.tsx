import { useEffect, useRef, useState } from 'react'
import { RESCUE_POINTS, formatCoords } from '../data/rescue'
import { NEAR_CRAG_M, nearestPoints, type LatLng } from '../geo'
import { LOCALES, localName, useLang, type Translate } from '../i18n'
import { href } from '../router'
import { CopyButton } from './CopyButton'

/** 誤差超過這個距離（公尺）時提醒到開闊處 */
const POOR_ACCURACY_M = 50

type GeoState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ok'; coords: LatLng; accuracy: number; time: number }
  | { status: 'error'; code: 'denied' | 'unavailable' | 'timeout' | 'unsupported' }

/**
 * 手機 GPS 定位：按下才開始（瀏覽器會先詢問權限），之後持續更新；離開頁面時停止，不在背景耗電。
 * GPS 不需要網路；沒有網路時第一次定位可能較久。
 */
export function useGeolocation(): [GeoState, () => void] {
  const [state, setState] = useState<GeoState>({ status: 'idle' })
  const watch = useRef<number>(undefined)

  useEffect(() => () => {
    if (watch.current !== undefined) navigator.geolocation.clearWatch(watch.current)
  }, [])

  const start = () => {
    if (!('geolocation' in navigator)) return setState({ status: 'error', code: 'unsupported' })
    if (watch.current !== undefined) navigator.geolocation.clearWatch(watch.current)
    setState({ status: 'locating' })
    watch.current = navigator.geolocation.watchPosition(
      (pos) => setState({ status: 'ok', coords: [pos.coords.latitude, pos.coords.longitude], accuracy: pos.coords.accuracy, time: pos.timestamp }),
      (err) =>
        // 已經有位置時，之後偶爾的逾時或訊號不佳不蓋掉最後一次的座標
        setState((prev) =>
          prev.status === 'ok' && err.code !== err.PERMISSION_DENIED
            ? prev
            : { status: 'error', code: err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable' },
        ),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 },
    )
  }

  return [state, start]
}

function formatDistance(m: number, t: Translate): string {
  return m < 1000 ? t('myloc.m', { n: Math.round(m) }) : t('myloc.km', { n: (m / 1000).toFixed(1) })
}

/** 救援頁的「我的位置」：目前座標（可複製唸給 119）、誤差、最近的救援點與距離、方位 */
export function MyLocation() {
  const { lang, t } = useLang()
  const [geo, start] = useGeolocation()
  const calibrate = (
    <a className="action" href={href.calibrate()}>
      {t('myloc.calibrate')}
    </a>
  )

  return (
    <section className="card my-location" aria-labelledby="my-location">
      <h2 id="my-location">{t('myloc.title')}</h2>

      {geo.status === 'idle' && (
        <>
          <p className="muted small">{t('myloc.desc')}</p>
          <div className="actions">
            <button type="button" className="action primary" onClick={start}>
              {t('myloc.start')}
            </button>
            {calibrate}
          </div>
        </>
      )}

      {geo.status === 'locating' && (
        <p className="muted small" role="status">
          {t('myloc.locating')}
        </p>
      )}

      {geo.status === 'error' && (
        <>
          <p className="small error" role="alert">
            {t(`myloc.${geo.code}`)}
          </p>
          <div className="actions">
            {geo.code !== 'unsupported' && (
              <button type="button" className="action" onClick={start}>
                {t('myloc.retry')}
              </button>
            )}
            {calibrate}
          </div>
        </>
      )}

      {geo.status === 'ok' && (
        <>
          <div className="my-coords">
            <span className="mono" aria-label={t('myloc.coordsAria')}>
              {formatCoords(geo.coords)}
            </span>
            <CopyButton text={formatCoords(geo.coords)} className="action primary" />
            {calibrate}
          </div>
          <p className="muted small" role="status">
            {t('myloc.accuracy', {
              m: Math.round(geo.accuracy),
              time: new Date(geo.time).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            })}
          </p>
          {geo.accuracy > POOR_ACCURACY_M && <p className="small warn">{t('myloc.poor')}</p>}

          <NearestPoints here={geo.coords} />
        </>
      )}
    </section>
  )
}

/** 最近的救援點；不在龍洞岩場附近（最近的救援點超過 1 公里）時不列出，只說明距離 */
function NearestPoints({ here }: { here: LatLng }) {
  const { lang, t } = useLang()
  const near = nearestPoints(here, RESCUE_POINTS, 3)
  if (near.length === 0 || near[0].distance > NEAR_CRAG_M) {
    return <p className="muted small">{t('myloc.outside', { dist: near[0] ? formatDistance(near[0].distance, t) : '' })}</p>
  }
  return (
    <>
      <h3>{t('myloc.nearest')}</h3>
      <ul className="list-card point-list">
        {near.map(({ point, distance, direction }) => (
          <li key={`${point.no}-${point.name.zh}`} className="point-item near-item">
            <span className="point-no" aria-hidden>
              {point.no}
            </span>
            <span className="point-body">
              <span className="point-name">
                <span className="visually-hidden">#{point.no} </span>
                {localName(point.name, lang).main}
              </span>
              <span className="small">{t('myloc.away', { dir: t(`dir.${direction}`), dist: formatDistance(distance, t) })}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
