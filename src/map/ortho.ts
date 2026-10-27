import type { LatLng } from '../geo'
import { BOUNDS, EXTENT, ROCK_AREA } from './bounds'
import { project, unproject } from './mapData'
import { toMap, type MapView, type Size } from './mapView'

/**
 * 內政部國土測繪中心的臺灣通用正射影像（航照，WMTS 圖磚，政府資料開放授權，需標示出處）。
 * 圖磚以 CORS 載入（伺服器允許），Service Worker 存進 ORTHO_CACHE（vite.config.ts），看過的地方離線時照樣顯示；
 * 也可以一次下載整個地圖資料範圍（downloadOrtho）。
 */
const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'
/** 圖磚的縮放層級：z19 每像素約 0.27 公尺，再放大只是放大同一張照片 */
const MIN_Z = 14
const MAX_Z = 19
/** 一層最多幾張圖磚，超過就降一層 */
const MAX_TILES = 64
/** 最底下固定墊一層：縮放時這層的圖磚不換，新的圖磚載入前不會整片空白（閃一下） */
const BASE_Z = 16
const EARTH_M = 2 * Math.PI * 6_378_137
/** Service Worker 快取航照圖磚的 cache 名稱（同 vite.config.ts） */
export const ORTHO_CACHE = 'ortho'
/** 離線下載的大小（2026-10-26 抽樣估計：673 張，平均 13.3 KB） */
export const ORTHO_DOWNLOAD_MB = 9
/** 下載整個範圍時同時抓幾張 */
const DOWNLOAD_PARALLEL = 6

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
const tileUrl = (z: number, x: number, y: number) => TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
const tileLatLng = (x: number, y: number, n: number): LatLng => [(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, (x / n) * 360 - 180]

/** 畫面上看得到的圖磚：一層清楚的（圖磚像素不大於螢幕像素），底下墊一層粗兩級的，最底下再墊固定的 BASE_Z，換層級時不會整片空白 */
/** 畫面清楚需要的圖磚層級（圖磚像素不大於螢幕像素） */
export function orthoLevel(view: MapView, dpr = 1): number {
  const lat = unproject([view.cx, view.cy])[0]
  const metersPerTilePx = (z: number) => (EARTH_M * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z)
  let z = MAX_Z
  while (z > MIN_Z && metersPerTilePx(z - 1) <= view.s / dpr) z--
  return z
}

/**
 * level：用這個層級（縮放中先沿用之前的層級，圖磚不換，不會一直重新載入而閃動）；
 * 圖磚太多（縮小很多）時往下降。沒有指定時用 orthoLevel。
 */
export function orthoTiles(view: MapView, frame: Size, dpr = 1, level = orthoLevel(view, dpr)): OrthoTile[] {
  const corners = ([[0, 0], [frame.w, 0], [0, frame.h], [frame.w, frame.h]] as [number, number][]).map((p) => unproject(toMap(view, frame, p)))
  const lats = corners.map((c) => c[0])
  const lngs = corners.map((c) => c[1])
  const [north, south, west, east] = [Math.max(...lats), Math.min(...lats), Math.min(...lngs), Math.max(...lngs)]

  const layer = (z: number) => {
    const n = 2 ** z
    const [x0, x1, y0, y1] = [Math.floor(tileX(west, n)), Math.floor(tileX(east, n)), Math.floor(tileY(north, n)), Math.floor(tileY(south, n))]
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return undefined
    const tiles: OrthoTile[] = []
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const [left, top] = project(tileLatLng(x, y, n))
        const [right, bottom] = project(tileLatLng(x + 1, y + 1, n))
        tiles.push({ key: `${z}/${x}/${y}`, href: tileUrl(z, x, y), x: left, y: top, w: right - left, h: bottom - top })
      }
    }
    return tiles
  }

  let z = level
  let fine = layer(z)
  while (!fine && z > MIN_Z) fine = layer(--z)
  const coarse = z - 2 > BASE_Z ? layer(z - 2) : undefined
  const base = z > BASE_Z ? layer(BASE_Z) : undefined
  return [...(base ?? []), ...(coarse ?? []), ...(fine ?? [])]
}

/**
 * 離線下載的層級：救援點周圍（ROCK_AREA）到最清楚的 MAX_Z；移動範圍（BOUNDS，多了西邊到龍洞街口）最細 ROAD_MAX_Z；
 * 資料範圍（EXTENT）的外圈最細 OUTER_MAX_Z（外圈放大看的機會少）。
 */
const ROAD_MAX_Z = 18
const OUTER_MAX_Z = 17

/** 離線下載的圖磚：救援點周圍 MIN_Z–MAX_Z、移動範圍 MIN_Z–ROAD_MAX_Z、資料範圍 MIN_Z–OUTER_MAX_Z */
export function orthoDownloadUrls(): string[] {
  const urls = new Set<string>()
  const add = (r: typeof BOUNDS, maxZ: number) => {
    const [nw, se] = [unproject([r.x, r.y]), unproject([r.x + r.w, r.y + r.h])]
    for (let z = MIN_Z; z <= maxZ; z++) {
      const n = 2 ** z
      for (let x = Math.floor(tileX(nw[1], n)); x <= Math.floor(tileX(se[1], n)); x++) {
        for (let y = Math.floor(tileY(nw[0], n)); y <= Math.floor(tileY(se[0], n)); y++) urls.add(tileUrl(z, x, y))
      }
    }
  }
  add(EXTENT, OUTER_MAX_Z)
  add(BOUNDS, ROAD_MAX_Z)
  add(ROCK_AREA, MAX_Z)
  return [...urls]
}

/** 離線快取裡已經有幾張（整個範圍的圖磚中） */
export async function cachedOrthoCount(): Promise<number> {
  if (!('caches' in window)) return 0
  const cache = await caches.open(ORTHO_CACHE)
  const have = new Set((await cache.keys()).map((r) => r.url))
  return orthoDownloadUrls().filter((u) => have.has(u)).length
}

/**
 * 下載整個範圍存進離線快取（已經有的跳過），onProgress 回報完成幾張；
 * 任何一張失敗就停下來丟出錯誤（已下載的留著，下次從缺的繼續）。
 */
export async function downloadOrtho(onProgress: (done: number, total: number) => void): Promise<void> {
  const cache = await caches.open(ORTHO_CACHE)
  const have = new Set((await cache.keys()).map((r) => r.url))
  const urls = orthoDownloadUrls()
  const missing = urls.filter((u) => !have.has(u))
  let done = urls.length - missing.length
  onProgress(done, urls.length)
  // 盡量不要被瀏覽器在空間不足時清掉
  void navigator.storage?.persist?.()
  let next = 0
  await Promise.all(
    Array.from({ length: DOWNLOAD_PARALLEL }, async () => {
      while (next < missing.length) {
        const url = missing[next++]
        const res = await fetch(url, { mode: 'cors' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await cache.put(url, res)
        onProgress(++done, urls.length)
      }
    }),
  )
}
