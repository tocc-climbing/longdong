import type { LoadedData } from './data/dataset'
import type { Area, Sector } from './data/schema'
import { href, type Page } from './router'

/**
 * 電腦版的方向鍵瀏覽，像檔案總管的分欄：←→ 切換層級（大區域／區域／路線），↑↓ 在該層級內移動。
 * 純函式：輸入目前的頁面、層級、清單上的路線連結，回傳新的層級與要前往的網址。
 */
export type Level = 'area' | 'sector' | 'route'

type NavData = Pick<LoadedData, 'dataset' | 'areaById' | 'sectorById' | 'routeById'>

export interface NavInput {
  page: Page
  level: Level
  data: NavData
  /** 清單上每一條路線的連結（依畫面順序） */
  rows: string[]
  /** 目前選中的路線在 rows 的位置；沒有時為 -1 */
  selected: number
}

export interface NavResult {
  level: Level
  /** 要前往的網址；只換層級時沒有 */
  hash?: string
  /** 選中的路線在 rows 的位置（捲動到看得見） */
  row?: number
}

/** 目前所在的大區域與區域；只有一個區域的大區域，區域就是那一個 */
export function placeOf(page: Page, data: NavData): { area?: Area; sector?: Sector } {
  if (page.name === 'area') {
    const area = data.areaById.get(page.id)
    return { area, sector: area?.sectors.length === 1 ? area.sectors[0] : undefined }
  }
  const ref = page.name === 'sector' ? data.sectorById.get(page.id) : page.name === 'route' ? data.routeById.get(page.id) : undefined
  return ref ? { area: ref.area, sector: ref.sector } : {}
}

/** 沒有用鍵盤切換過層級時的預設：有多個區域的大區域頁是「大區域」，其他是「路線」 */
export function defaultLevel(page: Page, data: NavData): Level {
  const { area, sector } = placeOf(page, data)
  return area && !sector && !page.detail ? 'area' : 'route'
}

const clamp = (i: number, n: number) => Math.min(n - 1, Math.max(0, i))

export function keyNav(key: string, { page, level, data, rows, selected }: NavInput): NavResult | undefined {
  const { area, sector } = placeOf(page, data)
  const multi = !!area && area.sectors.length > 1
  const firstRow = (next: Level): NavResult =>
    selected < 0 && rows.length > 0 ? { level: next, hash: rows[0], row: 0 } : { level: next }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const d = key === 'ArrowDown' ? 1 : -1
    if (level === 'route') {
      if (rows.length === 0) return undefined
      const next = selected < 0 ? 0 : clamp(selected + d, rows.length)
      return next === selected ? { level } : { level, hash: rows[next], row: next }
    }
    const list: { id: string }[] = level === 'area' ? data.dataset.areas : (area?.sectors ?? [])
    if (list.length === 0) return undefined
    const at = list.findIndex((x) => x.id === (level === 'area' ? area?.id : sector?.id))
    const next = at < 0 ? 0 : clamp(at + d, list.length)
    if (next === at) return { level }
    return { level, hash: level === 'area' ? href.area(list[next].id) : href.sector(list[next].id) }
  }

  if (key === 'ArrowRight') {
    if (level === 'route' || !area) return undefined
    if (level === 'area' && multi) return sector ? { level: 'sector' } : { level: 'sector', hash: href.sector(area.sectors[0].id) }
    return firstRow('route')
  }

  if (key === 'ArrowLeft') {
    if (level === 'area' || !area) return undefined
    return { level: level === 'route' && multi ? 'sector' : 'area' }
  }

  return undefined
}
