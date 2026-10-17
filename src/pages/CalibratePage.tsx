import { useEffect, useState } from 'react'
import { CopyButton } from '../components/CopyButton'
import { SignInPrompt } from '../components/SignInPrompt'
import { ScaleMap } from '../components/ScaleMap'
import type { LoadedData } from '../data/dataset'
import { AREA_RESCUE, formatCoords } from '../data/rescue'
import { appendTrack, hasUnuploaded, loadCalibration, saveCalibration, toGeoJSON, uploadCalibration, type Calibration } from '../calibration'
import { useCloud } from '../personal/sync'
import { useScaleMap } from '../scaleMap'
import { useGeolocation } from '../components/MyLocation'
import { LOCALES, localName, useLang, type MessageKey } from '../i18n'

/** 誤差在這以內才適合當校正點 */
const GOOD_ACCURACY_M = 10
const QUICK_NOTES: MessageKey[] = ['cal.quick.junction', 'cal.quick.wallBase', 'cal.quick.boundary', 'cal.quick.rescue']

/**
 * 比例尺地圖的現場校正（#/calibrate，測試中，沒有放在選單裡）：
 * 在地圖上看 GPS 的位置對不對，在明確的地點記下座標與說明，上傳到資料庫用來校正地圖。
 * 給到現場幫忙校正的岩友使用（也請外國岩友幫忙），介面有各種語言。
 */
