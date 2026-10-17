/**
 * 由 TOCC 龍洞岩場救援資訊圖（.ai／.pdf）的向量圖形產生照比例尺的地圖資料（GeoJSON，WGS84）：
 *   public/rescue/scale-map.geojson   陸地、建物、道路、步道、停車場、急救器材、船艇接駁點、直升機吊掛點、地名
 *   public/rescue/areas.geojson       9 個大區域的範圍（之後也可用在路線分區的介面）
 *
 *   npm run scale-map -- <救援資訊圖.ai 或 .pdf>
 *
 * 救援資訊圖是示意圖，不是照比例尺畫的（以救援點比對，整張圖最多偏約 60 公尺）。
 * 這裡以「控制點」（圖上位置 ↔ 實際 GPS 座標）用薄板樣條（thin plate spline）把圖形拉到實際位置：
 * 控制點上完全吻合，控制點之間平滑內插。控制點越多越準；到現場校正的點加進 CONTROL_POINTS 後重跑即可。
 * 資料屬於 TOCC，不在本專案的開源授權範圍內（見 README 授權一節）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EMS_LOCATIONS, RESCUE_POINTS } from '../src/data/rescue'

/** 2026 年 7 月版的頁面大小（點）；版面不同時停下來，避免用舊的控制點與圖形分類 */
const PAGE_SIZE = [1836.85, 2607.87]

type Pt = [number, number]

/**
 * 控制點：圖上位置 [x, y]（點，原點在左上角）↔ GPS [緯度, 經度]。
 * 救援點的圖上位置是圖釘的尖端；座標取自 src/data/rescue.ts（以救援點名稱對應）。
 * 沒有座標的 #9、#13 不列；#12 圖上只有一個圖釘，對應「後門－地下二樓」。
 */
const RESCUE_PINS: { name: string; at: Pt }[] = [
  { name: '龍洞安檢所', at: [405.2, 955.4] },
  { name: '龍洞岩場入口／校門口小徑', at: [978.4, 778.3] },
  { name: '校門口', at: [1194.7, 755.6] },
  { name: '鐘塔', at: [1318.4, 1025.8] },
  { name: '訓導處', at: [1329.4, 1122.7] },
  { name: '長巷', at: [1368.5, 1153.8] },
  { name: '音樂廳／演奏台', at: [1366.3, 1228.8] },
  { name: '大禮堂／第一洞', at: [1272.8, 1366.3] },
  { name: '黃金谷', at: [1308.3, 1831.5] },
  { name: '鱷魚岬', at: [1382.3, 2032.6] },
  { name: '後門－地下二樓', at: [1375.1, 2121.4] },
  { name: '南側停車場（西靈巖寺）', at: [1246.1, 2059.0] },
  { name: '龍洞南口海洋公園', at: [802.2, 2534.3] },
]

/** 現場校正加入的控制點（圖上位置 ↔ 現場量到的 GPS），note 寫明是哪裡、誰量的 */
const FIELD_POINTS: { note: string; at: Pt; gps: Pt }[] = []

const CONTROL_POINTS: { at: Pt; gps: Pt }[] = [
  ...RESCUE_PINS.map(({ name, at }) => {
    const gps = RESCUE_POINTS.find((p) => p.name.zh === name)?.coords
    if (!gps) throw new Error(`src/data/rescue.ts 找不到有座標的救援點「${name}」`)
    return { at, gps }
  }),
  ...FIELD_POINTS,
]

/** 9 個大區域在圖上的填色 → 大區域 key（同 src/data/rescue.ts 的 AREA_RESCUE） */
const AREA_FILLS: Record<string, string> = {
  '#f2b4c6': 'school-gate',
  '#dab2d2': 'clocktower',
  '#b3c6d8': 'long-lane',
  '#ceedf1': 'music-hall',
  '#d0d6c2': 'grand-auditorium',
  '#e4eeb3': 'first-cave',
  '#f9e8b2': 'second-cave',
  '#fcdcb7': 'golden-valley',
  '#e2b2b2': 'back-door',
}

