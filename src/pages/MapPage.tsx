import { useEffect, useState } from 'react'
import { inMapBounds } from '../map/bounds'
import { ScaleMap } from '../map/ScaleMap'
import { useGeolocation } from '../components/MyLocation'
import { Sheet } from '../components/Sheet'
import { addMark, hasUnuploaded, onCalibrationEvent, useCalibration } from '../map/calibration'
import type { LoadedData } from '../data/dataset'
import { RESCUE_POINTS, formatCoords } from '../data/rescue'
import { distanceM, nearestPoints, type LatLng } from '../geo'
import { localName, useLang, type MessageKey, type Translate } from '../i18n'
import { useCloud } from '../personal/sync'
import { reportOptions, type ReportOption } from '../map/reportOptions'
import { href, navigate } from '../router'
import { areaNames, project, useScaleMap } from '../map/mapData'

/** 誤差在這以內才適合當校正點 */
const GOOD_ACCURACY_M = 10
/** 附近沒有明確地點時，也可以選的一般描述 */
const GENERIC: MessageKey[] = ['map.quick.trail', 'map.quick.wallBase', 'map.quick.boundary']
const INTRO_KEY = 'longdong.map.intro'
/** 回報後的提示顯示多久（毫秒） */
const TOAST_MS = 4000

/**
 * 地圖（/map）：照比例尺的龍洞地圖，打開就開始定位。
 * 地圖還在校正：第一次使用先說明可能有誤差；左上「回報」依目前位置列出附近的地點，選一下就記錄下來。
 * 回報時也可以在地圖上點出自己認為所在的位置（選填）：和 GPS 的差距可以看出地圖或 GPS 偏了多少。
 * 記錄先存在手機上，登入且連上網路時在背景自動上傳（src/map/calibration.ts，不必停在這一頁），用來校正地圖。
 */
export function MapPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const [geo, start] = useGeolocation()
  const cloud = useCloud()
  const records = useCalibration()
  const [intro, setIntro] = useState(() => !seenIntro())
  const [reporting, setReporting] = useState(false)
  /** 回報表單的內容：在地圖上點位置時表單會關起來，內容留在這裡 */
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  /** 正在地圖上點自己的位置 */
  const [picking, setPicking] = useState(false)
  const [toast, setToast] = useState<string>()

  const names = areaNames(data, lang)
  const fix = geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy, time: geo.time } : undefined
  /** 定位到了但不在地圖範圍內：不能回報；離最近的救援點多遠 */
  const outside = fix && !inMapBounds(fix.coords) ? nearestPoints(fix.coords, RESCUE_POINTS, 1)[0]?.distance : undefined
  const distance = (m: number) => (m < 1000 ? t('myloc.m', { n: Math.round(m) }) : t('myloc.km', { n: (m / 1000).toFixed(1) }))

  // 打開地圖就開始定位（瀏覽器第一次會詢問權限）
  useEffect(start, [])

  // 背景上傳、存檔的結果
  useEffect(
    () =>
      onCalibrationEvent((e) =>
        setToast(e.kind === 'sent' ? t('map.sent') : e.kind === 'failed' ? t('map.uploadFailed', { error: e.error }) : t('map.saveError')),
      ),
    [t],
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const report = (note: string) => {
    if (!fix) return
    addMark({ ...fix, note, ...(draft.at ? { picked: draft.at } : {}) })
    setDraft(EMPTY_DRAFT)
    setReporting(false)
    // 上傳成功會另外提示；沒網路時先存在手機上（不登入也能上傳）
    if (!navigator.onLine || (cloud.status === 'signed-in' && !cloud.connected)) setToast(t('map.queued'))
  }

  const closeIntro = () => {
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch {
      /* 存不了就下次再顯示一次 */
    }
    setIntro(false)
  }

  const pending = hasUnuploaded(records)

  return (
    <div className="map-page">
      {map.status === 'ok' ? (
        <ScaleMap
          map={map.data}
          areaNames={names}
          here={fix}
          marks={records.marks.map((m) => ({ at: m.coords, picked: m.picked }))}
          pick={picking ? { at: draft.at, onPick: (at) => setDraft((d) => ({ ...d, at })) } : undefined}
          onAreaPress={(key) => navigate(href.area(`${data.dataset.crag.id}/${key}`))}
          onLocate={() => {
            if (outside !== undefined) setToast(t('map.outside', { dist: distance(outside) }))
            else if (geo.status === 'locating') setToast(t('map.locating'))
            else if (geo.status !== 'ok') {
              start()
              setToast(t('map.locating'))
            }
          }}
          topLeft={
            <>
              <button type="button" className="sm-chip beta" onClick={() => setIntro(true)}>
                {t('map.beta')}
                {pending && <span className="sm-chip-dot" aria-label={t('map.pending')} />}
              </button>
              <button
                type="button"
                className="sm-chip report"
                onClick={() => (outside !== undefined ? setToast(t('map.outsideReport', { dist: distance(outside) })) : setReporting(true))}
              >
                {t('map.report')}
              </button>
            </>
          }
        />
      ) : (
        <p className={map.status === 'error' ? 'small error map-status' : 'muted small map-status'} role={map.status === 'error' ? 'alert' : 'status'}>
          {map.status === 'error' ? t('map.loadFailed', { error: map.message }) : t('app.loading')}
        </p>
      )}

      {picking && (
        <div className="map-pick-bar" role="status">
          <span>{t('map.pickPrompt')}</span>
          <button
            type="button"
            className="action primary"
            disabled={!draft.at}
            onClick={() => {
              setPicking(false)
              setReporting(true)
            }}
          >
            {t('map.pickDone')}
          </button>
          <button
            type="button"
            className="action"
            onClick={() => {
              setDraft((d) => ({ ...d, at: undefined }))
              setPicking(false)
              setReporting(true)
            }}
          >
            {t('map.cancel')}
          </button>
        </div>
      )}

      <div className="map-toasts">
        {geo.status === 'error' && (
          <p className="map-toast warn" role="alert">
            {t(geo.code === 'denied' ? 'map.denied' : 'map.unavailable')}
          </p>
        )}
        {toast && (
          <p className="map-toast" role="status">
            {toast}
          </p>
        )}
      </div>

      <Sheet open={intro} onClose={closeIntro} title={t('map.introTitle')}>
        <p className="map-warn">{t('map.introWarn')}</p>
        <ul className="map-how">
          <li>{t('map.introHow')}</li>
          <li>{t('map.introReport')}</li>
        </ul>
        <div className="actions">
          <button type="button" className="action primary" onClick={closeIntro}>
            {t('map.introOk')}
          </button>
        </div>
      </Sheet>

      <Sheet open={reporting} onClose={() => setReporting(false)} title={t('map.reportTitle')}>
        {map.status === 'ok' && (
          <ReportForm
            fix={fix}
            options={fix ? reportOptions(project(fix.coords), map.data, RESCUE_POINTS) : []}
            areaNames={names}
            draft={draft}
            onDraft={setDraft}
            onPick={() => {
              setReporting(false)
              setPicking(true)
            }}
            onSubmit={report}
            onCancel={() => setReporting(false)}
          />
        )}
      </Sheet>
    </div>
  )
}

