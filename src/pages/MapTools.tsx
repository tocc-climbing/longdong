import { useState } from 'react'
import { findSector, type LoadedData } from '../data/dataset'
import type { LatLng } from '../geo'
import { LOCALES, localName, useLang } from '../i18n'
import type { ReportTarget } from '../map/calibration'
import { WALL_MAX_POINTS, type Wall } from '../map/walls'

/** 分區的顯示名稱：「區域 · 分區」；分區已不存在時寫明 ID */
export function sectorLabel(data: LoadedData, sectorId: string, lang: Parameters<typeof localName>[1]): string {
  const found = findSector(data, sectorId)
  return found ? `${localName(found.area.name, lang).main} · ${localName(found.sector.name, lang).main}` : sectorId
}

/** 選分區：依區域分組 */
function SectorSelect({ data, value, onChange, label }: { data: LoadedData; value: string; onChange: (sector: string) => void; label: string }) {
  const { lang } = useLang()
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {data.dataset.areas.map((area) => (
        <optgroup key={area.id} label={localName(area.name, lang).main}>
          {area.sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {localName(sector.name, lang).main}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/**
 * 畫岩壁的工具列（電腦版、登入者）：選分區，在地圖上沿著牆底點出折線，儲存。
 * 地圖上的點由地圖頁收集（pick），這裡只顯示點數與按鈕。
 */
export function WallBar({
  data,
  points,
  sector,
  saving,
  onSector,
  onUndo,
  onSave,
  onCancel,
}: {
  data: LoadedData
  points: LatLng[]
  sector: string
  saving: boolean
  onSector: (sector: string) => void
  onUndo: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useLang()
  return (
    <div className="map-pick-bar wall-bar" role="status">
      <span>{t(points.length >= WALL_MAX_POINTS ? 'wall.full' : 'wall.prompt', { n: points.length })}</span>
      <SectorSelect data={data} value={sector} onChange={onSector} label={t('wall.chooseSector')} />
      <button type="button" className="action" disabled={points.length === 0} onClick={onUndo}>
        {t('wall.undo')}
      </button>
      <button type="button" className="action primary" disabled={points.length < 2 || !sector || saving} onClick={onSave}>
        {t('wall.save')}
      </button>
      <button type="button" className="action" onClick={onCancel}>
        {t('map.cancel')}
      </button>
    </div>
  )
}

/** 點到一段岩壁：分區、誰畫的、什麼時候；本人與管理員可以刪除 */
export function WallDetails({ data, wall, author, canDelete, onDelete }: { data: LoadedData; wall: Wall; author: string; canDelete: boolean; onDelete: () => void }) {
  const { lang, t } = useLang()
  const date = new Date(wall.createdAt).toLocaleDateString(LOCALES[lang])
  return (
    <>
      <p>{sectorLabel(data, wall.sector, lang)}</p>
      <p className="muted small">{t('wall.by', { name: author, date })}</p>
      {canDelete && (
        <div className="actions">
          <button type="button" className="action danger" onClick={() => confirm(t('wall.confirmDelete')) && onDelete()}>
            {t('wall.delete')}
          </button>
        </div>
      )}
    </>
  )
}

/**
 * 手動回報（不在現場）：位置是在地圖上點的，選是哪個分區的牆底或哪條路線的起攀點，可以補充說明。
 * 預設選點的位置所在的區域。
 */
export function ManualReportForm({
  data,
  at,
  areaKey,
  onRepick,
  onSubmit,
  onCancel,
}: {
  data: LoadedData
  at: LatLng
  /** 點的位置所在的大區域（地圖上的區域 key） */
  areaKey?: string
  onRepick: () => void
  onSubmit: (note: string, target: ReportTarget) => void
  onCancel: () => void
}) {
  const { lang, t } = useLang()
  const crag = data.dataset.crag.id
  const [areaId, setAreaId] = useState(() => (areaKey && data.areaById.has(`${crag}/${areaKey}`) ? `${crag}/${areaKey}` : ''))
  const [sectorId, setSectorId] = useState('')
  const [routeId, setRouteId] = useState('')
  const [extra, setExtra] = useState('')
  const area = data.areaById.get(areaId)
  const sector = area?.sectors.find((s) => s.id === sectorId)
  const route = sector?.routes.find((r) => r.id === routeId)
  const routeName = (r: { number?: string; name: Parameters<typeof localName>[0] }) => `${r.number ? `#${r.number} ` : ''}${localName(r.name, lang).main}`

  const submit = () => {
    if (!area || !sector) return
    // 說明：管理頁的清單直接看得懂（同路線頁的回報：「#62 火龍 · 起攀點」「地下二樓 · 牆底」）
    const kind = route ? 'start' : 'base'
    const what = route ? routeName(route) : localName(sector.name, lang).main
    const note = [`${what} · ${t(`place.kind.${kind}`)}`, extra.trim()].filter(Boolean).join(' · ')
    onSubmit(note, { kind, areaId: area.id, sectorId: sector.id, ...(route ? { routeId: route.id } : {}) })
  }

  return (
    <form
      className="manual-report"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <p className="small muted">
        {t('map.manualHint')}{' '}
        <button type="button" className="link-button" onClick={onRepick}>
          {t('map.repick')}
        </button>
      </p>
      <p className="small mono">{at.map((n) => n.toFixed(6)).join(', ')}</p>
      <label>
        {t('map.manualArea')}
        <select
          value={areaId}
          onChange={(e) => {
            setAreaId(e.target.value)
            setSectorId('')
            setRouteId('')
          }}
        >
          <option value="" />
          {data.dataset.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {localName(a.name, lang).main}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('map.manualSector')}
        <select
          value={sectorId}
          disabled={!area}
          onChange={(e) => {
            setSectorId(e.target.value)
            setRouteId('')
          }}
        >
          <option value="" />
          {area?.sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {localName(s.name, lang).main}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('map.manualRoute')}
        <select value={routeId} disabled={!sector} onChange={(e) => setRouteId(e.target.value)}>
          <option value="">{t('map.manualWholeWall')}</option>
          {sector?.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {routeName(r)}
            </option>
          ))}
        </select>
      </label>
      <input className="map-extra" type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('map.extra')} aria-label={t('map.extra')} />
      <div className="actions">
        <button type="submit" className="action primary" disabled={!sector}>
          {t('map.send')}
        </button>
        <button type="button" className="action" onClick={onCancel}>
          {t('map.cancel')}
        </button>
      </div>
    </form>
  )
}
