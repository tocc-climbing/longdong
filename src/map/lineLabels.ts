import type { LineLayer, LineName } from './mapData'

type Vec = [number, number]
type Box = [number, number, number, number]

/** 一個排好的名稱：沿著 points（螢幕座標，由左往右，文字朝上）排字；boxes 是文字佔的範圍（沿線的小方塊） */
export interface PlacedName {
  key: string
  name: LineName
  points: Vec[]
  boxes: Box[]
}

/** 名稱離畫面邊緣至少幾像素 */
const EDGE_PX = 10
/** 判斷重疊：沿著排字的線每 BOX_STEP_PX 取一個邊長 2 × BOX_HALF_PX 的方塊（斜的、彎的名稱也不會佔一大塊外框） */
const BOX_STEP_PX = 6
const BOX_HALF_PX = 7
/** 先排步道（攀岩者的路），道路最後 */
const LINE_ORDER: Record<LineLayer, number> = { trail: 0, road: 1, highway: 2, tunnel: 3 }

const dist = (a: Vec, b: Vec) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** 點到線段的距離 */
function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** 折線上從起點量起 s0 到 s1 這一段（含中間的頂點） */
function slice(points: Vec[], s0: number, s1: number): Vec[] {
  const out: Vec[] = []
  let at = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const len = dist(a, b)
    const lerp = (s: number): Vec => [a[0] + ((b[0] - a[0]) * (s - at)) / len, a[1] + ((b[1] - a[1]) * (s - at)) / len]
    if (out.length === 0 && s0 <= at + len) out.push(lerp(Math.max(s0, at)))
    if (out.length && s1 <= at + len) {
      out.push(lerp(s1))
      return out
    }
    if (out.length) out.push(b)
    at += len
  }
  return out
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/** 沿著折線每 BOX_STEP_PX 一個方塊 */
function boxesAlong(points: Vec[]): Box[] {
  const total = points.slice(1).reduce((s, p, i) => s + dist(points[i], p), 0)
  const n = Math.max(1, Math.ceil(total / BOX_STEP_PX))
  return Array.from({ length: n + 1 }, (_, k) => {
    const [x, y] = slice(points, 0, (total * k) / n).at(-1) ?? points[0]
    return [x - BOX_HALF_PX, y - BOX_HALF_PX, x + BOX_HALF_PX, y + BOX_HALF_PX]
  })
}

/** 點投影到折線上，從起點量起的距離 */
function arcAt(points: Vec[], p: Vec): number {
  let [best, bestD, at] = [0, Infinity, 0]
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const len = dist(a, b)
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len)))
    const d = Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1]))
    if (d < bestD) [best, bestD] = [at + t * len, d]
    at += len
  }
  return best
}

/**
 * 道路、步道的名稱沿著線排，位置固定在地圖上（平移、縮放時跟著地圖走，不會在線上跑來跑去）：
 * 每個名稱找 line 圖層裡離錨點最近的那條線，名稱的中心在錨點投影到線上的位置。
 * 線往左走時反過來，文字保持朝上；超出畫面、或和已經排好的名稱、occupied（優先的圖示與文字，螢幕座標）重疊時就不畫
 * （看不到沒關係，不換到別的位置）；同一條線只排一個名稱。
 * 步道的名稱先排，道路最後（重疊時道路的名稱先不畫）。
 * lines 是地圖座標，screen 換成螢幕座標，metersPerPx 是每個螢幕像素幾公尺；width 是名稱在畫面上的寬度（像素）。
 */
export function placeLineNames(
  names: LineName[],
  lines: Record<LineLayer, Vec[][]>,
  screen: (p: Vec) => Vec,
  frame: { w: number; h: number },
  width: (name: LineName) => number,
  occupied: Box[] = [],
  metersPerPx = 1,
): PlacedName[] {
  const inside = ([x, y]: Vec) => x >= EDGE_PX && y >= EDGE_PX && x <= frame.w - EDGE_PX && y <= frame.h - EDGE_PX
  const used = new Set<string>()
  const placed: PlacedName[] = []
  const order = names.map((name, n) => ({ name, n })).sort((a, b) => LINE_ORDER[a.name.line] - LINE_ORDER[b.name.line])
  const taken = [...occupied]
  order.forEach(({ name, n }) => {
    const candidates = lines[name.line]
    if (!candidates.length) return
    const index = candidates
      .map((l, i) => ({ i, d: Math.min(...l.slice(1).map((b, j) => segmentDistance(name.at, l[j], b))) }))
      .reduce((a, b) => (b.d < a.d ? b : a)).i
    const key = `${name.line}:${index}`
    if (used.has(key)) return
    const line = candidates[index]
    const total = line.slice(1).reduce((sum, p, i) => sum + dist(line[i], p), 0)
    const half = (width(name) * metersPerPx) / 2
    if (total < 2 * half) return
    // 中心（沿線距離，公尺）：錨點投影到線上的位置，靠近線的端點時往內收，名稱不超出線
    const c = Math.min(total - half, Math.max(half, arcAt(line, name.at)))
    let points = slice(line, c - half, c + half).map(screen)
    if (points.length < 2 || !points.every(inside)) return
    if (points[points.length - 1][0] < points[0][0]) points = [...points].reverse()
    const boxes = boxesAlong(points)
    if (boxes.some((b) => taken.some((o) => overlaps(b, o)))) return
    used.add(key)
    taken.push(...boxes)
    placed.push({ key: `${key}:${n}`, name, points, boxes })
  })
  return placed
}