/** 簡化線條的容許誤差（點，約 0.3 公尺） */
const SIMPLIFY_PT = 0.4

// ── 讀出向量圖形 ──────────────────────────────────────────────

interface Shape {
  stroke: boolean
  fill: string
  strokeColor: string
  /** 線寬（點） */
  width: number
  dashed: boolean
  subpaths: Pt[][]
}

const file = process.argv[2]
if (!file) throw new Error('用法：npm run scale-map -- <救援資訊圖.ai 或 .pdf>')
if (!('withResolvers' in Promise)) throw new Error(`需要 Node.js 22 以上（目前是 ${process.version}）`)

const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
const page = await pdf.getPage(1)
const base = page.getViewport({ scale: 1 })
if (Math.abs(base.width - PAGE_SIZE[0]) > 1 || Math.abs(base.height - PAGE_SIZE[1]) > 1) {
  throw new Error(`頁面大小 ${base.width}×${base.height} 與預期 ${PAGE_SIZE.join('×')} 不同：地圖版面可能改了，請先調整控制點與圖形分類`)
}

type Matrix = [number, number, number, number, number, number]
const multiply = (a: Matrix, b: number[]): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]
const hex = (rgb: unknown[]) =>
  typeof rgb[0] === 'string' ? (rgb[0] as string) : '#' + (rgb as number[]).map((v) => v.toString(16).padStart(2, '0')).join('')

/** 依序執行 PDF 的繪圖指令，記下每個路徑的樣式與座標（曲線切成 8 段折線） */
function readShapes(fnArray: number[], argsArray: unknown[][]): Shape[] {
  interface State { ctm: Matrix; fill: string; stroke: string; width: number; dashed: boolean }
  let state: State = { ctm: [1, 0, 0, -1, 0, base.height], fill: '#000000', stroke: '#000000', width: 1, dashed: false }
  const stack: State[] = []
  const shapes: Shape[] = []
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i]
    if (fn === OPS.save) stack.push({ ...state })
    else if (fn === OPS.restore) state = stack.pop()!
    else if (fn === OPS.transform) state.ctm = multiply(state.ctm, args as number[])
    else if (fn === OPS.setFillRGBColor) state.fill = hex(args)
    else if (fn === OPS.setStrokeRGBColor) state.stroke = hex(args)
    else if (fn === OPS.setLineWidth) state.width = args[0] as number
    else if (fn === OPS.setDash) state.dashed = (args[0] as number[]).length > 0
    else if (fn === OPS.constructPath) {
      const [paint, [data]] = args as [number, [Record<number, number>]]
      const m = state.ctm
      const toPage = (x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
      const subpaths: Pt[][] = []
      let current: Pt[] = []
      let last: Pt = [0, 0]
      const length = Object.keys(data).length
      for (let j = 0; j < length; ) {
        const op = data[j]
        if (op === 0 || op === 1) {
          if (op === 0) subpaths.push((current = []))
          current.push(toPage(data[j + 1], data[j + 2]))
          last = [data[j + 1], data[j + 2]]
          j += 3
        } else if (op === 2) {
          const [x0, y0] = last
          for (let k = 1; k <= 8; k++) {
            const t = k / 8
            const u = 1 - t
            const bez = (p0: number, p1: number, p2: number, p3: number) => u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
            current.push(toPage(bez(x0, data[j + 1], data[j + 3], data[j + 5]), bez(y0, data[j + 2], data[j + 4], data[j + 6])))
          }
          last = [data[j + 5], data[j + 6]]
          j += 7
        } else if (op === 4) {
          if (current.length) current.push(current[0])
          j += 1
        } else throw new Error(`不認得的路徑指令 ${op}`)
      }
      shapes.push({
        stroke: paint === OPS.stroke || paint === OPS.closeStroke,
        fill: state.fill,
        strokeColor: state.stroke,
        width: state.width * Math.hypot(m[0], m[1]),
        dashed: state.dashed,
        subpaths,
      })
    }
  }
  return shapes
}

const operators = await page.getOperatorList()
const shapes = readShapes(operators.fnArray, operators.argsArray as unknown[][])