function seenIntro(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

/** 選項的文字（也是記錄下來的說明） */
function optionLabel(o: ReportOption, areaNames: Record<string, string>, lang: Parameters<typeof localName>[1], t: Translate): string {
  if (o.kind === 'area') return t(o.inside ? 'map.inArea' : 'map.nearArea', { name: areaNames[o.id] ?? o.id })
  if (o.kind === 'rescue') return t('map.rescue', { no: o.no, name: localName(o.name, lang).main })
  const m = o.marker
  if (m.kind === 'ems') return t('map.ems', { n: m.no })
  if (m.kind === 'place') return lang === 'en' ? m.en : m.zh
  return t(m.kind === 'parking' ? 'map.parking' : m.kind === 'boat' ? 'map.boat' : 'map.hoist')
}

/** 回報表單的內容：選的地點、補充說明、在地圖上點的位置 */
interface Draft {
  place?: string
  extra: string
  at?: LatLng
}
const EMPTY_DRAFT: Draft = { extra: '' }

function ReportForm({
  fix,
  options,
  areaNames,
  draft,
  onDraft,
  onPick,
  onSubmit,
  onCancel,
}: {
  fix?: { coords: [number, number]; accuracy: number }
  options: ReportOption[]
  areaNames: Record<string, string>
  draft: Draft
  onDraft: (update: (d: Draft) => Draft) => void
  /** 到地圖上點自己的位置 */
  onPick: () => void
  onSubmit: (note: string) => void
  onCancel: () => void
}) {
  const { lang, t } = useLang()
  const { place: picked, extra } = draft
  const setPicked = (place: string | undefined) => onDraft((d) => ({ ...d, place }))
  const setExtra = (value: string) => onDraft((d) => ({ ...d, extra: value }))
  const choices = [
    ...options.map((o) => ({ label: optionLabel(o, areaNames, lang, t), distance: o.distance })),
    ...GENERIC.map((k) => ({ label: t(k), distance: undefined })),
  ]
  const note = [picked, extra.trim()].filter(Boolean).join(' · ')

  if (!fix) return <p className="muted small">{t('map.noFix')}</p>

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (note) onSubmit(note)
      }}
    >
      <p className="small">
        <span className="mono">{formatCoords(fix.coords)}</span>
        <span className={fix.accuracy <= GOOD_ACCURACY_M ? 'muted' : 'warn'}> · {t('map.accuracy', { m: Math.round(fix.accuracy) })}</span>
      </p>
      <p className="map-question">{t('map.where')}</p>
      <div className="chips">
        {choices.map((c) => (
          <button key={c.label} type="button" className="chip" aria-pressed={picked === c.label} onClick={() => setPicked(picked === c.label ? undefined : c.label)}>
            {c.label}
            {c.distance !== undefined && c.distance > 0 && <span className="chip-meta"> {t('myloc.m', { n: Math.round(c.distance) })}</span>}
          </button>
        ))}
      </div>
      <p className="map-question">{t('map.pickQuestion')}</p>
      <div className="map-pick-row">
        {draft.at ? (
          <>
            <span className="small">{t('map.pickedAt', { m: Math.round(distanceM(fix.coords, draft.at)) })}</span>
            <button type="button" className="link-button" onClick={onPick}>
              {t('map.repick')}
            </button>
            <button type="button" className="link-button" onClick={() => onDraft((d) => ({ ...d, at: undefined }))}>
              {t('map.clearPick')}
            </button>
          </>
        ) : (
          <button type="button" className="action" onClick={onPick}>
            {t('map.pickButton')}
          </button>
        )}
      </div>
      <input className="map-extra" type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('map.extra')} aria-label={t('map.extra')} />
      <div className="actions">
        <button type="submit" className="action primary" disabled={!note}>
          {t('map.send')}
        </button>
        <button type="button" className="action" onClick={onCancel}>
          {t('map.cancel')}
        </button>
      </div>
    </form>
  )
}
