import { useEffect, useSyncExternalStore } from 'react'
import type { LatLng } from '../geo'
import { get } from '../social/store'
import { decodeLine, encodeLine } from './walls'

/**
 * 地圖編輯（所有登入者，版本同 Topo）：每次提交都是一個新版本（完整的形狀，不是差異），保留所有版本；
 * 每個對象顯示最新的版本，刪掉它就回到前一版；沒有任何版本時用自動產生的（scripts/gen-scale-map.ts）。
 *   /v2/mapEdits/area:<大區域>/<版本>        { uid, createdAt, rings }   大區域的形狀
 *   /v2/mapEdits/sector:<分區 key>/<版本>    { uid, createdAt, rings }   分區的範圍（可以多塊；空字串表示沒有範圍）
 *   /v2/mapEdits/trails/<版本>               { uid, createdAt, lines }   步道與攀岩者路徑（整個路網）
 * 座標格式同岩壁標記（「緯度,經度」以空格分隔，小數 6 位）；多塊（多條）以「|」分隔。
 * 任何人都能讀（REST，Service Worker 快取最後一次讀到的，離線時照樣顯示）；本人與管理員可以刪除版本。
 */

export type EditTarget = `area:${string}` | `sector:${string}` | 'trails'

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
  /** 分區的範圍（最新版本，每塊一筆） */
  sectors: { id: string; sector: string; ring: LatLng[] }[]
  /** 步道（最新版本）；沒有版本時 undefined，用自動產生的 */
  trails?: LatLng[][]
  /** 每個對象的所有版本（舊到新） */
  versions: Record<string, MapEditVersion[]>
}

/** 分區 ID（longdong/xxx）↔ 資料庫的 key（longdong:xxx，key 不能有 /） */
export const sectorTarget = (sectorId: string): EditTarget => `sector:${sectorId.replace('/', ':')}`
const sectorOf = (target: string) => target.slice('sector:'.length).replace(':', '/')

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
    sectors: targets
      .filter((t) => t.startsWith('sector:'))
      .flatMap((t) => (latest(t) ?? []).map((ring, i) => ({ id: `${t}#${i}`, sector: sectorOf(t), ring }))),
    trails: latest('trails'),
    versions,
  }
}

const EMPTY: MapShapes = { areas: {}, sectors: [], versions: {} }
let state: MapShapes = EMPTY
let loading: Promise<void> | undefined
const listeners = new Set<() => void>()

/** 讀取（force：提交或刪除後重新讀）；讀不到時維持原本的 */
export function loadMapShapes(force = false): Promise<void> {
  if (loading && !force) return loading
  loading = get<Stored>('v2/mapEdits').then(
    (raw) => {
      state = decodeMapEdits(raw)
      listeners.forEach((l) => l())
    },
    (err: Error) => {
      loading = undefined
      console.warn('mapEdits', err)
    },
  )
  return loading
}

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
