import type { LineLayer, LineName } from './mapData'

type Vec = [number, number]
type Box = [number, number, number, number]

/** 一個排好的名稱：沿著 points（螢幕座標，由左往右，文字朝上）排字 */
export interface PlacedName {
  key: string
  name: LineName
  points: Vec[]
  box: Box
}

/** 名稱離畫面邊緣至少幾像素、外框多留幾像素（判斷重疊） */
const EDGE_PX = 10
const BOX_PAD_PX = 6

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

/**
 * 道路、步道的名稱沿著線排，位置不固定：每個名稱找 line 圖層裡離錨點最近的那條線，取它完全在畫面裡的最長一段，
 * 名稱放在這段的中點（平移、縮放、旋轉時跟著移動）；線往左走時反過來，文字保持朝上。
 * 那段放不下名稱、或和已經排好的名稱重疊時不畫；同一條線只排一個名稱。
 * lines 是地圖座標，screen 換成螢幕座標；width 是名稱在畫面上的寬度（像素）。
 */
export function placeLineNames(
  names: LineName[],
  lines: Record<LineLayer, Vec[][]>,
  screen: (p: Vec) => Vec,
  frame: { w: number; h: number },
  width: (name: LineName) => number,
): PlacedName[] {
  const inside = ([x, y]: Vec) => x >= EDGE_PX && y >= EDGE_PX && x <= frame.w - EDGE_PX && y <= frame.h - EDGE_PX
  const used = new Set<string>()
  const placed: PlacedName[] = []
  names.forEach((name, n) => {
    const candidates = lines[name.line]
    if (!candidates.length) return
    const index = candidates
      .map((l, i) => ({ i, d: Math.min(...l.slice(1).map((b, j) => segmentDistance(name.at, l[j], b))) }))
      .reduce((a, b) => (b.d < a.d ? b : a)).i
    const key = `${name.line}:${index}`
    if (used.has(key)) return
    // 完全在畫面裡的連續幾段中最長的一段
    const pts = candidates[index].map(screen)
    let best: Vec[] = []
    let run: Vec[] = []
    const runLength = (r: Vec[]) => r.slice(1).reduce((s, p, i) => s + dist(r[i], p), 0)
    for (const p of pts) {
      if (inside(p)) run.push(p)
      else {
        if (runLength(run) > runLength(best)) best = run
        run = []
      }
    }
    if (runLength(run) > runLength(best)) best = run
    const total = runLength(best)
    const need = width(name)
    if (total < need) return
    let points = slice(best, (total - need) / 2, (total + need) / 2)
    if (points.length < 2) return
    if (points[points.length - 1][0] < points[0][0]) points = [...points].reverse()
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const box: Box = [Math.min(...xs) - BOX_PAD_PX, Math.min(...ys) - BOX_PAD_PX, Math.max(...xs) + BOX_PAD_PX, Math.max(...ys) + BOX_PAD_PX]
    if (placed.some((p) => overlaps(p.box, box))) return
    used.add(key)
    placed.push({ key: `${key}:${n}`, name, points, box })
  })
  return placed
}
