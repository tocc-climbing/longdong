import { lazy, Suspense, useRef, useState } from 'react'
import { CopyButton } from '../components/CopyButton'
import { MyLocation, useGeolocation } from '../components/MyLocation'
import type { LoadedData } from '../data/dataset'
import { AREA_RESCUE, EMERGENCY_NUMBERS, EMS_LOCATIONS, RESCUE_POINTS, RESCUE_SOURCE, formatCoords, mapUrl, type RescuePoint } from '../data/rescue'
import { localName, useLang } from '../i18n'
import type { MapFocus, MapSelection } from '../map/ScaleMap'

/** 地圖的程式與資料較多，分開打包，打開救援頁時才載入（離線快取裡都有） */
const RescueMap = lazy(() => import('../map/RescueMap'))

/**
 * 救援資訊：緊急電話與通報、地圖（從區域頁進來時聚焦在該區與就近救援點、急救器材）、我的位置、
 * 該區的就近救援點與急救器材、全部救援點、急救器材。清單點一下就在地圖上顯示，地圖下方顯示座標（可複製）或器材位置。
 * 全部放在離線快取裡，沒有訊號也能看。
 */
export function RescuePage({ data, areaKey }: { data: LoadedData; areaKey?: string }) {
  const { lang, t } = useLang()
  const area = areaKey && AREA_RESCUE[areaKey] ? data.areaById.get(`${data.dataset.crag.id}/${areaKey}`) : undefined
  const local = areaKey ? AREA_RESCUE[areaKey] : undefined
  const [geo, startLocating] = useGeolocation()
  /** 選中的救援點或急救器材：地圖上加大標示，地圖下方顯示詳細資訊 */
  const [selected, setSelected] = useState<MapSelection>()
  /** 從清單點選：地圖移過去（n 讓同一個再點一次也會移過去） */
  const [flyTo, setFlyTo] = useState<MapSelection & { n: number }>()
  const mapSection = useRef<HTMLElement>(null)

  const focus: MapFocus | undefined = flyTo
    ? { key: `${flyTo.kind}:${flyTo.no}:${flyTo.n}`, ...(flyTo.kind === 'rescue' ? { points: [flyTo.no] } : { ems: [flyTo.no] }) }
    : area && local && areaKey
      ? { key: `area:${areaKey}`, area: areaKey, points: local.points, ems: [local.ems] }
      : undefined
  const showOnMap = (selection: MapSelection) => {
    setSelected(selection)
    setFlyTo((f) => ({ ...selection, n: (f?.n ?? 0) + 1 }))
    mapSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const selectedPoint = selected?.kind === 'rescue' ? RESCUE_POINTS.find((p) => p.no === selected.no && p.coords) : undefined
  const selectedEms = selected?.kind === 'ems' ? selected.no : undefined
  const areaName = area && localName(area.name, lang).main

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

      <section className="rescue-map-section" ref={mapSection} aria-labelledby="rescue-map">
        <h2 id="rescue-map">{areaName ? t('rescue.areaTitle', { area: areaName }) : t('rescue.map')}</h2>
        <Suspense fallback={<div className="rescue-map" />}>
          <RescueMap
            data={data}
            focus={focus}
            selected={selected}
            here={geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy } : undefined}
            onLocate={startLocating}
            onSelect={setSelected}
          />
        </Suspense>
        {selectedPoint ? (
          <div className="card rescue-selected">
            <PointDetail point={selectedPoint} />
          </div>
        ) : selectedEms !== undefined ? (
          <div className="card rescue-selected">
            <EmsItem no={selectedEms} />
          </div>
        ) : (
          <p className="muted small">{t('rescue.mapHint')}</p>
        )}
      </section>

      <MyLocation geo={geo} start={startLocating} />

      {area && local && (
        <section aria-labelledby="rescue-area">
          <h2 id="rescue-area">{t('rescue.nearTitle', { area: areaName! })}</h2>
          <PointList points={RESCUE_POINTS.filter((p) => local.points.includes(p.no))} onShow={showOnMap} />
          <h3>{t('rescue.nearEms')}</h3>
          <EmsList ems={EMS_LOCATIONS.filter((e) => e.no === local.ems)} onShow={showOnMap} />
        </section>
      )}

      <section aria-labelledby="rescue-points">
        <h2 id="rescue-points">{t('rescue.points')}</h2>
        <PointList points={RESCUE_POINTS} onShow={showOnMap} />
      </section>

      <section aria-labelledby="rescue-ems">
        <h2 id="rescue-ems">{t('rescue.ems')}</h2>
        <p className="muted small">{t('rescue.emsDesc')}</p>
        <EmsList ems={EMS_LOCATIONS} onShow={showOnMap} />
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

      <p className="muted small">{t('rescue.disclaimer')}</p>
    </article>
  )
}

/** 救援點清單：點一下就在地圖上顯示（沒有座標的不能點） */
function PointList({ points, onShow }: { points: RescuePoint[]; onShow: (selection: MapSelection) => void }) {
  const { lang, t } = useLang()
  return (
    <ul className="list-card point-list">
      {points.map((point) => (
        <li key={`${point.no}-${point.name.zh}`}>
          <button type="button" className="point-item rescue-row" disabled={!point.coords} onClick={() => onShow({ kind: 'rescue', no: point.no })}>
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
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 地圖上選中的救援點：座標可以複製（唸給 119）、開 Google 地圖 */
function PointDetail({ point }: { point: RescuePoint }) {
  const { lang, t } = useLang()
  return (
    <div className="point-item">
      <span className="point-no" aria-hidden>
        {point.no}
      </span>
      <span className="point-body">
        <span className="point-name">
          <span className="visually-hidden">#{point.no} </span>
          {localName(point.name, lang).main}
        </span>
        <span className="mono small">{formatCoords(point.coords!)}</span>
      </span>
      <span className="point-actions">
        <CopyButton text={formatCoords(point.coords!)} />
        <a className="chip" href={mapUrl(point.coords!)} target="_blank" rel="noreferrer">
          {t('rescue.navigate')}
        </a>
      </span>
    </div>
  )
}

/** 急救器材清單：點一下就在地圖上顯示 */
function EmsList({ ems, onShow }: { ems: typeof EMS_LOCATIONS; onShow: (selection: MapSelection) => void }) {
  return (
    <ul className="list-card ems-list">
      {ems.map((e) => (
        <li key={e.no}>
          <button type="button" className="rescue-row" onClick={() => onShow({ kind: 'ems', no: e.no })}>
            <EmsItem no={e.no} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 急救器材：地點、放置位置；有捲式擔架的標示 SKED */
function EmsItem({ no }: { no: number }) {
  const { lang, t } = useLang()
  const ems = EMS_LOCATIONS.find((e) => e.no === no)!
  return (
    <span className="ems-item">
      <span className="ems-icon" aria-hidden>
        +
      </span>
      <span>
        <strong>{localName(ems.name, lang).main}</strong>
        <span className="muted"> · {localName(ems.where, lang).main}</span>
        {ems.sked && (
          <>
            {' '}
            <span className="sked-badge" title={t('rescue.skedTitle')}>
              SKED
            </span>
          </>
        )}
      </span>
    </span>
  )
}
