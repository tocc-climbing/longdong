import type { LatLng } from '../geo'
import { project, unproject } from './mapData'
import { toMap, type MapView, type Size } from './mapView'

/**
 * 內政部國土測繪中心的臺灣通用正射影像（航照，WMTS 圖磚，政府資料開放授權，需標示出處）。
 * 管理頁電腦版的地圖回報用來對照回報點、區域邊界與真實岩壁的位置。
 */
const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'
/** 圖磚的縮放層級：z19 每像素約 0.27 公尺，再放大只是放大同一張照片 */
const MIN_Z = 14
const MAX_Z = 19
/** 一層最多幾張圖磚，超過就降一層 */
const MAX_TILES = 64
const EARTH_M = 2 * Math.PI * 6_378_137

export interface OrthoTile {
  key: string
  href: string
  /** 地圖座標（公尺）：左上角與寬高 */
  x: number
  y: number
  w: number
  h: number
}

const tileX = (lng: number, n: number) => ((lng + 180) / 360) * n
const tileY = (lat: number, n: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
}
const tileLatLng = (x: number, y: number, n: number): LatLng => [(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, (x / n) * 360 - 180]

/** 畫面上看得到的圖磚：一層清楚的（圖磚像素不大於螢幕像素），底下墊一層粗的，換層級時不會整片空白 */
export function orthoTiles(view: MapView, frame: Size, dpr = 1): OrthoTile[] {
  const corners = ([[0, 0], [frame.w, 0], [0, frame.h], [frame.w, frame.h]] as [number, number][]).map((p) => unproject(toMap(view, frame, p)))
  const lats = corners.map((c) => c[0])
  const lngs = corners.map((c) => c[1])
  const [north, south, west, east] = [Math.max(...lats), Math.min(...lats), Math.min(...lngs), Math.max(...lngs)]
  const metersPerTilePx = (z: number) => (EARTH_M * Math.cos((((north + south) / 2) * Math.PI) / 180)) / (256 * 2 ** z)

  const layer = (z: number) => {
    const n = 2 ** z
    const [x0, x1, y0, y1] = [Math.floor(tileX(west, n)), Math.floor(tileX(east, n)), Math.floor(tileY(north, n)), Math.floor(tileY(south, n))]
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return undefined
    const tiles: OrthoTile[] = []
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const [left, top] = project(tileLatLng(x, y, n))
        const [right, bottom] = project(tileLatLng(x + 1, y + 1, n))
        tiles.push({ key: `${z}/${x}/${y}`, href: TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), x: left, y: top, w: right - left, h: bottom - top })
      }
    }
    return tiles
  }

  let z = MAX_Z
  while (z > MIN_Z && metersPerTilePx(z - 1) <= view.s / dpr) z--
  let fine = layer(z)
  while (!fine && z > MIN_Z) fine = layer(--z)
  const coarse = z - 2 >= MIN_Z ? layer(z - 2) : undefined
  return [...(coarse ?? []), ...(fine ?? [])]
}
