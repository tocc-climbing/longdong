import { RESCUE_POINTS } from '../data/rescue'
import type { LatLng } from '../geo'
import { EXTENT_LATLNG } from './extent'
import { project } from './mapData'
import type { Rect } from './mapView'

/** 地圖範圍：所有救援點外加這個距離（公尺）；岩場在東邊海岸，右邊多留一些海面；北邊多留，左上的按鈕才不會蓋住 #2 */
const PADDING_M = { west: 80, east: 220, north: 200, south: 40 }

/** 有座標的救援點（地圖座標） */
export const located = RESCUE_POINTS.filter((p) => p.coords).map((p) => ({ key: p.key, no: p.no, at: project(p.coords!) }))
/** 範圍另外包含：台二線往北的鼻頭隧道與鼻頭路口（地圖上的台二線延伸到這裡，見 scripts/gen-scale-map.ts） */
const EXTRA: [number, number][] = [project([25.12237, 121.91614])]
const xs = [...located.map((p) => p.at[0]), ...EXTRA.map((p) => p[0])]
const ys = [...located.map((p) => p.at[1]), ...EXTRA.map((p) => p[1])]

/** 地圖資料的範圍（地圖座標，見 extent.ts）：航照與 OpenStreetMap 補上的陸地、道路畫到這裡 */
export const EXTENT: Rect = (() => {
  const [x0, y0] = project([EXTENT_LATLNG.north, EXTENT_LATLNG.west])
  const [x1, y1] = project([EXTENT_LATLNG.south, EXTENT_LATLNG.east])
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})()

export const BOUNDS: Rect = {
  x: Math.min(...xs) - PADDING_M.west,
  y: Math.min(...ys) - PADDING_M.north,
  w: Math.max(...xs) - Math.min(...xs) + PADDING_M.west + PADDING_M.east,
  h: Math.max(...ys) - Math.min(...ys) + PADDING_M.north + PADDING_M.south,
  maxW: EXTENT.w,
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
