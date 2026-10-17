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

/**
 * 參考點：圖上容易對應的地物 ↔ OpenStreetMap 的座標（© OpenStreetMap contributors，ODbL），校正岩場以外的道路與停車場。
 * 救援資訊圖本身是示意圖、OSM 也有幾公尺誤差，所以不要求完全通過，允許 REFERENCE_SLACK 的鬆弛。
 * 圖上位置：隧道為台二線虛線段的兩端；停車場為 P 字中心；台二線轉彎為該段道路往東西南北最突出的一點。
 */
const REFERENCE_POINTS: { note: string; at: Pt; gps: Pt }[] = [
  { note: '龍洞隧道北口（OSM way 208987647）', at: [891.6, 1709.5], gps: [25.107389, 121.919594] },
  { note: '龍洞隧道南口（OSM way 208987647）', at: [922.9, 2000.9], gps: [25.105493, 121.919877] },
  { note: '龍洞街旁停車場（OSM way 696363002 中心）', at: [773, 902.5], gps: [25.112369, 121.918948] },
  { note: '環狀道路停車場（OSM way 973252376 中心）', at: [1066, 1214.5], gps: [25.110402, 121.920756] },
  { note: '龍洞灣岬步道停車場（OSM way 696363004 中心）', at: [1268, 2049.5], gps: [25.105203, 121.922119] },
  { note: '台二線第一個彎的最東點', at: [926, 1348], gps: [25.110438, 121.920114] },
  { note: '台二線第一個彎的最北點', at: [914, 1160], gps: [25.11074, 121.919727] },
  { note: '台二線兩個彎之間的最南點', at: [764, 1357], gps: [25.109489, 121.918545] },
  { note: '台二線第二個彎的最北點', at: [630, 1340], gps: [25.109596, 121.917987] },
  { note: '台二線第二個彎的最南點', at: [383, 1500], gps: [25.108609, 121.916313] },
  { note: '台二線第二個彎的最西點', at: [336, 1399], gps: [25.109008, 121.915892] },
  { note: '台二線第二個彎之後的最東點', at: [441, 1161], gps: [25.110499, 121.916673] },
]
/** 參考點的鬆弛（薄板樣條的平滑係數）；救援點與現場點為 0（完全通過） */
const REFERENCE_SLACK = Number(process.env.SLACK ?? 1000)
/** 參考點換算後與 OSM 座標的差距上限（公尺）；超過代表對應錯了 */
const REFERENCE_TOLERANCE_M = 20

