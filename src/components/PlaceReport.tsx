import { useEffect, useState } from 'react'
import type { LoadedData, RouteRef } from '../data/dataset'
import { RESCUE_POINTS } from '../data/rescue'
import { distanceM, nearestPoints, type LatLng } from '../geo'
import { localName, useLang } from '../i18n'
import { inMapBounds } from '../map/bounds'
import { addMark, type ReportTarget } from '../map/calibration'
import { areaNames, useScaleMap } from '../map/mapData'
import { ScaleMap } from '../map/ScaleMap'
import { useGeolocation } from './MyLocation'
import { Sheet } from './Sheet'
import { useSimulation } from '../simulate'

/** 誤差在這以內才適合當校正點（與地圖頁相同） */
const GOOD_ACCURACY_M = 10
/** 送出後「已記錄」顯示多久（毫秒） */
const SENT_MS = 4000

type Kind = ReportTarget['kind']
const KINDS: Kind[] = ['start', 'rest', 'top', 'base']

/**
 * 路線頁的「回報位置」：站在路線底下時回報起攀點、休息點、頂端或這面牆的牆底。
 * 區域、分區、路線從頁面帶入，不必再選；地圖放大到這個區域，點一下標出自己的位置（岩壁下 GPS 常偏）。
 * 和地圖頁的回報存在同一份記錄裡（src/map/calibration.ts），在背景自動上傳；多了 target 記下回報的是哪裡。
 */
export function PlaceReport({ data, item }: { data: LoadedData; item: RouteRef }) {
  const { lang, t } = useLang()
  const { route, sector, area } = item
  const map = useScaleMap()
  const [geo, start] = useGeolocation()
  const simulated = useSimulation()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>()
  const [picked, setPicked] = useState<LatLng>()
  const [extra, setExtra] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!sent) return
    const timer = setTimeout(() => setSent(false), SENT_MS)
    return () => clearTimeout(timer)
  }, [sent])

  const fix = geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy, time: geo.time } : undefined
  /** 不在龍洞地圖範圍內（例如在家裡打開）：不能回報，說明離最近的救援點多遠 */
  const outside = fix && !simulated && !inMapBounds(fix.coords) ? nearestPoints(fix.coords, RESCUE_POINTS, 1)[0]?.distance : undefined
  const distance = (m: number) => (m < 1000 ? t('myloc.m', { n: Math.round(m) }) : t('myloc.km', { n: (m / 1000).toFixed(1) }))
  const routeName = `${route.number ? `#${route.number} ` : ''}${localName(route.name, lang).main}`

  const openSheet = () => {
    setKind(undefined)
    setPicked(undefined)
    setExtra('')
    setOpen(true)
    if (geo.status !== 'ok') start()
  }

  const submit = () => {
    if (!kind || !fix || outside !== undefined) return
    // 說明：管理頁的清單直接看得懂（「#62 火龍 · 起攀點」「地下二樓 · 牆底」）
    const what = kind === 'base' ? localName(sector.name, lang).main : routeName
    const note = [`${what} · ${t(`place.kind.${kind}`)}`, extra.trim()].filter(Boolean).join(' · ')
    addMark({
      ...fix,
      note,
      ...(picked ? { picked } : {}),
      target: { kind, areaId: area.id, sectorId: sector.id, ...(kind === 'base' ? {} : { routeId: route.id }) },
    })
    setOpen(false)
    setSent(true)
  }

  return (
    <>
      {/* 按鈕列放不下文字：圖示按鈕（定位圖釘），送出後短暫換成打勾 */}
      <button
        type="button"
        className={`action icon-action place-report-button${sent ? ' on' : ''}`}
        aria-label={sent ? t(simulated ? 'sim.notSent' : 'place.sent') : t('place.button')}
        title={sent ? t(simulated ? 'sim.notSent' : 'place.sent') : t('place.button')}
        onClick={openSheet}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          {sent ? (
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.3" fill="currentColor" />
            </>
          )}
        </svg>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('place.title')}>
        <form
          className="place-report"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="map-question">{t('place.which')}</p>
          <div className="chips">
            {KINDS.map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? undefined : k)}>
                {t(`place.kind.${k}`)}
              </button>
            ))}
          </div>

          <p className="map-question">
            {t('place.pick')}
            <span className="muted small"> · {t('place.pickWhy')}</span>
          </p>
          <div className="place-report-map">
            {map.status === 'ok' && (
              <ScaleMap
                map={map.data}
                areaNames={areaNames(data, lang)}
                here={fix}
                marks={[]}
                focus={{ key: area.id, area: area.id.split('/').pop() }}
                pick={{ at: picked, onPick: setPicked }}
              />
            )}
          </div>
          <p className="small">
            {geo.status === 'error' ? (
              <span className="warn">{t(geo.code === 'denied' ? 'map.denied' : 'map.unavailable')}</span>
            ) : !fix ? (
              <span className="muted">{t('map.locating')}</span>
            ) : outside !== undefined ? (
              <span className="warn">{t('map.outsideReport', { dist: distance(outside) })}</span>
            ) : (
              <>
                <span className={fix.accuracy <= GOOD_ACCURACY_M ? 'muted' : 'warn'}>{t('map.accuracy', { m: Math.round(fix.accuracy) })}</span>
                {picked && <span className="muted"> · {t('map.pickedAt', { m: Math.round(distanceM(fix.coords, picked)) })}</span>}
              </>
            )}
          </p>

          <input className="map-extra" type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('map.extra')} aria-label={t('map.extra')} />
          <div className="actions">
            <button type="submit" className="action primary" disabled={!kind || !fix || outside !== undefined}>
              {t('map.send')}
            </button>
            <button type="button" className="action" onClick={() => setOpen(false)}>
              {t('map.cancel')}
            </button>
          </div>
        </form>
      </Sheet>
    </>
  )
}
