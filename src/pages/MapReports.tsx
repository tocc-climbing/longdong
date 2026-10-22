import { useEffect, useMemo, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { distanceM, type LatLng } from '../geo'
import { LOCALES, useLang } from '../i18n'
import { areaNames, useScaleMap } from '../map/mapData'
import { ScaleMap } from '../map/ScaleMap'
import type { CalibrationUploads } from '../personal/firebase'
import { withCloud } from '../personal/sync'
import { displayName } from '../social/store'

/** 一筆地圖回報 */
interface Report {
  /** 清單與地圖上的編號（1 起算，依回報時間由舊到新，不隨排序改變） */
  no: number
  note: string
  /** 回報者（暱稱，或「未登入的手機 xxxx」） */
  who: string
  /** GPS 位置 */
  coords: LatLng
  accuracy: number
  time: number
  /** 回報者在地圖上點的位置（選填）與離 GPS 幾公尺 */
  picked?: LatLng
  offset?: number
}

type Feature = { properties: { note: string; accuracy: number; time: string; picked?: [number, number] }; geometry: { coordinates: [number, number] } }

/** 每個人（或沒登入的每台手機）只看最新上傳的那一份（每次上傳都是完整的一份） */
function reportsOf(all: CalibrationUploads, who: (id: string) => string): Omit<Report, 'no'>[] {
  return Object.entries(all).flatMap(([id, uploads]) => {
    const latest = Object.values(uploads).reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
    return (JSON.parse(latest.geojson) as { features: Feature[] }).features.map((f) => {
      const coords: LatLng = [f.geometry.coordinates[1], f.geometry.coordinates[0]]
      const picked: LatLng | undefined = f.properties.picked && [f.properties.picked[1], f.properties.picked[0]]
      return {
        note: f.properties.note,
        who: who(id),
        coords,
        accuracy: f.properties.accuracy,
        time: Date.parse(f.properties.time),
        picked,
        offset: picked && Math.round(distanceM(coords, picked)),
      }
    })
  })
}

type Sort = 'new' | 'old' | 'offset' | 'accuracy'

/**
 * 管理頁的「地圖回報」：所有人的回報，一筆一行（編號、說明、回報者、GPS 誤差、在地圖上點的位置偏多少、時間），
 * 可以搜尋說明與回報者、排序。地圖上的編號與清單相同；點一行，地圖移到那一筆並加大標示。
 * 電腦版清單在左、地圖在右（固定不捲動）；手機地圖在上。
 */
export function MapReports({ data, profiles }: { data: LoadedData; profiles: Record<string, { name: string; updatedAt: string }> }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const [raw, setRaw] = useState<{ signedIn: CalibrationUploads; anon: CalibrationUploads }>()
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [selected, setSelected] = useState<number>()

  useEffect(() => {
    let alive = true
    withCloud()
      .then(({ m }) => m.loadCalibrationUploads())
      .then(
        (r) => alive && setRaw(r),
        (err: Error) => alive && setError(err.message),
      )
    return () => {
      alive = false
    }
  }, [])

  const all = useMemo<Report[]>(() => {
    if (!raw) return []
    return [...reportsOf(raw.signedIn, (uid) => displayName(profiles, uid)), ...reportsOf(raw.anon, (id) => t('reports.anon', { id: id.slice(0, 4) }))]
      .sort((a, b) => a.time - b.time)
      .map((r, i) => ({ ...r, no: i + 1 }))
  }, [raw, profiles, t])

  const q = query.trim().toLowerCase()
  const shown = all
    .filter((r) => !q || r.note.toLowerCase().includes(q) || r.who.toLowerCase().includes(q) || String(r.no) === q)
    .sort((a, b) => (sort === 'old' ? a.time - b.time : sort === 'offset' ? (b.offset ?? -1) - (a.offset ?? -1) : sort === 'accuracy' ? b.accuracy - a.accuracy : b.time - a.time))
  const focused = all.find((r) => r.no === selected)
  const time = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  if (error) {
    return (
      <p className="error" role="alert">
        {t('reports.loadFailed', { error })}
      </p>
    )
  }
  if (!raw) return <p className="muted">{t('app.loading')}</p>

  return (
    <div className="map-reports">
      <div className="map-reports-map">
        {map.status === 'ok' && (
          <ScaleMap
            map={map.data}
            areaNames={areaNames(data, lang)}
            marks={shown.map((r) => ({ at: r.coords, picked: r.picked, label: String(r.no), selected: r.no === selected }))}
            focus={focused && { key: `report-${focused.no}`, coords: focused.picked ? [focused.coords, focused.picked] : [focused.coords] }}
          />
        )}
      </div>

      <div className="map-reports-list">
        <div className="map-reports-tools">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.searchReports')} aria-label={t('admin.searchReports')} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('admin.sort')}>
            <option value="new">{t('admin.sort.new')}</option>
            <option value="old">{t('admin.sort.old')}</option>
            <option value="offset">{t('admin.sort.offset')}</option>
            <option value="accuracy">{t('admin.sort.accuracy')}</option>
          </select>
        </div>
        <p className="muted small">{t('admin.reportCount', { n: shown.length, total: all.length })}</p>
        {all.length === 0 && <p className="muted">{t('reports.empty')}</p>}
        <ul className="map-report-rows">
          {shown.map((r) => (
            <li key={r.no}>
              <button type="button" className="map-report-row" aria-pressed={r.no === selected} onClick={() => setSelected(r.no === selected ? undefined : r.no)}>
                <span className="report-no">{r.no}</span>
                <span className="map-report-note">{r.note}</span>
                <span className="map-report-meta">
                  {r.who} · ±{r.accuracy} m{r.offset !== undefined && <span className="report-offset"> · {t('admin.offset', { m: r.offset })}</span>} · {time(r.time)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