const CONTROL_POINTS: { at: Pt; gps: Pt; slack: number; note?: string }[] = [
  ...RESCUE_PINS.map(({ name, at }) => {
    const gps = RESCUE_POINTS.find((p) => p.name.zh === name)?.coords
    if (!gps) throw new Error(`src/data/rescue.ts 找不到有座標的救援點「${name}」`)
    return { at, gps, slack: 0 }
  }),
  ...FIELD_POINTS.map((p) => ({ ...p, slack: 0 })),
  ...REFERENCE_POINTS.map((p) => ({ ...p, slack: REFERENCE_SLACK })),
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

/**
 * 線條的點：換算是逐點做的，兩點之間的長邊在換算後仍是直線，不會跟著彎；
 * 所以先把每條邊切成不超過 DENSIFY_PT 的小段再換算，換算後再以 SIMPLIFY_M 去掉多餘的點（放大後也平滑）。
 */
const DENSIFY_PT = 3
const SIMPLIFY_M = 0.15
/** 9 個區域放大看得最多，去點更細 */
const AREA_SIMPLIFY_M = 0.04
/** 曲線切成幾段：控制點折線每 CURVE_STEP_PT 一段，至少 8 段、最多 64 段 */
const CURVE_STEP_PT = 1.5
/** 陸地超出頁面的部分是圖面裁切的邊，不是海岸：往外推這麼遠（點），讓陸地自然延伸出畫面 */
const OFF_PAGE_PUSH_PT = 3000

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
          const hull = Math.hypot(data[j + 1] - x0, data[j + 2] - y0) + Math.hypot(data[j + 3] - data[j + 1], data[j + 4] - data[j + 2]) + Math.hypot(data[j + 5] - data[j + 3], data[j + 6] - data[j + 4])
          const steps = Math.min(64, Math.max(8, Math.ceil((hull * Math.hypot(m[0], m[1])) / CURVE_STEP_PT)))
          for (let k = 1; k <= steps; k++) {
            const t = k / steps
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

/** 薄板樣條：通過每個控制點（slack 大於 0 的點允許偏離，越大越鬆），其餘平滑內插；控制點範圍外近似仿射 */
function thinPlateSpline(from: Pt[], to: Pt[], slack: number[]): (p: Pt) => Pt {
  const n = from.length
  const U = (a: Pt, b: Pt) => {
    const r2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
    return r2 === 0 ? 0 : r2 * Math.log(Math.sqrt(r2))
  }
  const L = Array.from({ length: n + 3 }, () => new Array<number>(n + 3).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) L[i][j] = U(from[i], from[j])
    L[i][i] = slack[i]
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
const buildWarp = (points: { at: Pt; gps: Pt; slack: number }[]) =>
  thinPlateSpline(
    points.map((c) => c.at),
    points.map((c) => toMeters(c.gps)),
    points.map((c) => c.slack),
  )

/**
 * 沿線對應：救援資訊圖在岩場以外畫得較隨意（例如南邊海灣的海岸差 60–80 公尺），
 * 沿圖上的海岸線、台二線每隔一段取一點，對到 OpenStreetMap 同一條線上最近的位置，當作參考點；
 * 對應後重新校正、再對一次（兩輪），讓對應收斂。岩場附近的岩岸太複雜、容易對錯，不在範圍內。
 * 參考資料：scripts/data/osm-reference.json（© OpenStreetMap contributors，ODbL）。
 */
const osmReference = JSON.parse(readFileSync(new URL('./data/osm-reference.json', import.meta.url), 'utf8')) as { coastline: Pt[][]; highway: Pt[][] }
const OSM_LINES = { coastline: osmReference.coastline.map((l) => l.map(toMeters)), highway: osmReference.highway.map((l) => l.map(toMeters)) }

type Box = [number, number, number, number]
const inBox = (p: Pt, [x0, y0, x1, y1]: Box) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1
/** 沿折線每隔 step 點取一點（只取 box 範圍內的） */
function sampleAlong(lines: Pt[][], box: Box, step: number): Pt[] {
  const picked: Pt[] = []
  for (const line of lines) {
    let last: Pt | undefined
    for (const p of line) {
      if (!inBox(p, box)) continue
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= step) picked.push((last = p))
    }
  }
  return picked
}

const PAGE: Box = [0, 0, PAGE_SIZE[0], PAGE_SIZE[1]]
const CURVE_MATCHES: { note: string; target: keyof typeof OSM_LINES; samples: Pt[]; slack: number }[] = [
  { note: '海岸：南邊海灣（龍洞南口海洋公園）', target: 'coastline', samples: sampleAlong([land[0].subpaths[0]], [820, 2150, 1420, 2600], 40), slack: 5000 },
  { note: '海岸：北邊漁港', target: 'coastline', samples: sampleAlong([land[0].subpaths[0]], [150, 650, 1000, 1000], 40), slack: 5000 },
  { note: '台二線', target: 'highway', samples: sampleAlong(highways.flatMap((s) => s.subpaths), PAGE, 60), slack: 3000 },
]
/** 對到的點超過這個距離就不用（公尺），避免對到另一段 */
const CURVE_MAX_M = 150

/** 點到一組折線上最近的位置（公尺座標） */
function nearestOn(lines: Pt[][], q: Pt): Pt {
  let best: Pt = lines[0][0]
  let bestD = Infinity
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2))
      const p: Pt = [a[0] + t * dx, a[1] + t * dy]
      const d = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (d < bestD) [best, bestD] = [p, d]
    }
  }
  return best
}
const fromMeters = ([e, n]: Pt): Pt => [lat0 + n / metersPerDegLat, lng0 + e / metersPerDegLng]

