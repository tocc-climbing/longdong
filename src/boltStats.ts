import type { Dataset } from './data/schema'

/**
 * Bolt 統計（舊站 Admin 的「Bolt 統計」）：全部路線的 bolt 與 anchor，依材質、安裝年份、區域加總。
 * 只算硬體表（dataset.hardware）裡的材質；「共用」（與別條路線共用，已算在那條）、無 Anchor、天然固定點、
 * 待查等特殊值不算顆數，待查另外列出。
 */

/** 圖表的數列：顆數多的材質各自一列，其餘合併，避免顏色太多 */
export const BOLT_SERIES = ['316-TW', 'Ti-TW', 'Ti-ETN', 'Ti-U', '316-FX', '304', 'other'] as const
export type BoltSeries = (typeof BOLT_SERIES)[number]

export function seriesOf(material: string): BoltSeries {
  if (material.startsWith('304-')) return '304'
  return (BOLT_SERIES as readonly string[]).includes(material) ? (material as BoltSeries) : 'other'
}

export type SeriesCounts = Record<BoltSeries, number>
const emptyCounts = (): SeriesCounts => Object.fromEntries(BOLT_SERIES.map((s) => [s, 0])) as SeriesCounts

export interface YearRow {
  year: number
  counts: SeriesCounts
  total: number
}

export interface AreaRow {
  id: string
  name: Dataset['areas'][number]['name']
  counts: SeriesCounts
  total: number
}

export interface MaterialRow {
  code: string
  description: string
  count: number
  /** 有安裝年份的最早、最晚一年 */
  firstYear?: number
  lastYear?: number
}

export interface BoltStats {
  total: number
  counts: SeriesCounts
  /** 有安裝年份的顆數 */
  dated: number
  /** 依安裝年份，從最早到最晚，中間沒有安裝的年份也列出（顆數 0） */
  years: YearRow[]
  areas: AreaRow[]
  /** 依顆數多到少 */
  materials: MaterialRow[]
  /** 材質待查、待確認的位置數 */
  unknown: number
}

const UNKNOWN = new Set(['待查', '待確認'])

export function boltStats(dataset: Dataset): BoltStats {
  const hardware = new Map(dataset.hardware.map((h) => [h.code, h.description]))
  const counts = emptyCounts()
  const byYear = new Map<number, SeriesCounts>()
  const byMaterial = new Map<string, MaterialRow>()
  let total = 0
  let dated = 0
  let unknown = 0

  const areas = dataset.areas.map((area): AreaRow => {
    const row: AreaRow = { id: area.id, name: area.name, counts: emptyCounts(), total: 0 }
    for (const route of area.sectors.flatMap((s) => s.routes)) {
      for (const bolt of [...route.bolts, ...route.anchors]) {
        if (UNKNOWN.has(bolt.material)) unknown++
        const description = hardware.get(bolt.material)
        if (description === undefined) continue
        const series = seriesOf(bolt.material)
        total++
        counts[series]++
        row.counts[series]++
        row.total++
        const m = byMaterial.get(bolt.material) ?? { code: bolt.material, description, count: 0 }
        m.count++
        const year = bolt.installed ? Number(bolt.installed.slice(0, 4)) : undefined
        if (year) {
          dated++
          const y = byYear.get(year) ?? emptyCounts()
          y[series]++
          byYear.set(year, y)
          m.firstYear = Math.min(m.firstYear ?? year, year)
          m.lastYear = Math.max(m.lastYear ?? year, year)
        }
        byMaterial.set(bolt.material, m)
      }
    }
    return row
  })

  const known = [...byYear.keys()]
  const years: YearRow[] = []
  if (known.length) {
    for (let year = Math.min(...known); year <= Math.max(...known); year++) {
      const c = byYear.get(year) ?? emptyCounts()
      years.push({ year, counts: c, total: BOLT_SERIES.reduce((n, s) => n + c[s], 0) })
    }
  }

  return {
    total,
    counts,
    dated,
    years,
    areas,
    materials: [...byMaterial.values()].sort((a, b) => b.count - a.count),
    unknown,
  }
}
