import { useEffect, useSyncExternalStore } from 'react'
import type { LatLng } from '../geo'
import { get } from '../social/store'
import { decodeLine, encodeLine } from './walls'

/**
 * 地圖編輯（所有登入者，版本同 Topo）：每次提交都是一個新版本（完整的形狀，不是差異），保留所有版本；
 * 每個對象顯示最新的版本，刪掉它就回到前一版；沒有任何版本時用原始版（大區域、岩壁：public/rescue/areas.geojson、walls.geojson；步道：scale-map.geojson 裡編輯修改後的版本；道路：scripts/gen-scale-map.ts 自動產生的）。
 *   /v2/mapEdits/area:<大區域>/<版本>        { uid, createdAt, rings }   大區域的形狀
 *   /v2/mapEdits/wall:<分區 key>/<版本>      { uid, createdAt, lines }   分區的岩壁（沿著牆底的折線，可以多條；空字串表示沒有）
 *   /v2/mapEdits/<trails|highway|tunnel|road>/<版本>   { uid, createdAt, lines }   步道與攀岩者路徑、台二線、隧道、其他道路（各自整個路網）
 * 座標格式同岩壁標記（「緯度,經度」以空格分隔，小數 6 位）；多塊（多條）以「|」分隔。
 * 任何人都能讀（REST，Service Worker 快取最後一次讀到的，離線時照樣顯示）；本人與管理員可以刪除版本。
 */

/** 線段的對象（不封閉）→ 地圖上的圖層 */
export const LINE_TARGETS = { trails: 'trail', highway: 'highway', tunnel: 'tunnel', road: 'road' } as const
export type LineTarget = keyof typeof LINE_TARGETS
export const isLineTarget = (target: string): target is LineTarget => target in LINE_TARGETS

export type EditTarget = `area:${string}` | `wall:${string}` | LineTarget
/** 線段（不封閉）的對象：步道、道路、岩壁 */
export const isOpenTarget = (target: string) => isLineTarget(target) || target.startsWith('wall:')

export interface MapEditVersion {
  id: string
  uid: string
  createdAt: number
  /** 多邊形（大區域、分區）或線段（步道） */
  shapes: LatLng[][]
}

export interface MapShapes {
  /** 大區域 key → 多塊多邊形（最新版本） */
  areas: Record<string, LatLng[][]>
  /** 有版本的分區 → 岩壁（最新版本）；沒有版本的分區用原始版 */
  walls: Record<string, LatLng[][]>
  /** 步道、道路（最新版本）；沒有版本的不在裡面，用原始版 */
  lines: Partial<Record<LineTarget, LatLng[][]>>
  /** 每個對象的所有版本（舊到新） */
  versions: Record<string, MapEditVersion[]>
}

/** 分區 ID（longdong/xxx）↔ 資料庫的 key（longdong:xxx，key 不能有 /） */
export const wallTarget = (sectorId: string): EditTarget => `wall:${sectorId.replace('/', ':')}`
/** wall: 對象 → 分區 ID */
export const sectorOf = (target: string) => target.slice(target.indexOf(':') + 1).replace(':', '/')

export const encodeShapes = (shapes: LatLng[][]) => shapes.map(encodeLine).join('|')
const decodeShapesText = (text: string) => (text ? text.split('|').map(decodeLine) : [])

type Stored = Record<string, Record<string, { uid: string; createdAt: number; rings?: string; lines?: string }>>

export function decodeMapEdits(raw: Stored | null): MapShapes {
  const versions: Record<string, MapEditVersion[]> = Object.fromEntries(
    Object.entries(raw ?? {}).map(([target, list]) => [
      target,
      Object.entries(list)
        .map(([id, v]) => ({ id, uid: v.uid, createdAt: v.createdAt, shapes: decodeShapesText(v.rings ?? v.lines ?? '') }))
        .sort((a, b) => a.createdAt - b.createdAt),
    ]),
  )
  const latest = (target: string) => versions[target]?.at(-1)?.shapes
  const targets = Object.keys(versions)
  return {
    areas: Object.fromEntries(targets.filter((t) => t.startsWith('area:') && latest(t)?.length).map((t) => [t.slice('area:'.length), latest(t)!])),
    lines: Object.fromEntries(targets.filter(isLineTarget).map((t) => [t, latest(t)!])),
    walls: Object.fromEntries(targets.filter((t) => t.startsWith('wall:') && latest(t)).map((t) => [sectorOf(t), latest(t)!])),
    versions,
  }
}