const bbox = (s: Shape) => {
  const pts = s.subpaths.flat()
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

// 控制點必須正好落在圖上的救援點圖釘尖端：版面小改時在這裡停下來
const pinTips = shapes
  .filter((s) => !s.stroke && s.fill === '#b60005' && Math.abs(bbox(s).w - 33.5) < 1 && Math.abs(bbox(s).h - 52.2) < 1)
  .map((s) => s.subpaths.flat().reduce((a, b) => (b[1] > a[1] ? b : a)))
for (const { name, at } of RESCUE_PINS) {
  if (!pinTips.some((tip) => Math.hypot(tip[0] - at[0], tip[1] - at[1]) < 1)) throw new Error(`救援點「${name}」的圖上位置 ${at} 沒有圖釘：版面可能改了`)
}

// 圖形分類（2026 年 7 月版）：陸地是唯一一塊超出頁面的淺灰色；道路是深藍色粗線（台二線 18 點、其他 8 點，虛線是隧道）
const land = shapes.filter((s) => !s.stroke && s.fill === '#efefef' && bbox(s).x < 0)
const buildings = shapes.filter((s) => !s.stroke && s.fill === '#dcdddd')
const highways = shapes.filter((s) => s.stroke && s.strokeColor === '#003f7e' && Math.abs(s.width - 18) < 0.5)
const roads = shapes.filter((s) => s.stroke && s.strokeColor === '#003f7e' && Math.abs(s.width - 8) < 0.5)
const trails = shapes.filter((s) => s.stroke && s.strokeColor === '#356507' && s.dashed && Math.abs(s.width - 6) < 0.5)
const areaShapes = shapes.filter((s) => !s.stroke && s.fill in AREA_FILLS)
const counts = { land: land.length, buildings: buildings.length, highways: highways.length, roads: roads.length, trails: trails.length }
console.log('圖形', counts, '大區域', areaShapes.length)
if (land.length !== 1 || !highways.length || !roads.length || !trails.length) throw new Error('圖形分類和預期不同：版面可能改了')
const missing = Object.values(AREA_FILLS).filter((key) => !areaShapes.some((s) => AREA_FILLS[s.fill] === key))
if (missing.length) throw new Error(`找不到大區域：${missing.join('、')}`)

const centerOf = (s: Shape): Pt => {
  const b = bbox(s)
  return [b.x + b.w / 2, b.y + b.h / 2]
}
const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

// 停車場：藍底白色 P 字（12×17 點）的中心
const parking = shapes.filter((s) => !s.stroke && s.fill === '#ffffff' && Math.abs(bbox(s).w - 12) < 1 && Math.abs(bbox(s).h - 17) < 1).map(centerOf)
if (parking.length !== 3) throw new Error(`停車場應該有 3 處，找到 ${parking.length} 處：版面可能改了`)

// 急救器材：圖示旁的藍色箭頭（線＋三角形）指向實際位置，取三角形離箭頭起點最遠的一點；由北到南依序是 #1–#6
const arrowHeads = shapes.filter((s) => !s.stroke && s.fill === '#0c4f8b' && bbox(s).w > 10 && bbox(s).w < 20 && bbox(s).h > 10 && bbox(s).h < 20)
const emsTips = shapes
  .filter((s) => s.stroke && s.strokeColor === '#0c4f8b')
  .map((arrow) => {
    const start = arrow.subpaths[0][0]
    const end = arrow.subpaths[0][arrow.subpaths[0].length - 1]
    const head = arrowHeads.reduce((a, b) => (near(centerOf(b), end) < near(centerOf(a), end) ? b : a))
    return head.subpaths.flat().reduce((a, b) => (near(b, start) > near(a, start) ? b : a))
  })
  .sort((a, b) => a[1] - b[1])
if (emsTips.length !== EMS_LOCATIONS.length) throw new Error(`急救器材應該有 ${EMS_LOCATIONS.length} 處，找到 ${emsTips.length} 個箭頭：版面可能改了`)

// 圖例（左上角）裡也有同樣的圖示，不算
const LEGEND = { x0: 150, y0: 450, x1: 850, y1: 850 }
const inLegend = (s: Shape) => {
  const [x, y] = centerOf(s)
  return x > LEGEND.x0 && x < LEGEND.x1 && y > LEGEND.y0 && y < LEGEND.y1
}
const sized = (s: Shape, w: number, h: number) => Math.abs(bbox(s).w - w) < 0.5 && Math.abs(bbox(s).h - h) < 0.5

// 船艇接駁點：同心圓中間的實心圓點（6.6 點）
const boats = shapes.filter((s) => !s.stroke && s.fill === '#5dc2d0' && sized(s, 6.6, 6.6) && !inLegend(s)).map(centerOf)
if (boats.length !== 13) throw new Error(`船艇接駁點應該有 13 處，找到 ${boats.length} 處：版面可能改了`)

// 直升機吊掛點：藍色 H 圖釘（29.3×45.8 點）的尖端
const hoists = shapes
  .filter((s) => !s.stroke && s.fill === '#309dc5' && sized(s, 29.3, 45.8) && !inLegend(s))
  .map((s) => s.subpaths.flat().reduce((a, b) => (b[1] > a[1] ? b : a)))
if (hoists.length !== 5) throw new Error(`直升機吊掛點應該有 5 處，找到 ${hoists.length} 處：版面可能改了`)

/** 地名：圖上文字（灰色）的中心 */
const PLACES: { zh: string; en: string; at: Pt }[] = [
  { zh: '和美國小', en: 'Ho-Mei School', at: [877.5, 996] },
  { zh: '西靈巖寺', en: 'Hsilingyan Temple', at: [1145, 2005.5] },
]
const placeText = shapes.filter((s) => !s.stroke && s.fill === '#898989').map(centerOf)
for (const { zh, at } of PLACES) {
  if (!placeText.some((p) => near(p, at) < 60)) throw new Error(`「${zh}」的圖上位置 ${at} 沒有文字：版面可能改了`)
}

// ── 圖上位置 → 實際座標 ─────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000
const rad = Math.PI / 180
const [lat0, lng0] = CONTROL_POINTS[0].gps
const metersPerDegLat = EARTH_RADIUS_M * rad
const metersPerDegLng = EARTH_RADIUS_M * rad * Math.cos(lat0 * rad)

function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length
  const m = matrix.map((row, i) => [...row, rhs[i]])
  for (let i = 0; i < n; i++) {
    let pivot = i
    for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r
    ;[m[i], m[pivot]] = [m[pivot], m[i]]
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const f = m[r][i] / m[i][i]
      for (let c = i; c <= n; c++) m[r][c] -= f * m[i][c]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

/** 薄板樣條：通過每個控制點，其餘平滑內插；控制點範圍外近似仿射 */
function thinPlateSpline(from: Pt[], to: Pt[]): (p: Pt) => Pt {
  const n = from.length
  const U = (a: Pt, b: Pt) => {
    const r2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
    return r2 === 0 ? 0 : r2 * Math.log(Math.sqrt(r2))
  }
  const L = Array.from({ length: n + 3 }, () => new Array<number>(n + 3).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) L[i][j] = U(from[i], from[j])
    L[i][n] = L[n][i] = 1
    L[i][n + 1] = L[n + 1][i] = from[i][0]
    L[i][n + 2] = L[n + 2][i] = from[i][1]
  }
  const weights = [0, 1].map((axis) => solve(L, [...to.map((p) => p[axis]), 0, 0, 0]))
  return (p) =>
    weights.map((w) => {
      let v = w[n] + w[n + 1] * p[0] + w[n + 2] * p[1]
      for (let i = 0; i < n; i++) v += w[i] * U(p, from[i])
      return v
    }) as Pt
}

const toMeters = ([lat, lng]: Pt): Pt => [(lng - lng0) * metersPerDegLng, (lat - lat0) * metersPerDegLat]
const warp = thinPlateSpline(
  CONTROL_POINTS.map((c) => c.at),
  CONTROL_POINTS.map((c) => toMeters(c.gps)),
)
/** 圖上位置 → GeoJSON 的 [經度, 緯度]（小數 6 位，約 0.1 公尺） */
const toLngLat = (p: Pt): Pt => {
  const [e, n] = warp(p)
  return [+(lng0 + e / metersPerDegLng).toFixed(6), +(lat0 + n / metersPerDegLat).toFixed(6)]
}

/** Douglas–Peucker 簡化折線 */
function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points
  const [a, b] = [points[0], points[points.length - 1]]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const d = len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len
    if (d > worst) [worst, index] = [d, i]
  }
  if (worst <= tolerance) return [a, b]
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)]
}

