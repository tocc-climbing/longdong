import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ScaleMap } from '../components/ScaleMap'
import { SignInPrompt } from '../components/SignInPrompt'
import { useGeolocation } from '../components/MyLocation'
import { appendTrack, hasUnuploaded, loadCalibration, saveCalibration, uploadCalibration, type Calibration } from '../calibration'
import type { LoadedData } from '../data/dataset'
import { AREA_RESCUE, RESCUE_POINTS, formatCoords } from '../data/rescue'
import { localName, useLang, type MessageKey, type Translate } from '../i18n'
import { useCloud } from '../personal/sync'
import { reportOptions, type ReportOption } from '../reportOptions'
import { project, useScaleMap } from '../scaleMap'

/** 誤差在這以內才適合當校正點 */
const GOOD_ACCURACY_M = 10
/** 附近沒有明確地點時，也可以選的一般描述 */
const GENERIC: MessageKey[] = ['map.quick.trail', 'map.quick.wallBase', 'map.quick.boundary']
const INTRO_KEY = 'longdong.map.intro'
/** 回報後的提示顯示多久（毫秒） */
const TOAST_MS = 4000

/**
 * 地圖（#/map）：照比例尺的龍洞地圖，打開就開始定位。
 * 地圖還在校正：第一次使用先說明可能有誤差；左下「回報」依目前位置列出附近的地點，選一下就記錄下來，
 * 「軌跡」記錄走過的路。記錄先存在手機上，登入且連上網路時自動上傳（v2/calibration），用來校正地圖。
 */
export function MapPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const [geo, start] = useGeolocation()
  const cloud = useCloud()
  const [records, setRecords] = useState<Calibration>(loadCalibration)
  const [tracking, setTracking] = useState(false)
  const [intro, setIntro] = useState(() => !seenIntro())
  const [reporting, setReporting] = useState(false)
  const [toast, setToast] = useState<string>()
  const [uploading, setUploading] = useState(false)

  const areaNames = Object.fromEntries(
    Object.keys(AREA_RESCUE).map((key) => {
      const name = data.areaById.get(`${data.dataset.crag.id}/${key}`)?.name
      return [key, name ? localName(name, lang).main : key]
    }),
  )
  const fix = geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy, time: geo.time } : undefined
  const signedIn = cloud.status === 'signed-in'
  const online = signedIn && cloud.connected

  // 打開地圖就開始定位（瀏覽器第一次會詢問權限）
  useEffect(start, [])

  useEffect(() => {
    try {
      saveCalibration(records)
    } catch {
      setToast(t('map.saveError'))
    }
  }, [records])

  useEffect(() => {
    if (tracking && fix) setRecords((r) => ({ ...r, track: appendTrack(r.track, fix) }))
    // 每次有新的定位（時間不同）才加入軌跡
  }, [tracking, fix?.time])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // 有沒上傳的記錄，且已登入、連上網路：自動上傳（每次都是完整的一份）
  useEffect(() => {
    if (!records.queued || !online || uploading) return
    setUploading(true)
    uploadCalibration(records)
      .then((uploaded) => {
        setRecords((r) => ({ ...r, uploaded, queued: hasUnuploaded({ ...r, uploaded }) }))
        setToast(t('map.sent'))
      })
      .catch((err: Error) => setToast(t('map.uploadFailed', { error: err.message })))
      .finally(() => setUploading(false))
  }, [records.queued, online, uploading])

  const report = (note: string) => {
    if (!fix) return
    setRecords((r) => ({ ...r, marks: [...r.marks, { ...fix, note }], queued: true }))
    setReporting(false)
    if (!signedIn) setToast(t('map.needSignIn'))
    else if (!cloud.connected) setToast(t('map.queued'))
  }

  const toggleTrack = () => {
    // 停止時把這段軌跡排進上傳
    if (tracking && records.track.length >= 2) setRecords((r) => ({ ...r, queued: true }))
    setTracking((v) => !v)
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
          areaNames={areaNames}
          here={fix}
          marks={records.marks.map((m) => m.coords)}
          track={records.track.map((f) => f.coords)}
          onLocate={() => geo.status !== 'ok' && geo.status !== 'locating' && start()}
          topLeft={
            <button type="button" className="sm-chip" onClick={() => setIntro(true)}>
              {t('map.beta')}
              {pending && <span className="sm-chip-dot" aria-label={t('map.pending')} />}
            </button>
          }
          bottomLeft={
            <>
              <button type="button" className="sm-control sm-report" onClick={() => setReporting(true)}>
                {t('map.report')}
              </button>
              <button type="button" className={`sm-control sm-track${tracking ? ' on' : ''}`} onClick={toggleTrack} aria-pressed={tracking}>
                {t(tracking ? 'map.trackStop' : 'map.trackStart')}
              </button>
            </>
          }
        />
      ) : (
        <p className={map.status === 'error' ? 'small error map-status' : 'muted small map-status'} role={map.status === 'error' ? 'alert' : 'status'}>
          {map.status === 'error' ? t('map.loadFailed', { error: map.message }) : t('app.loading')}
        </p>
      )}

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
            areaNames={areaNames}
            onSubmit={report}
            onCancel={() => setReporting(false)}
          />
        )}
        {!signedIn && <SignInPrompt message={t('map.signIn')} compact />}
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

function ReportForm({
  fix,
  options,
  areaNames,
  onSubmit,
  onCancel,
}: {
  fix?: { coords: [number, number]; accuracy: number }
  options: ReportOption[]
  areaNames: Record<string, string>
  onSubmit: (note: string) => void
  onCancel: () => void
}) {
  const { lang, t } = useLang()
  const [picked, setPicked] = useState<string>()
  const [extra, setExtra] = useState('')
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

/** 彈窗：手機從下方滑出、電腦置中；Esc 或點外面關閉 */
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="sheet"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={id}
    >
      <div className="sheet-body">
        <h2 id={id}>{title}</h2>
        {open && children}
      </div>
    </dialog>
  )
}