export function CalibratePage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const [geo, start] = useGeolocation()
  const [records, setRecords] = useState<Calibration>(loadCalibration)
  const [note, setNote] = useState('')
  const [tracking, setTracking] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const areaNames = Object.fromEntries(
    Object.keys(AREA_RESCUE).map((key) => {
      const name = data.areaById.get(`${data.dataset.crag.id}/${key}`)?.name
      return [key, name ? localName(name, lang).main : key]
    }),
  )
  const fix = geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy, time: geo.time } : undefined

  useEffect(() => {
    try {
      saveCalibration(records)
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }, [records])

  useEffect(() => {
    if (tracking && fix) setRecords((r) => ({ ...r, track: appendTrack(r.track, fix) }))
    // 每次有新的定位（時間不同）才加入軌跡
  }, [tracking, fix?.time])

  const mark = () => {
    if (!fix || !note.trim()) return
    setRecords((r) => ({ ...r, marks: [...r.marks, { ...fix, note: note.trim() }] }))
    setNote('')
  }
  const removeMark = (i: number) => {
    if (confirm(t('cal.confirmDelete', { n: i + 1, note: records.marks[i].note }))) setRecords((r) => ({ ...r, marks: r.marks.filter((_, j) => j !== i) }))
  }
  const clearAll = () => {
    if (confirm(t(hasUnuploaded(records) ? 'cal.confirmClearUnsent' : 'cal.confirmClear'))) setRecords({ marks: [], track: [] })
  }

  const text = JSON.stringify(toGeoJSON(records), null, 1)
  const empty = records.marks.length === 0 && records.track.length < 2

  return (
    <article className="calibrate">
      <h1>{t('cal.title')}</h1>
      <p className="muted small">{t('cal.intro')}</p>

      <section className="card" aria-labelledby="cal-gps">
        <h2 id="cal-gps">GPS</h2>
        {geo.status === 'idle' && (
          <button type="button" className="action primary" onClick={start}>
            {t('cal.start')}
          </button>
        )}
        {geo.status === 'locating' && <p className="muted small">{t('cal.locating')}</p>}
        {geo.status === 'error' && (
          <>
            <p className="small error" role="alert">
              {t(geo.code === 'denied' ? 'cal.denied' : 'cal.unavailable')}
            </p>
            <button type="button" className="action" onClick={start}>
              {t('myloc.retry')}
            </button>
          </>
        )}
        {geo.status === 'ok' && (
          <p className="small" role="status">
            <span className="mono">{formatCoords(geo.coords)}</span>
            {/* 誤差每秒都在變：只換顏色、不增減文字，避免整頁跟著跳動 */}
            <span className={geo.accuracy <= GOOD_ACCURACY_M ? 'muted' : 'warn'}> · {t('cal.accuracy', { m: Math.round(geo.accuracy) })}</span>
          </p>
        )}
      </section>

      {map.status === 'ok' && (
        <ScaleMap map={map.data} areaNames={areaNames} here={fix} marks={records.marks.map((m) => m.coords)} track={records.track.map((f) => f.coords)} />
      )}
      {map.status === 'loading' && <p className="muted small">{t('cal.loadingMap')}</p>}
      {map.status === 'error' && (
        <p className="small error" role="alert">
          {t('cal.mapFailed', { error: map.message })}
        </p>
      )}

      <section className="card" aria-labelledby="cal-mark">
        <h2 id="cal-mark">{t('cal.markTitle')}</h2>
        <div className="chips">
          {[...Object.values(areaNames), ...QUICK_NOTES.map((k) => t(k))].map((n) => (
            <button key={n} type="button" className="chip" onClick={() => setNote((v) => (v ? `${v} ${n}` : n))}>
              {n}
            </button>
          ))}
        </div>
        <div className="cal-note">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('cal.placeholder')}
            aria-label={t('cal.noteAria')}
          />
          <button type="button" className="action primary" onClick={mark} disabled={!fix || !note.trim()}>
            {t('cal.record')}
          </button>
        </div>
        <p className="muted small">
          {!fix ? t('cal.hintStart') : !note.trim() ? t('cal.hintNote') : t('cal.hintReady', { m: Math.round(fix.accuracy) })}{' '}
          {t('cal.hintWait', { m: GOOD_ACCURACY_M })}
        </p>

        <div className="actions">
          <button type="button" className={`action${tracking ? ' on' : ''}`} onClick={() => setTracking((v) => !v)} disabled={!fix && !tracking}>
            {t(tracking ? 'cal.trackStop' : 'cal.trackStart')}
          </button>
          <span className="muted small cal-count">{t('cal.trackCount', { n: records.track.length })}</span>
        </div>
      </section>

      {records.marks.length > 0 && (
        <section className="card" aria-labelledby="cal-list">
          <h2 id="cal-list">{t('cal.listTitle', { n: records.marks.length })}</h2>
          <ol className="cal-marks">
            {records.marks.map((m, i) => (
              <li key={m.time + m.note}>
                <span className="cal-mark-no">{i + 1}</span>
                <span className="cal-mark-body">
                  <span>{m.note}</span>
                  <span className="muted small">
                    {formatCoords(m.coords)} · ±{t('myloc.m', { n: Math.round(m.accuracy) })} ·{' '}
                    {new Date(m.time).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <button type="button" className="icon-button small" onClick={() => removeMark(i)} aria-label={t('cal.deleteAria', { n: i + 1 })}>
                  ×
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <UploadSection
        records={records}
        onUploaded={(uploaded) => setRecords((r) => ({ ...r, uploaded, queued: false }))}
        onQueue={() => setRecords((r) => ({ ...r, queued: true }))}
        saveError={saveError}
        empty={empty}
      />

      {!empty && (
        <p className="actions">
          <CopyButton text={text} className="action" />
          <button type="button" className="action danger" onClick={clearAll}>
            {t('cal.clear')}
          </button>
        </p>
      )}
    </article>
  )
}

/** 上傳到資料庫：需要登入；沒有網路時記錄留在手機上，按了上傳就排隊，連上網路（且開著這一頁）時自動上傳 */
function UploadSection({
  records,
  onUploaded,
  onQueue,
  saveError,
  empty,
}: {
  records: Calibration
  onUploaded: (uploaded: Calibration['uploaded']) => void
  onQueue: () => void
  saveError: boolean
  empty: boolean
}) {
  const { lang, t } = useLang()
  const cloud = useCloud()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { uploaded } = records
  const pending = hasUnuploaded(records)
  const signedIn = cloud.status === 'signed-in'
  const online = signedIn && cloud.connected

  useEffect(() => {
    if (records.queued && online && !busy) void upload()
    // 只在連線狀態改變、或剛排隊時檢查
  }, [records.queued, online])

  const upload = async () => {
    setBusy(true)
    setError(undefined)
    try {
      onUploaded(await uploadCalibration(records))
    } catch (err) {
      setError(t('cal.uploadFailed', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-labelledby="cal-send">
      <h2 id="cal-send">{t('cal.uploadTitle')}</h2>
      {saveError && <p className="small error">{t('cal.saveError')}</p>}
      {!signedIn ? (
        <SignInPrompt message={t('cal.signIn')} />
      ) : (
        <>
          <p className="muted small">{t('cal.uploadDesc', { name: cloud.user?.name ?? '' })}</p>
          {!online && (
            <p className="small warn">{t(records.queued ? 'cal.offlineQueued' : 'cal.offline')}</p>
          )}
          <button
            type="button"
            className="action primary"
            onClick={() => (online ? void upload() : onQueue())}
            disabled={empty || busy || (!online && records.queued)}
          >
            {t(busy ? 'cal.uploading' : !online && records.queued ? 'cal.waiting' : 'cal.upload')}
          </button>
        </>
      )}
      {uploaded && (
        <p className={`small ${pending ? 'warn' : 'muted'}`} role="status">
          {t('cal.uploaded', {
            time: new Date(uploaded.time).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit' }),
            marks: uploaded.marks,
            track: uploaded.track,
          })}
          {pending && t('cal.uploadedPending')}
        </p>
      )}
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
