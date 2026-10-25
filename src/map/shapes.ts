import { useEffect, useSyncExternalStore } from 'react'
import type { LatLng } from '../geo'
import { get } from '../social/store'
import { decodeLine, encodeLine } from './walls'

/**
 * 管理員調整的地圖多邊形（存在資料庫，所有人即時看到，不必重新發布）：
 *   /v2/mapShapes/areas/<大區域>   { rings, uid, updatedAt }   取代自動產生（scripts/gen-scale-map.ts）的大區域形狀
 *   /v2/mapShapes/sectors/<id>     { sector, ring, uid, updatedAt }   分區的範圍，一個分區可以有多塊
 * ring 的格式同岩壁標記（「緯度,經度」以空格分隔，小數 6 位）；rings 是多塊以「|」分隔。
 * 用 REST 讀（沒登入也能看），Service Worker 快取最後一次讀到的，離線時照樣顯示。
 */

export interface SectorShape {
  id: string
  sector: string
  ring: LatLng[]
}

export interface MapShapes {
  /** 大區域 key → 多塊多邊形 */
  areas: Record<string, LatLng[][]>
  sectors: SectorShape[]
}

interface StoredShapes {
  areas?: Record<string, { rings: string }>
  sectors?: Record<string, { sector: string; ring: string }>
}

export const encodeRings = (rings: LatLng[][]) => rings.map(encodeLine).join('|')

export function decodeShapes(raw: StoredShapes | null): MapShapes {
  return {
    areas: Object.fromEntries(Object.entries(raw?.areas ?? {}).map(([key, a]) => [key, a.rings.split('|').map(decodeLine)])),
    sectors: Object.entries(raw?.sectors ?? {}).map(([id, s]) => ({ id, sector: s.sector, ring: decodeLine(s.ring) })),
  }
}

const EMPTY: MapShapes = { areas: {}, sectors: [] }
let state: MapShapes = EMPTY
let loading: Promise<void> | undefined
const listeners = new Set<() => void>()

/** 讀取（force：管理員存檔後重新讀）；讀不到時維持原本的（沒有調整過就是自動產生的形狀） */
export function loadMapShapes(force = false): Promise<void> {
  if (loading && !force) return loading
  loading = get<StoredShapes>('v2/mapShapes').then(
    (raw) => {
      state = decodeShapes(raw)
      listeners.forEach((l) => l())
    },
    (err: Error) => {
      loading = undefined
      console.warn('mapShapes', err)
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

/** Douglas–Peucker 簡化（公尺座標的封閉多邊形，不含重複的終點）：自動產生的形狀頂點很密，編輯前先減到容易拖曳的數量 */
export function simplifyRing(ring: [number, number][], tolerance: number): [number, number][] {
  const line = (pts: [number, number][]): [number, number][] => {
    if (pts.length < 3) return pts
    const [a, b] = [pts[0], pts[pts.length - 1]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    let [worst, index] = [0, 0]
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]
      const d = len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len
      if (d > worst) [worst, index] = [d, i]
    }
    return worst <= tolerance ? [a, b] : [...line(pts.slice(0, index + 1)).slice(0, -1), ...line(pts.slice(index))]
  }
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
  if (open.length <= 4) return open
  // 封閉的多邊形從最遠的兩點切成兩段各自簡化
  const far = open.reduce((best, p, i) => (Math.hypot(p[0] - open[0][0], p[1] - open[0][1]) > Math.hypot(open[best][0] - open[0][0], open[best][1] - open[0][1]) ? i : best), 0)
  const first = line(open.slice(0, far + 1))
  const second = line([...open.slice(far), open[0]])
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}
