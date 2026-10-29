/**
 * 由內政部 20 公尺網格數值地形模型（DTM）產生等高線，給編輯器的地圖當參考（畫區域、岩壁時對照地形）：
 *   public/rescue/contours.geojson   每 CONTOUR_STEP_M 公尺一條，elevation 是高程（公尺），每 INDEX_STEP_M 公尺的是計曲線（index）
 * 暫時的圖層（使用者指示，2026-10-29）：大區域、分區與岩壁都畫完後，連同這支程式、contours.geojson、編輯器的圖層一起拿掉。
 *
 *   npm run contours -- <分幅_新北市20MDEM(2025) 解壓後的資料夾>
 *
 * 資料：data.gov.tw「2025年版全臺灣20公尺網格數值地形模型DTM資料」（https://data.gov.tw/dataset/176927）的新北市分幅，
 * 每個圖幅一個 .hdr（第 9–12 行：行數、列數、左下角 E、N）與 .grd（每行「E N 高程」，TWD97 TM2，只有陸地的點）。
 * 只讀和地圖資料範圍（src/map/extent.ts）重疊的圖幅。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTENT_LATLNG as E } from '../src/map/extent'
import { contourLines, tm2ToLatLng, type Grid } from './lib/contours'

type Pt = [number, number]

const CONTOUR_STEP_M = 10
const INDEX_STEP_M = 50
/** 格距（公尺） */
const STEP = 20
/** 資料範圍外多讀幾格，邊上的線才完整 */
const PAD_DEG = 0.001
/** 平滑的次數（Chaikin）：20 公尺的格子切出來的線有稜角 */
const SMOOTH_ROUNDS = 2
/** 平滑後簡化的誤差（公尺）：20 公尺的格子本來就沒有更細的地形 */
const SIMPLIFY_M = 1

const dir = process.argv[2]
if (!dir) throw new Error('用法：npm run contours -- <分幅_新北市20MDEM(2025) 解壓後的資料夾>')

const inExtent = ([lat, lng]: Pt) => lat >= E.south - PAD_DEG && lat <= E.north + PAD_DEG && lng >= E.west - PAD_DEG && lng <= E.east + PAD_DEG
/** 圖幅的四個角有沒有一個在範圍裡，或範圍的中心在圖幅裡（圖幅約 2.6 × 2.9 公里，和範圍差不多大，用角判斷就夠） */
function overlaps(hdr: string[]): boolean {
  const [cols, rows, x0, y0] = hdr.slice(8, 12).map(Number)
  const [x1, y1] = [x0 + cols * STEP, y0 + rows * STEP]
  const corners: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => tm2ToLatLng(p as Pt))
  const lats = corners.map((c) => c[0])
  const lngs = corners.map((c) => c[1])
  return Math.min(...lats) <= E.north + PAD_DEG && Math.max(...lats) >= E.south - PAD_DEG && Math.min(...lngs) <= E.east + PAD_DEG && Math.max(...lngs) >= E.west - PAD_DEG
}

const tiles = readdirSync(dir)
  .filter((f) => f.endsWith('dem.hdr'))
  .filter((f) => overlaps(readFileSync(join(dir, f), 'latin1').split(/\r?\n/)))
if (!tiles.length) throw new Error(`${dir} 裡沒有和地圖範圍重疊的圖幅`)

const points: [number, number, number][] = []
for (const hdr of tiles) {
  for (const line of readFileSync(join(dir, hdr.replace('.hdr', '.grd')), 'latin1').split(/\r?\n/)) {
    const [x, y, z] = line.trim().split(/\s+/).map(Number)
    if (line.trim() && inExtent(tm2ToLatLng([x, y]))) points.push([x, y, z])
  }
}
const xs = points.map((p) => p[0])
const ys = points.map((p) => p[1])
const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
const cols = (Math.max(...xs) - x0) / STEP + 1
const rows = (Math.max(...ys) - y0) / STEP + 1
if (!Number.isInteger(cols) || !Number.isInteger(rows)) throw new Error('格點不在 20 公尺的格子上')
const grid: Grid = { x0, y0, step: STEP, cols, rows, z: new Float64Array(cols * rows).fill(NaN) }
for (const [x, y, z] of points) grid.z[((y - y0) / STEP) * cols + (x - x0) / STEP] = z

/** Chaikin：每段取 1/4、3/4 兩點；封閉的線（首尾同一點）保持封閉，不封閉的保留兩端 */
function smooth(line: Pt[]): Pt[] {
  const closed = line.length > 2 && line[0][0] === line.at(-1)![0] && line[0][1] === line.at(-1)![1]
  const out: Pt[] = closed ? [] : [line[0]]
  for (let i = 0; i + 1 < line.length; i++) {
    const [[ax, ay], [bx, by]] = [line[i], line[i + 1]]
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75])
  }
  if (closed) out.push(out[0])
  else out.push(line.at(-1)!)
  return out
}
/** Douglas–Peucker */
function simplify(line: Pt[], tolerance: number): Pt[] {
  if (line.length <= 2) return line
  const [a, b] = [line[0], line.at(-1)!]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const dist = (p: Pt) => (len ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len : Math.hypot(p[0] - a[0], p[1] - a[1]))
  let far = 0
  let at = 0
  for (let i = 1; i < line.length - 1; i++) {
    const d = dist(line[i])
    if (d > far) [far, at] = [d, i]
  }
  if (far <= tolerance) return [a, b]
  return [...simplify(line.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(line.slice(at), tolerance)]
}
const lngLat = (p: Pt): Pt => {
  const [lat, lng] = tm2ToLatLng(p)
  return [+lng.toFixed(6), +lat.toFixed(6)]
}

const top = Math.max(...points.map((p) => p[2]))
const features = []
for (let level = CONTOUR_STEP_M; level <= top; level += CONTOUR_STEP_M) {
  const lines = contourLines(grid, level).map((l) => {
    let s = l
    for (let k = 0; k < SMOOTH_ROUNDS; k++) s = smooth(s)
    return simplify(s, SIMPLIFY_M).map(lngLat)
  })
  if (lines.length) features.push({ type: 'Feature', properties: { elevation: level, index: level % INDEX_STEP_M === 0 }, geometry: { type: 'MultiLineString', coordinates: lines } })
}

const text = JSON.stringify({
  type: 'FeatureCollection',
  source: `內政部 20 公尺網格數值地形模型（2025 年版，新北市分幅 ${tiles.map((t) => t.slice(0, 8)).join('、')}），政府資料開放授權條款第 1 版`,
  features,
})
writeFileSync('public/rescue/contours.geojson', text + '\n')
console.log(`圖幅 ${tiles.join('、')}；${points.length} 個格點，最高 ${top} 公尺；等高線 ${features.length} 條高程，contours.geojson ${(text.length / 1024).toFixed(0)} KB`)
