import { useEffect, useState } from 'react'
import type { LatLng } from '../geo'
import { useCloud, withCloud } from '../personal/sync'

/**
 * 舊的岩壁標記：之前在地圖頁沿著牆底畫的折線，標明屬於哪個分區。
 *   /v2/walls/<uid>/<id>   { sector, line, createdAt }
 * 岩壁現在在編輯模式修改（有版本，見 shapes.ts 的 wall:<分區>）；這裡只讀，
 * 當作還沒有版本的分區目前的岩壁（編輯模式從這裡開始改）。只有登入者讀得到。
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
