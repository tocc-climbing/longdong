import type { Marks, Point } from './model'

const sameSpot = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1]

/** 線段的 key，兩端對調視為同一段 */
const segmentKey = (a: Point, b: Point) => (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a}|${b}` : `${b}|${a}`)

/**
 * 每條路線實際要畫的折線。兩條路線共用的線段（兩端座標相同，例如從另一條路線分岔出來的前段）
 * 只畫一次，歸排在前面的那條；連續的線段接成一條折線。
 */
export function drawnRuns(lines: [id: string, line: Point[]][]): Map<string, Point[][]> {
  const seen = new Set<string>()
  const runs = new Map<string, Point[][]>()
  for (const [id, line] of lines) {
    const own: Point[][] = []
    let run: Point[] | undefined
    for (let i = 0; i < line.length - 1; i++) {
      const key = segmentKey(line[i], line[i + 1])
      if (seen.has(key)) {
        run = undefined
        continue
      }
      seen.add(key)
      if (!run) own.push((run = [line[i]]))
      run.push(line[i + 1])
    }
    runs.set(id, own)
  }
  return runs
}

/**
 * 同一個位置有好幾個編號時橫向排開，不疊在一起。
 * 回傳每個編號中心的水平位移（螢幕像素，以該位置為準）；位置不同的編號位移為 0。
 */
export function spreadBadges(items: { id: string; at: Point; width: number }[], gap = 3): Map<string, number> {
  const groups = new Map<string, typeof items>()
  for (const item of items) groups.set(`${item.at}`, [...(groups.get(`${item.at}`) ?? []), item])
  const offsets = new Map<string, number>()
  for (const group of groups.values()) {
    const total = group.reduce((sum, b) => sum + b.width, 0) + gap * (group.length - 1)
    let left = -total / 2
    for (const b of group) {
      offsets.set(b.id, left + b.width / 2)
      left += b.width + gap
    }
  }
  return offsets
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
