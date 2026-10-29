import type { RescuePoint } from '../data/rescue'
import { project, type Marker, type ScaleMapData } from './mapData'

/**
 * 回報位置的選項：依目前位置列出附近可能的地點（由近到遠），讓人一點就選，不必自己打字。
 * 距離用比例尺地圖的平面座標（公尺），地圖本身還在校正，所以範圍放寬一些。
 */
export type ReportOption =
  | { kind: 'area'; id: string; inside: boolean; distance: number }
  | { kind: 'rescue'; no: number; name: RescuePoint['name']; distance: number }
  | { kind: 'marker'; marker: Exclude<Marker, { kind: 'place' }> | Extract<Marker, { kind: 'place' }>; distance: number }

/** 列入選項的最遠距離（公尺） */
export const NEAR = { area: 60, rescue: 80, marker: 50 }
/** 最多列幾個 */
export const MAX_OPTIONS = 6

type Pt = [number, number]

/** 點到線段的距離 */
function segmentDistance([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 點是否在多邊形內（射線法） */
export function insideRing([px, py]: Pt, ring: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 多邊形面積（鞋帶公式，取絕對值） */
export function ringArea(ring: Pt[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return Math.abs(sum) / 2
}

/** 點落在哪一個多邊形裡；套疊時取最小的那塊，大塊中間另外畫的小塊才點得到 */
export function innermost<T>(at: Pt, items: readonly T[], ringsOf: (item: T) => Pt[][]): T | undefined {
  let best: T | undefined
  let bestArea = Infinity
  for (const item of items) {
    for (const ring of ringsOf(item)) {
      const a = ringArea(ring)
      if (a <= bestArea && insideRing(at, ring)) [best, bestArea] = [item, a]
    }
  }
  return best
}

/** 點到多邊形的距離；在裡面為 0 */
export function ringDistance(p: Pt, ring: Pt[]): number {
  if (insideRing(p, ring)) return 0
  let d = Infinity
  for (let i = 0; i < ring.length - 1; i++) d = Math.min(d, segmentDistance(p, ring[i], ring[i + 1]))
  return d
}

export function reportOptions(here: Pt, map: Pick<ScaleMapData, 'areas' | 'markers'>, points: RescuePoint[]): ReportOption[] {
  const options: ReportOption[] = []
  for (const a of map.areas) {
    const distance = Math.min(...a.rings.map((r) => ringDistance(here, r)))
    if (distance <= NEAR.area) options.push({ kind: 'area', id: a.id, inside: distance === 0, distance })
  }
  for (const p of points) {
    if (!p.coords) continue
    const [x, y] = project(p.coords)
    const distance = Math.hypot(x - here[0], y - here[1])
    if (distance <= NEAR.rescue) options.push({ kind: 'rescue', no: p.no, name: p.name, distance })
  }
  for (const m of map.markers) {
    const distance = Math.hypot(m.at[0] - here[0], m.at[1] - here[1])
    if (distance <= NEAR.marker) options.push({ kind: 'marker', marker: m, distance })
  }
  return options.sort((a, b) => a.distance - b.distance).slice(0, MAX_OPTIONS)
}
