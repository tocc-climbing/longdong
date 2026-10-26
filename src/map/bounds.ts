import { RESCUE_POINTS } from '../data/rescue'
import type { LatLng } from '../geo'
import { EXTENT_LATLNG } from './extent'
import { project } from './mapData'
import type { Rect } from './mapView'

/** 地圖範圍：所有救援點（與龍洞街口）外加這個距離（公尺）；岩場在東邊海岸，右邊多留一些海面；北邊多留，左上的按鈕才不會蓋住 #2；西邊在龍洞街口再多一點 */
const PADDING_M = { west: 100, east: 220, north: 200, south: 40 }

/** 有座標的救援點（地圖座標） */
export const located = RESCUE_POINTS.filter((p) => p.coords).map((p) => ({ key: p.key, no: p.no, at: project(p.coords!) }))
/** 範圍另外包含：龍洞街與台二線的路口（西邊的盡頭，台二線在這裡轉向往北） */
const JUNCTION = project([25.1126, 121.9121])
const xs = [...located.map((p) => p.at[0]), JUNCTION[0]]
const ys = [...located.map((p) => p.at[1]), JUNCTION[1]]

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

/** 救援點周圍（不含西邊延伸到龍洞街口的部分）：離線航照最清楚的層級只下載這裡，西邊的街口一帶少一級 */
export const ROCK_AREA: Rect = (() => {
  const [px, py] = [located.map((p) => p.at[0]), located.map((p) => p.at[1])]
  const pad = { west: 80, east: PADDING_M.east, north: PADDING_M.north, south: PADDING_M.south }
  return { x: Math.min(...px) - pad.west, y: Math.min(...py) - pad.north, w: Math.max(...px) - Math.min(...px) + pad.west + pad.east, h: Math.max(...py) - Math.min(...py) + pad.north + pad.south }
})()

/** 縮到最小時左右的中心：岩場（校門口到後門的救援點） */
export const CRAG_X = (() => {
  const crag = located.filter((p) => p.no >= 3 && p.no <= 13).map((p) => p.at[0])
  return (Math.min(...crag) + Math.max(...crag)) / 2
})()

/** 地圖座標在不在範圍內 */
export const inBounds = ([x, y]: [number, number]) => x >= BOUNDS.x && x <= BOUNDS.x + BOUNDS.w && y >= BOUNDS.y && y <= BOUNDS.y + BOUNDS.h

/** 這個位置在不在地圖範圍內（範圍外不能回報，按「回到我的位置」也不移動） */
export const inMapBounds = (coords: LatLng) => inBounds(project(coords))
