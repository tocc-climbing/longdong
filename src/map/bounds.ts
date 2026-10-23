import { RESCUE_POINTS } from '../data/rescue'
import type { LatLng } from '../geo'
import { project } from './mapData'
import type { Rect } from './mapView'

/** 地圖範圍：所有救援點外加這個距離（公尺）；岩場在東邊海岸，右邊多留一些海面；北邊多留，左上的按鈕才不會蓋住 #2 */
const PADDING_M = { west: 80, east: 220, north: 200, south: 40 }

/** 有座標的救援點（地圖座標） */
export const located = RESCUE_POINTS.filter((p) => p.coords).map((p) => ({ key: p.key, no: p.no, at: project(p.coords!) }))
const xs = located.map((p) => p.at[0])
const ys = located.map((p) => p.at[1])

export const BOUNDS: Rect = {
  x: Math.min(...xs) - PADDING_M.west,
  y: Math.min(...ys) - PADDING_M.north,
  w: Math.max(...xs) - Math.min(...xs) + PADDING_M.west + PADDING_M.east,
  h: Math.max(...ys) - Math.min(...ys) + PADDING_M.north + PADDING_M.south,
}

/** 縮到最小時左右的中心：岩場（校門口到後門的救援點） */
export const CRAG_X = (() => {
  const crag = located.filter((p) => p.no >= 3 && p.no <= 13).map((p) => p.at[0])
  return (Math.min(...crag) + Math.max(...crag)) / 2
})()

/** 地圖座標在不在範圍內 */
export const inBounds = ([x, y]: [number, number]) => x >= BOUNDS.x && x <= BOUNDS.x + BOUNDS.w && y >= BOUNDS.y && y <= BOUNDS.y + BOUNDS.h

/** 這個位置在不在地圖範圍內（範圍外不能回報，按「回到我的位置」也不移動） */
export const inMapBounds = (coords: LatLng) => inBounds(project(coords))
