import { useEffect, useState } from 'react'
import type { LatLng } from '../geo'
import { useCloud, withCloud } from '../personal/sync'

/**
 * 岩壁標記：在比例尺地圖上沿著牆底畫的折線，標明屬於哪個分區。累積起來得到各分區在地圖上的位置。
 *   /v2/walls/<uid>/<id>   { sector, line, createdAt }
 * 只有登入者讀得到（標記階段先不公開）；在自己的資料夾新增，本人與管理員可以刪除，不能修改（畫錯就刪掉重畫）。
 * line 是「緯度,經度」以空格分隔，小數 6 位（約 0.1 公尺）。
 */

export interface Wall {
  id: string
  uid: string
  sector: string
  points: LatLng[]
  createdAt: number
}

export interface StoredWall {
  sector: string
  line: string
  createdAt: number
}

/** 最多幾個點（資料庫規則限制 line 的長度） */
export const WALL_MAX_POINTS = 100

export function encodeLine(points: LatLng[]): string {
  return points.map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(' ')
}

export function decodeLine(line: string): LatLng[] {
  return line.split(' ').map((p) => p.split(',').map(Number) as LatLng)
}

export function decodeWalls(raw: Record<string, Record<string, StoredWall>> | null): Wall[] {
  return Object.entries(raw ?? {})
    .flatMap(([uid, list]) => Object.entries(list).map(([id, w]) => ({ id, uid, sector: w.sector, points: decodeLine(w.line), createdAt: w.createdAt })))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** 所有人畫的岩壁（即時更新）；沒登入時是空的 */
export function useWalls(): { walls: Wall[]; error?: string } {
  const cloud = useCloud()
  const signedIn = cloud.status === 'signed-in'
  const [state, setState] = useState<{ walls: Wall[]; error?: string }>({ walls: [] })
  useEffect(() => {
    if (!signedIn) {
      setState({ walls: [] })
      return
    }
    let stop: (() => void) | undefined
    let alive = true
    withCloud().then(
      ({ m }) => {
        if (!alive) return
        stop = m.watchWalls(
          (raw) => setState({ walls: decodeWalls(raw as Record<string, Record<string, StoredWall>> | null) }),
          (err) => setState((s) => ({ ...s, error: err.message })),
        )
      },
      (err: Error) => alive && setState((s) => ({ ...s, error: err.message })),
    )
    return () => {
      alive = false
      stop?.()
    }
  }, [signedIn])
  return state
}
