import type { Marks, Point } from './geometry'

export const sameSpot = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1]

/** 線段的 key，兩端對調視為同一段 */
const segmentKey = (a: Point, b: Point) => (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a}|${b}` : `${b}|${a}`)

/**
 * 每條路線實際要畫的折線。兩條路線共用的線段（兩端座標相同，例如從另一條路線分岔出來的前段）
 * 只畫一次，歸排在前面的那條；連續的線段接成一條折線。
 */
export function drawnRuns(lines: [id: string, line: Point[]][]): Map<string, Point[][]> {
  const seen = new Set<string>()
  return new Map(
    lines.map(([id, line]) => [
      id,
      runsOf(line, (key) => {
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }),
    ]),
  )
}

/**
 * 每條路線獨有的折線：不和任何一條路線共用的線段。分岔的路線編號標在這裡（各自的岔線上），
 * 不標在共用的前段，否則看不出哪個編號是哪條岔線。
 */
export function ownRuns(lines: [id: string, line: Point[]][]): Map<string, Point[][]> {
  const uses = new Map<string, number>()
  for (const [, line] of lines) {
    for (const key of new Set(line.slice(1).map((p, i) => segmentKey(line[i], p)))) uses.set(key, (uses.get(key) ?? 0) + 1)
  }
  return new Map(lines.map(([id, line]) => [id, runsOf(line, (key) => uses.get(key) === 1)]))
}

/** keep 為真的連續線段接成折線 */
function runsOf(line: Point[], keep: (key: string) => boolean): Point[][] {
  const runs: Point[][] = []
  let run: Point[] | undefined
  for (let i = 0; i < line.length - 1; i++) {
    if (!keep(segmentKey(line[i], line[i + 1]))) {
      run = undefined
      continue
    }
    if (!run) runs.push((run = [line[i]]))
    run.push(line[i + 1])
  }
  return runs
}

/** 點線的中間：離線段這個距離內（照片高度的萬分比）插入這一段，否則接在線尾 */
const INSERT_NEAR = 150

/**
 * 點在哪一段線的中間：垂足在線段內（兩端是把手，不算），距離依照片實際的寬高比計算（aspect = 寬／高）。
 * 回傳最近那段的起點索引，沒有則 -1。
 */
export function segmentAt(line: Point[], p: Point, aspect: number): number {
  let best = -1
  let bestDistance = INSERT_NEAR
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const [dx, dy] = [(b[0] - a[0]) * aspect, b[1] - a[1]]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? -1 : (((p[0] - a[0]) * aspect) * dx + (p[1] - a[1]) * dy) / len2
    if (t <= 0 || t >= 1) continue
    const distance = Math.hypot((p[0] - a[0]) * aspect - t * dx, p[1] - a[1] - t * dy)
    if (distance <= bestDistance) [best, bestDistance] = [i - 1, distance]
  }
  return best
}

/**
 * 在路線 id 的線上加一個點：點在線段中間就插進那一段，否則接在線尾。
 * 插進共用的線段（分岔路線的前段）時，共用這一段的路線一起插入，兩條線不會分開。
 */
export function addLinePoint(marks: Marks, id: string, p: Point, aspect: number): Marks {
  const line = marks[id]?.line ?? []
  const at = segmentAt(line, p, aspect)
  if (at < 0) return { ...marks, [id]: { ...marks[id], line: [...line, p] } }
  const [a, b] = [line[at], line[at + 1]]
  return Object.fromEntries(
    Object.entries(marks).map(([key, m]) => [
      key,
      m.line ? { ...m, line: m.line.flatMap((q, i, all) => (i < all.length - 1 && segmentKey(q, all[i + 1]) === segmentKey(a, b) ? [q, p] : [q])) } : m,
    ]),
  )
}

/** 從另一條路線的第 index 個點分岔：複製到這個點為止的前段 */
export function forkLine(line: Point[], index: number): Point[] {
  return line.slice(0, index + 1)
}

/** 把所有落在 from 的線段端點一起移到 to：分岔出來的路線與原路線共用的點不會拖開 */
export function moveSharedPoint(marks: Marks, from: Point, to: Point): Marks {
  return Object.fromEntries(
    Object.entries(marks).map(([id, m]) => [id, m.line ? { ...m, line: m.line.map((p) => (sameSpot(p, from) ? to : p)) } : m]),
  )
}