let curvePoints: { at: Pt; gps: Pt; slack: number }[] = []
for (let round = 0; round < 2; round++) {
  const current = buildWarp([...CONTROL_POINTS, ...curvePoints])
  curvePoints = CURVE_MATCHES.flatMap(({ target, samples, slack }) =>
    samples.flatMap((at) => {
      const here = current(at)
      const to = nearestOn(OSM_LINES[target], here)
      return Math.hypot(to[0] - here[0], to[1] - here[1]) <= CURVE_MAX_M ? [{ at, gps: fromMeters(to), slack }] : []
    }),
  )
}
for (const m of CURVE_MATCHES) console.log(`沿線參考點：${m.note} 取樣 ${m.samples.length} 個`)
console.log(`沿線參考點共 ${curvePoints.length} 個`)
const warp = buildWarp([...CONTROL_POINTS, ...curvePoints])
/** 換算後的公尺座標 → GeoJSON 的 [經度, 緯度]（小數 6 位，約 0.1 公尺） */
const metersToLngLat = ([e, n]: Pt): Pt => [+(lng0 + e / metersPerDegLng).toFixed(6), +(lat0 + n / metersPerDegLat).toFixed(6)]
/** 圖上位置 → GeoJSON 的 [經度, 緯度] */
const toLngLat = (p: Pt): Pt => metersToLngLat(warp(p))

/** 把每條邊切成不超過 step 的小段 */
function densify(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

/**
 * 圓滑：救援資訊圖的區域與海岸多半是直線段組成的多邊形，放大後轉角很生硬。
 * 用向心 Catmull–Rom 樣條通過原本的每個頂點（形狀不變），頂點之間改成平滑曲線；向心參數化不會在尖角處繞圈。
 */
function smoothRing(ring: Pt[], step: number): Pt[] {
  const closed = ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  const pts = closed ? ring.slice(0, -1) : ring
  const n = pts.length
  if (n < 3) return ring
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  const out: Pt[] = []
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const knot = (a: Pt, b: Pt) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    const k = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step))
    out.push(p1)
    for (let j = 1; j < k; j++) {
      const t = t1 + ((t2 - t1) * j) / k
      const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)]
      const a1 = lerp(p0, p1, 0, t1)
      const a2 = lerp(p1, p2, t1, t2)
      const a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, 0, t2)
      const b2 = lerp(a2, a3, t1, t3)
      out.push(lerp(b1, b2, t1, t2))
    }
  }
  out.push(closed ? pts[0] : pts[n - 1])
  return out
}
/** 圓滑時每段不超過幾點 */
const SMOOTH_STEP_PT = 1.5

/** 陸地的頁面外頂點往外推（見 OFF_PAGE_PUSH_PT） */
const pushOffPage = (ring: Pt[]): Pt[] =>
  ring.map(([x, y]) => [x < 0 ? x - OFF_PAGE_PUSH_PT : x, y > PAGE_SIZE[1] ? y + OFF_PAGE_PUSH_PT : y])

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

const line = (s: Pt[], tolerance = SIMPLIFY_M) => simplify(densify(s, DENSIFY_PT).map(warp), tolerance).map(metersToLngLat)
const ring = (s: Pt[], tolerance = SIMPLIFY_M) => {
  const r = line(s, tolerance)
  if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0])
  return r
}
const polygons = (list: Shape[]) => list.flatMap((s) => s.subpaths.filter((p) => p.length >= 3).map((p) => [ring(p)]))
/**
 * 道路、步道在頁面邊緣截斷：救援資訊圖有些線畫到頁面外，頁面外沒有控制點，換算出來是推測的（會多出不存在的彎）。
 * 每段與頁面框求交（Liang–Barsky），只留頁面內的部分。
 */