const line = (s: Pt[]) => simplify(s, SIMPLIFY_PT).map(toLngLat)
const ring = (s: Pt[]) => {
  const r = line(s)
  if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0])
  return r
}
const polygons = (list: Shape[]) => list.flatMap((s) => s.subpaths.filter((p) => p.length >= 3).map((p) => [ring(p)]))
const lines = (list: Shape[]) => list.flatMap((s) => s.subpaths.filter((p) => p.length >= 2).map(line))
const feature = (properties: Record<string, string | number>, geometry: object) => ({ type: 'Feature', properties, geometry })
const point = (properties: Record<string, string | number>, at: Pt) => feature(properties, { type: 'Point', coordinates: toLngLat(at) })

// 誤差檢查：每個控制點換算回來都必須落在原本的座標上
for (const { at, gps } of CONTROL_POINTS) {
  const [lng, lat] = toLngLat(at)
  const err = Math.hypot((lng - gps[1]) * metersPerDegLng, (lat - gps[0]) * metersPerDegLat)
  if (err > 0.5) throw new Error(`控制點 ${gps} 換算後偏了 ${err.toFixed(1)} 公尺`)
}

const source = `TOCC 龍洞岩場救援資訊圖 2026 年 7 月版，以 ${CONTROL_POINTS.length} 個控制點校正（${RESCUE_PINS.length} 個救援點、${FIELD_POINTS.length} 個現場點）；© 臺灣戶外攀岩協會`

