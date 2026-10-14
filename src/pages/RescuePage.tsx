import { useEffect, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import {
  AREA_RESCUE,
  EMERGENCY_NUMBERS,
  EMS_LOCATIONS,
  RESCUE_POINTS,
  RESCUE_SOURCE,
  formatCoords,
  mapUrl,
  type RescuePoint,
} from '../data/rescue'
import { localName, useLang } from '../i18n'

/**
 * 救援資訊：緊急電話與通報、（從區域頁進來時）該區的救援圖與就近救援點、整張救援資訊圖、
 * 全部救援點座標、急救器材位置。全部放在離線快取裡，沒有訊號也能看。
 */
export function RescuePage({ data, areaKey }: { data: LoadedData; areaKey?: string }) {
  const { lang, t } = useLang()
  const area = areaKey && AREA_RESCUE[areaKey] ? data.areaById.get(`${data.dataset.crag.id}/${areaKey}`) : undefined
  const local = areaKey ? AREA_RESCUE[areaKey] : undefined

  return (
    <article className="rescue">
      <h1>{t('rescue.title')}</h1>

      <section className="card rescue-calls" aria-labelledby="rescue-calls">
        <h2 id="rescue-calls">{t('rescue.call')}</h2>
        <div className="call-grid">
          {EMERGENCY_NUMBERS.map((n) => (
            <a key={n} className="call-button" href={`tel:${n}`}>
              <strong>{n}</strong>
              <span>{t(`rescue.call${n}`)}</span>
            </a>
          ))}
        </div>
        <ul className="rescue-links">
          <li>
            <a href={RESCUE_SOURCE.lineGroupUrl} target="_blank" rel="noreferrer">
              {t('rescue.line')}
            </a>
            <span className="muted small"> {t('rescue.linePassword', { password: RESCUE_SOURCE.lineGroupPassword })}</span>
          </li>
          <li>
            <a href={RESCUE_SOURCE.reportFormUrl} target="_blank" rel="noreferrer">
              {t('rescue.report')}
            </a>
          </li>
        </ul>
      </section>

      {area && local && areaKey && (
        <section className="rescue-area" aria-labelledby="rescue-area">
          <h2 id="rescue-area">{t('rescue.areaTitle', { area: localName(area.name, lang).main })}</h2>
          <img className="rescue-crop" src={`rescue/${areaKey}.webp`} alt={t('rescue.areaMapAlt', { area: localName(area.name, lang).main })} />
          <h3>{t('rescue.nearPoints')}</h3>
          <PointList points={RESCUE_POINTS.filter((p) => local.points.includes(p.no))} />
          <h3>{t('rescue.nearEms')}</h3>
          <EmsItem no={local.ems} />
        </section>
      )}

      <FullMap />

      <section aria-labelledby="rescue-points">
        <h2 id="rescue-points">{t('rescue.points')}</h2>
        <PointList points={RESCUE_POINTS} />
      </section>

      <section aria-labelledby="rescue-ems">
        <h2 id="rescue-ems">{t('rescue.ems')}</h2>
        <p className="muted small">{t('rescue.emsDesc')}</p>
        <ul className="list-card ems-list">
          {EMS_LOCATIONS.map((e) => (
            <li key={e.no}>
              <EmsItem no={e.no} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="rescue-more">
        <h2 id="rescue-more">{t('rescue.more')}</h2>
        <ul className="rescue-links">
          <li>
            <a href={RESCUE_SOURCE.handbookUrl} target="_blank" rel="noreferrer">
              {t('rescue.handbook')}
            </a>
          </li>
          <li>
            <a href={RESCUE_SOURCE.projectUrl} target="_blank" rel="noreferrer">
              {t('rescue.project')}
            </a>
          </li>
        </ul>
      </section>

      <p className="muted small">{t('rescue.disclaimer', { version: RESCUE_SOURCE.version })}</p>
    </article>
  )
}

function PointList({ points }: { points: RescuePoint[] }) {
  return (
    <ul className="list-card point-list">
      {points.map((p) => (
        <PointItem key={`${p.no}-${p.name.zh}`} point={p} />
      ))}
    </ul>
  )
}

function PointItem({ point }: { point: RescuePoint }) {
  const { lang, t } = useLang()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <li className="point-item">
      <span className="point-no" aria-hidden>
        {point.no}
      </span>
      <span className="point-body">
        <span className="point-name">
          <span className="visually-hidden">#{point.no} </span>
          {localName(point.name, lang).main}
        </span>
        <span className="mono small">{point.coords ? formatCoords(point.coords) : <span className="muted">{t('rescue.noCoords')}</span>}</span>
      </span>
      {point.coords && (
        <span className="point-actions">
          <button
            type="button"
            className="chip"
            onClick={() => void navigator.clipboard.writeText(formatCoords(point.coords!)).then(() => setCopied(true))}
          >
            {copied ? t('rescue.copied') : t('rescue.copy')}
          </button>
          <a className="chip" href={mapUrl(point.coords)} target="_blank" rel="noreferrer">
            {t('rescue.openMap')}
          </a>
        </span>
      )}
    </li>
  )
}

function EmsItem({ no }: { no: number }) {
  const { lang } = useLang()
  const ems = EMS_LOCATIONS.find((e) => e.no === no)!
  return (
    <p className="ems-item">
      <span className="ems-icon" aria-hidden>
        +
      </span>
      <span>
        <strong>{localName(ems.name, lang).main}</strong>
        <span className="muted"> · {localName(ems.where, lang).main}</span>
      </span>
    </p>
  )
}

/** 整張救援資訊圖：預設符合寬度，按「放大」後可在框內捲動看細節（離線也能用，不開新頁） */
function FullMap() {
  const { t } = useLang()
  const [zoom, setZoom] = useState(false)
  return (
    <section aria-labelledby="rescue-map">
      <div className="section-head">
        <h2 id="rescue-map">{t('rescue.map')}</h2>
        <button type="button" className="chip" aria-pressed={zoom} onClick={() => setZoom((z) => !z)}>
          {zoom ? t('rescue.zoomOut') : t('rescue.zoomIn')}
        </button>
      </div>
      <div className={`map-frame${zoom ? ' zoomed' : ''}`} data-noswipe>
        <img src="rescue/map.webp" alt={t('rescue.mapAlt')} />
      </div>
    </section>
  )
}
