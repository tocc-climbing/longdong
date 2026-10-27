import { useState } from 'react'
import { findSector, type LoadedData } from '../data/dataset'
import type { LatLng } from '../geo'
import { LOCALES, localName, useLang } from '../i18n'
import type { ReportTarget } from '../map/calibration'
import { wallTarget, type SectorWall } from '../map/shapes'
import { href } from '../router'

/** 分區的顯示名稱：「區域 · 分區」；分區已不存在時寫明 ID */
export function sectorLabel(data: LoadedData, sectorId: string, lang: Parameters<typeof localName>[1]): string {
  const found = findSector(data, sectorId)
  return found ? `${localName(found.area.name, lang).main} · ${localName(found.sector.name, lang).main}` : sectorId
}

/** 點到一段岩壁：分區、最後誰改的、什麼時候；電腦版登入後可以到編輯模式修改（岩壁的修改都在編輯模式，有完整紀錄） */
export function WallDetails({ data, wall, author, canEdit }: { data: LoadedData; wall: SectorWall; author: string; canEdit: boolean }) {
  const { lang, t } = useLang()
  const date = new Date(wall.createdAt).toLocaleDateString(LOCALES[lang])
  return (
    <>
      <p>{sectorLabel(data, wall.sector, lang)}</p>
      <p className="muted small">{t('wall.by', { name: author, date })}</p>
      {canEdit && (
        <div className="actions">
          <a className="action" href={href.edit('map', wallTarget(wall.sector))}>
            {t('wall.edit')}
          </a>
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
