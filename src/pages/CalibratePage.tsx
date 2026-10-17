import { useEffect, useState } from 'react'
import { CopyButton } from '../components/CopyButton'
import { ScaleMap } from '../components/ScaleMap'
import type { LoadedData } from '../data/dataset'
import { AREA_RESCUE, formatCoords } from '../data/rescue'
import { appendTrack, loadCalibration, saveCalibration, toGeoJSON, type Calibration } from '../calibration'
import { useScaleMap } from '../scaleMap'
import { useGeolocation } from '../components/MyLocation'

/** 誤差在這以內才適合當校正點 */
const GOOD_ACCURACY_M = 10
const QUICK_NOTES = ['步道岔路', '岩壁底', '區域邊界', '救援點']

/**
 * 比例尺地圖的現場校正（#/calibrate，測試中，沒有放在選單裡）：
 * 在地圖上看 GPS 的位置對不對，在明確的地點記下座標與說明，匯出 GeoJSON 傳回來校正地圖。
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
    if (confirm('清除所有記錄點與軌跡？請先確認已經傳出去。')) setRecords({ marks: [], track: [] })
  }

  const text = JSON.stringify(toGeoJSON(records), null, 1)
  const empty = records.marks.length === 0 && records.track.length < 2

  return (
    <article className="calibrate">
      <h1>比例尺地圖・現場校正</h1>
      <p className="muted small">
        這張圖由救援資訊圖依救援點的 GPS 座標拉成實際比例，救援點之間可能還有幾十公尺的誤差（測試中）。
        到龍洞時，請在明確的地點（救援點、區域邊界、岩壁轉角、步道岔路）記下位置與說明，走步道時可以記錄軌跡，最後把檔案傳回來。
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

      <section className="card" aria-labelledby="cal-send">
        <h2 id="cal-send">傳回記錄</h2>
        {saveError && <p className="small error">這支手機存不了記錄（可能是私密瀏覽）：離開頁面前請先傳出去。</p>}
        <p className="muted small">記錄只存在這支手機上。傳出 GeoJSON 檔案（LINE 可以直接傳檔案），或複製文字貼上。</p>
        <div className="actions">
          <button type="button" className="action primary" onClick={() => void shareFile(text)} disabled={empty}>
            傳送檔案
          </button>
          <CopyButton text={text} className="action" />
          <button type="button" className="action danger" onClick={clearAll} disabled={empty}>
            清除
          </button>
        </div>
      </section>
    </article>
  )
}

/** 用系統分享傳出檔案；不支援分享檔案的瀏覽器改成下載 */
async function shareFile(text: string) {
  const name = `longdong-calibration-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.geojson`
  const file = new File([text], name, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '龍洞比例尺地圖校正記錄' })
      return
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return
      // 分享失敗時改成下載
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
