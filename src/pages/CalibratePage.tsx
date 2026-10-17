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

/** 誤差在這以內才適合當校正點 */
const GOOD_ACCURACY_M = 10
const QUICK_NOTES = ['步道岔路', '岩壁底', '區域邊界', '救援點']

/**
 * 比例尺地圖的現場校正（#/calibrate，測試中，沒有放在選單裡）：
 * 在地圖上看 GPS 的位置對不對，在明確的地點記下座標與說明，上傳到資料庫用來校正地圖。
 * 只給到現場幫忙校正的岩友使用，介面只有中文。
 */
export function CalibratePage({ data }: { data: LoadedData }) {
  const map = useScaleMap()
  const [geo, start] = useGeolocation()
  const [records, setRecords] = useState<Calibration>(loadCalibration)
  const [note, setNote] = useState('')
  const [tracking, setTracking] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const areaNames = Object.fromEntries(
    Object.keys(AREA_RESCUE).map((key) => [key, data.areaById.get(`${data.dataset.crag.id}/${key}`)?.name.zh ?? key]),
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
    if (confirm(`刪除第 ${i + 1} 點「${records.marks[i].note}」？`)) setRecords((r) => ({ ...r, marks: r.marks.filter((_, j) => j !== i) }))
  }
  const clearAll = () => {
    if (confirm(hasUnuploaded(records) ? '還有記錄沒上傳，確定清除所有記錄點與軌跡？' : '清除所有記錄點與軌跡？')) setRecords({ marks: [], track: [] })
  }

  const text = JSON.stringify(toGeoJSON(records), null, 1)
  const empty = records.marks.length === 0 && records.track.length < 2

  return (
    <article className="calibrate">
      <h1>比例尺地圖・現場校正</h1>
      <p className="muted small">
        這張圖由救援資訊圖依救援點的 GPS 座標拉成實際比例，救援點之間可能還有幾十公尺的誤差（測試中）。
        到龍洞時，請在明確的地點（救援點、區域邊界、岩壁轉角、步道岔路）記下位置與說明，走步道時可以記錄軌跡，最後登入並上傳。
      </p>

      <section className="card" aria-labelledby="cal-gps">
        <h2 id="cal-gps">GPS</h2>
        {geo.status === 'idle' && (
          <button type="button" className="action primary" onClick={start}>
            開始定位
          </button>
        )}
        {geo.status === 'locating' && <p className="muted small">定位中…（第一次可能要一分鐘）</p>}
        {geo.status === 'error' && (
          <>
            <p className="small error" role="alert">
              {geo.code === 'denied' ? '沒有定位權限：請到瀏覽器或系統設定允許定位' : '暫時取不到位置'}
            </p>
            <button type="button" className="action" onClick={start}>
              重試
            </button>
          </>
        )}
        {geo.status === 'ok' && (
          <p className="small" role="status">
            <span className="mono">{formatCoords(geo.coords)}</span>
            <span className={geo.accuracy <= GOOD_ACCURACY_M ? 'muted' : 'warn'}> · 誤差約 {Math.round(geo.accuracy)} 公尺</span>
            {geo.accuracy > GOOD_ACCURACY_M && <span className="warn">（等到 {GOOD_ACCURACY_M} 公尺以內再記錄比較準）</span>}
          </p>
        )}
      </section>

      {map.status === 'ok' && (
        <ScaleMap map={map.data} areaNames={areaNames} here={fix} marks={records.marks.map((m) => m.coords)} track={records.track.map((f) => f.coords)} />
      )}
      {map.status === 'loading' && <p className="muted small">載入地圖…</p>}
      {map.status === 'error' && (
        <p className="small error" role="alert">
          地圖載入失敗：{map.message}
        </p>
      )}

      <section className="card" aria-labelledby="cal-mark">
        <h2 id="cal-mark">記錄這一點</h2>
        <div className="chips">
          {[...Object.values(areaNames), ...QUICK_NOTES].map((n) => (
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
            placeholder="這裡是哪裡？例如：鐘塔 · 岩壁北端轉角"
            aria-label="地點說明"
          />
          <button type="button" className="action primary" onClick={mark} disabled={!fix || !note.trim()}>
            記錄
          </button>
        </div>
        <p className="muted small">
          {!fix ? '先開始定位。' : !note.trim() ? '先寫下這裡是哪裡。' : `會記錄目前的位置（誤差約 ${Math.round(fix.accuracy)} 公尺）。`}
          站在原地等誤差變小再按，比較準。
        </p>

        <div className="actions">
          <button type="button" className={`action${tracking ? ' on' : ''}`} onClick={() => setTracking((v) => !v)} disabled={!fix && !tracking}>
            {tracking ? '停止記錄軌跡' : '開始記錄軌跡'}
          </button>
          <span className="muted small cal-count">軌跡 {records.track.length} 點</span>
        </div>
      </section>

      {records.marks.length > 0 && (
        <section className="card" aria-labelledby="cal-list">
          <h2 id="cal-list">已記錄 {records.marks.length} 點</h2>
          <ol className="cal-marks">
            {records.marks.map((m, i) => (
              <li key={m.time + m.note}>
                <span className="cal-mark-no">{i + 1}</span>
                <span className="cal-mark-body">
                  <span>{m.note}</span>
                  <span className="muted small">
                    {formatCoords(m.coords)} · ±{Math.round(m.accuracy)} 公尺 ·{' '}
                    {new Date(m.time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <button type="button" className="icon-button small" onClick={() => removeMark(i)} aria-label={`刪除第 ${i + 1} 點`}>
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
            清除
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
      setError(`上傳失敗：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-labelledby="cal-send">
      <h2 id="cal-send">上傳記錄</h2>
      {saveError && <p className="small error">這支手機存不了記錄（可能是私密瀏覽）：離開頁面前請先上傳。</p>}
      {!signedIn ? (
        <SignInPrompt message="上傳前請先登入。記錄會連同帳號存到資料庫，只有你和管理員看得到，用來校正地圖；刪除帳號時一併刪除。" />
      ) : (
        <>
          <p className="muted small">
            記錄會連同帳號（{cloud.user?.name}）存到資料庫，只有你和管理員看得到。每次上傳都是完整的一份，可以重複上傳。
          </p>
          {!online && (
            <p className="small warn">
              {records.queued ? '沒有網路：已排隊，連上網路時會自動上傳（請開著這一頁）。' : '沒有網路：記錄會留在這支手機上。按「上傳記錄」排隊，連上網路時自動上傳。'}
            </p>
          )}
          <button
            type="button"
            className="action primary"
            onClick={() => (online ? void upload() : onQueue())}
            disabled={empty || busy || (!online && records.queued)}
          >
            {busy ? '上傳中…' : !online && records.queued ? '等待網路…' : '上傳記錄'}
          </button>
        </>
      )}
      {uploaded && (
        <p className={`small ${pending ? 'warn' : 'muted'}`} role="status">
          已上傳 {new Date(uploaded.time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}（{uploaded.marks} 點、軌跡 {uploaded.track} 點）
          {pending && '，之後新增的記錄還沒上傳'}
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
