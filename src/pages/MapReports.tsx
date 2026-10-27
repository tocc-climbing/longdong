import { useEffect, useMemo, useState } from 'react'
import { findSector, type LoadedData } from '../data/dataset'
import { LOCALES, localName, useLang } from '../i18n'
import { useWide } from '../layout'
import type { ReportTarget } from '../map/calibration'
import { areaNames, useScaleMap } from '../map/mapData'
import { ScaleMap } from '../map/ScaleMap'
import { pinsFromGeoJSON, writePins, type StoredPin } from '../map/reportPins'
import { reportsOf, type UploadScope, type UploadedReport } from '../map/uploadedReports'
import type { CalibrationUploads } from '../personal/firebase'
import { withCloud } from '../personal/sync'
import { displayName } from '../social/store'

/** 一筆地圖回報，加上清單與地圖上的編號（1 起算，依回報時間由舊到新，不隨排序改變） */
type Report = UploadedReport & { no: number }

type Sort = 'new' | 'old' | 'offset' | 'accuracy'

/**
 * 管理頁的「地圖回報」：所有人的回報，一筆一行（編號、說明、回報者、GPS 誤差或「手動」、在地圖上點的位置偏多少、時間），
 * 可以搜尋說明與回報者、排序。地圖上的編號與清單相同；點一行，地圖移到那一筆並加大標示。
 * 電腦版清單在左、地圖在右（固定不捲動），可以切換航照底圖；手機地圖在上。
 */
export function MapReports({ data, profiles }: { data: LoadedData; profiles: Record<string, { name: string; updatedAt: string }> }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const [raw, setRaw] = useState<{ signedIn: CalibrationUploads; anon: CalibrationUploads }>()
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [selected, setSelected] = useState<number>()
  const [scope, setScope] = useState<UploadScope>('latest')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string>()
  // 航照底圖只在電腦版：用來對照回報點、區域邊界與真實岩壁
  const wide = useWide()
  const [ortho, setOrtho] = useState(false)

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
    const place = ({ sectorId }: ReportTarget) => {
      const found = findSector(data, sectorId)
      return found ? `${localName(found.area.name, lang).main} · ${localName(found.sector.name, lang).main}` : t('reports.unknownSector', { id: sectorId })
    }
    return [
      ...reportsOf(raw.signedIn, (uid) => displayName(profiles, uid), place, scope),
      ...reportsOf(raw.anon, (id) => t('reports.anon', { id: id.slice(0, 4) }), place, scope),
    ]
      .sort((a, b) => a.time - b.time)
      .map((r, i) => ({ ...r, no: i + 1 }))
  }, [raw, profiles, t, data, lang, scope])

  /** 把已經上傳的所有回報（登入的、沒登入的裝置）匯入去識別的副本（修改地圖的人當參考）；已經有的略過，可以重複按 */
  const importPins = async () => {
    if (!raw) return
    setImporting(true)
    setImportMsg(undefined)
    try {
      const entries = new Map<string, StoredPin>()
      for (const [owner, list] of [...Object.entries(raw.signedIn), ...Object.entries(raw.anon)]) {
        for (const upload of Object.values(list)) for (const [key, pin] of await pinsFromGeoJSON(upload.geojson, owner)) entries.set(key, pin)
      }
      setImportMsg(t('admin.pinsImported', { added: await writePins([...entries]), total: entries.size }))
    } catch (err) {
      setImportMsg(t('admin.pinsImportFailed', { error: (err as Error).message }))
    } finally {
      setImporting(false)
    }
  }

  const q = query.trim().toLowerCase()
  const shown = all
    .filter((r) => !q || r.note.toLowerCase().includes(q) || r.place?.toLowerCase().includes(q) || r.who.toLowerCase().includes(q) || String(r.no) === q)
    .sort((a, b) => (sort === 'old' ? a.time - b.time : sort === 'offset' ? (b.offset ?? -1) - (a.offset ?? -1) : sort === 'accuracy' ? (b.accuracy ?? -1) - (a.accuracy ?? -1) : b.time - a.time))
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
            ortho={wide && ortho}
            topLeft={
              wide && (
                <button type="button" className="sm-chip" aria-pressed={ortho} onClick={() => setOrtho(!ortho)}>
                  {t('admin.ortho')}
                </button>
              )
            }
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
          <select value={scope} onChange={(e) => setScope(e.target.value as UploadScope)} aria-label={t('admin.scope')}>
            <option value="latest">{t('admin.scope.latest')}</option>
            <option value="all">{t('admin.scope.all')}</option>
          </select>
        </div>
        <p className="muted small">{t('admin.reportCount', { n: shown.length, total: all.length })}</p>
        <p className="small">
          <button type="button" className="link-button" disabled={importing} onClick={() => void importPins()}>
            {t('admin.importPins')}
          </button>
          {importMsg && <span className="muted"> {importMsg}</span>}
        </p>
        {all.length === 0 && <p className="muted">{t('reports.empty')}</p>}
        <ul className="map-report-rows">
          {shown.map((r) => (
            <li key={r.no}>
              <button type="button" className="map-report-row" aria-pressed={r.no === selected} onClick={() => setSelected(r.no === selected ? undefined : r.no)}>
                <span className="report-no">{r.no}</span>
                <span className="map-report-note">{r.note}</span>
                <span className="map-report-meta">
                  {r.place && `${r.place} · `}
                  {r.who} · {r.accuracy === undefined ? t('reports.manual') : `±${r.accuracy} m`}{r.offset !== undefined && <span className="report-offset"> · {t('admin.offset', { m: r.offset })}</span>} · {time(r.time)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