const EMPTY: MapShapes = { areas: {}, walls: {}, lines: {}, versions: {} }
let state: MapShapes = EMPTY
let loading: Promise<boolean> | undefined
let requestSeq = 0
const listeners = new Set<() => void>()

/**
 * 讀取（force：提交或刪除後重新讀，繞過 Service Worker 的快取）；讀不到時維持原本的，回傳 false。
 * 同時有多次讀取時只採用最後送出的那次，先送出、後回來的舊結果不會蓋掉新的。
 */
export function loadMapShapes(force = false): Promise<boolean> {
  if (loading && !force) return loading
  const mine = ++requestSeq
  loading = get<Stored>('v2/mapEdits', force).then(
    (raw) => {
      if (mine === requestSeq) {
        state = decodeMapEdits(raw)
        listeners.forEach((l) => l())
      }
      return true
    },
    (err: Error) => {
      if (mine === requestSeq) loading = undefined
      console.warn('mapEdits', err)
      return false
    },
  )
  return loading
}

/** 目前讀到的（提交後確認資料庫的版本真的讀回來了） */
export const currentMapShapes = () => state

export function useMapShapes(): MapShapes {
  useEffect(() => {
    void loadMapShapes()
  }, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Douglas–Peucker 簡化折線（公尺座標） */
export function simplifyLine(pts: [number, number][], tolerance: number): [number, number][] {
  if (pts.length < 3) return pts
  const [a, b] = [pts[0], pts[pts.length - 1]]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  let [worst, index] = [0, 0]
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const d = len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len
    if (d > worst) [worst, index] = [d, i]
  }
  return worst <= tolerance ? [a, b] : [...simplifyLine(pts.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyLine(pts.slice(index), tolerance)]
}

/** 簡化封閉多邊形（公尺座標，不含重複的終點）：自動產生的形狀頂點很密，編輯前先減到容易拖曳的數量 */
export function simplifyRing(ring: [number, number][], tolerance: number): [number, number][] {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
  if (open.length <= 4) return open
  // 從離起點最遠的一點切成兩段各自簡化
  const far = open.reduce((best, p, i) => (Math.hypot(p[0] - open[0][0], p[1] - open[0][1]) > Math.hypot(open[best][0] - open[0][0], open[best][1] - open[0][1]) ? i : best), 0)
  const first = simplifyLine(open.slice(0, far + 1), tolerance)
  const second = simplifyLine([...open.slice(far), open[0]], tolerance)
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

/** 兩點的距離（相對值：經度依緯度縮放，只用來比長短、找中點） */
const span = ([lat1, lng1]: LatLng, [lat2, lng2]: LatLng) => Math.hypot(lat2 - lat1, (lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180))

/** 分區名稱在地圖上的位置：最長的一段岩壁沿線走到一半的那一點；沒有岩壁時沒有位置 */
export function wallLabelAt(lines: LatLng[][]): LatLng | undefined {
  const length = (l: LatLng[]) => l.slice(1).reduce((sum, p, i) => sum + span(l[i], p), 0)
  const longest = lines.filter((l) => l.length > 0).reduce<LatLng[] | undefined>((best, l) => (!best || length(l) > length(best) ? l : best), undefined)
  if (!longest) return undefined
  let rest = length(longest) / 2
  for (let i = 1; i < longest.length; i++) {
    const d = span(longest[i - 1], longest[i])
    if (d >= rest && d > 0) {
      const t = rest / d
      return [longest[i - 1][0] + (longest[i][0] - longest[i - 1][0]) * t, longest[i - 1][1] + (longest[i][1] - longest[i - 1][1]) * t]
    }
    rest -= d
  }
  return longest[0]
}

/** 地圖上的一段岩壁（分區目前的版本） */
export interface SectorWall {
  key: string
  sector: string
  points: LatLng[]
  /** 最後修改的人與時間（原始版沒有） */
  uid?: string
  createdAt?: number
}