const scaleMap = {
  type: 'FeatureCollection',
  source,
  features: [
    feature({ kind: 'land' }, { type: 'MultiPolygon', coordinates: polygons(land) }),
    feature({ kind: 'building' }, { type: 'MultiPolygon', coordinates: polygons(buildings) }),
    feature({ kind: 'highway' }, { type: 'MultiLineString', coordinates: lines(highways.filter((s) => !s.dashed)) }),
    feature({ kind: 'tunnel' }, { type: 'MultiLineString', coordinates: lines(highways.filter((s) => s.dashed)) }),
    feature({ kind: 'road' }, { type: 'MultiLineString', coordinates: lines(roads) }),
    feature({ kind: 'trail' }, { type: 'MultiLineString', coordinates: lines(trails) }),
    ...parking.map((at) => point({ kind: 'parking' }, at)),
    ...emsTips.map((at, i) => point({ kind: 'ems', no: EMS_LOCATIONS[i].no }, at)),
    ...PLACES.map(({ zh, en, at }) => point({ kind: 'place', zh, en }, at)),
    ...boats.map((at) => point({ kind: 'boat' }, at)),
    ...hoists.map((at) => point({ kind: 'hoist' }, at)),
  ],
}

const areas = {
  type: 'FeatureCollection',
  source,
  features: Object.entries(AREA_FILLS).map(([fill, key]) =>
    feature({ id: key }, { type: 'MultiPolygon', coordinates: polygons(areaShapes.filter((s) => s.fill === fill)) }),
  ),
}

mkdirSync('public/rescue', { recursive: true })
for (const [name, data] of [['scale-map', scaleMap], ['areas', areas]] as const) {
  const text = JSON.stringify(data)
  writeFileSync(`public/rescue/${name}.geojson`, text + '\n')
  console.log(`${name}.geojson ${(text.length / 1024).toFixed(0)} KB`)
}