function clipToPage(points: Pt[]): Pt[][] {
  const [x0, y0, x1, y1] = PAGE
  const pieces: Pt[][] = []
  let current: Pt[] = []
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const d: Pt = [b[0] - a[0], b[1] - a[1]]
    let t0 = 0
    let t1 = 1
    const edges: [number, number][] = [
      [-d[0], a[0] - x0],
      [d[0], x1 - a[0]],
      [-d[1], a[1] - y0],
      [d[1], y1 - a[1]],
    ]
    let visible = true
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) visible = false
      } else {
        const t = q / p
        if (p < 0) t0 = Math.max(t0, t)
        else t1 = Math.min(t1, t)
      }
    }
    if (!visible || t0 > t1) {
      if (current.length >= 2) pieces.push(current)
      current = []
      continue
    }
    const from: Pt = [a[0] + d[0] * t0, a[1] + d[1] * t0]
    const to: Pt = [a[0] + d[0] * t1, a[1] + d[1] * t1]
    if (current.length === 0 || t0 > 0) {
      if (current.length >= 2) pieces.push(current)
      current = [from]
    }
    current.push(to)
    if (t1 < 1) {
      pieces.push(current)
      current = []
    }
  }
  if (current.length >= 2) pieces.push(current)
  return pieces
}
const lines = (list: Shape[]) => list.flatMap((s) => s.subpaths.filter((p) => p.length >= 2).flatMap(clipToPage).map((p) => line(p)))
const feature = (properties: Record<string, string | number>, geometry: object) => ({ type: 'Feature', properties, geometry })
const point = (properties: Record<string, string | number>, at: Pt) => feature(properties, { type: 'Point', coordinates: toLngLat(at) })

// 誤差檢查：救援點、現場點換算回來必須落在原本的座標上；參考點在容許範圍內
for (const { at, gps, slack, note } of CONTROL_POINTS) {
  const [lng, lat] = toLngLat(at)
  const err = Math.hypot((lng - gps[1]) * metersPerDegLng, (lat - gps[0]) * metersPerDegLat)
  const limit = slack ? REFERENCE_TOLERANCE_M : 0.5
  if (process.env.SLACK !== undefined && slack) console.log(`參考點 ${note}：偏 ${err.toFixed(1)} 公尺`)
  if (err > limit) throw new Error(`控制點 ${note ?? gps} 換算後偏了 ${err.toFixed(1)} 公尺（上限 ${limit}）`)
}

const source = `TOCC 龍洞岩場救援資訊圖 2026 年 7 月版，以 ${CONTROL_POINTS.length} 個控制點校正（${RESCUE_PINS.length} 個救援點、${FIELD_POINTS.length} 個現場點、${REFERENCE_POINTS.length} 個 OpenStreetMap 道路參考點、${curvePoints.length} 個沿線參考點）；© 臺灣戶外攀岩協會；道路參考 © OpenStreetMap contributors（ODbL）`

const scaleMap = {
  type: 'FeatureCollection',
  source,
  features: [
    feature({ kind: 'land' }, { type: 'MultiPolygon', coordinates: land.flatMap((s) => s.subpaths.map((p) => [ring(pushOffPage(smoothRing(p, SMOOTH_STEP_PT)))])) }),
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
    feature({ id: key }, { type: 'MultiPolygon', coordinates: areaShapes.filter((s) => s.fill === fill).flatMap((s) => s.subpaths.filter((p) => p.length >= 3).map((p) => [ring(smoothRing(p, SMOOTH_STEP_PT), AREA_SIMPLIFY_M)])) }),
  ),
}

mkdirSync('public/rescue', { recursive: true })
for (const [name, data] of [['scale-map', scaleMap], ['areas', areas]] as const) {
  const text = JSON.stringify(data)
  writeFileSync(`public/rescue/${name}.geojson`, text + '\n')
  console.log(`${name}.geojson ${(text.length / 1024).toFixed(0)} KB`)
}
