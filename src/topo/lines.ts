import type { Route } from '../data/schema'
import type { Marks, Point, RouteMarks } from './model'

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

/** 共用的 bolt、anchor：新標的點離另一條路線的線在這個距離內（萬分比）才算在同一個位置 */
const SHARED_NEAR = 600

/** 點到折線的最短距離 */
function distanceToLine(p: Point, line: Point[]): number {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
  }
  return best
}

/**
 * 顯示用：共用的 bolt、anchor 只有一條路線標過時，另一條路線也顯示（選到〈細縫〉也看得到只標在〈Z字〉的頂端 anchor）。
 * 條件和 syncShared 一樣：兩條路線資料裡這個位置有一邊標「共用」、這條路線有線、點離它的線不遠、這個位置還沒標。不改資料，只補畫。
 */
export function fillShared(marks: Marks, routes: Route[]): Marks {
  const slots = (r: Route) => [...r.bolts, ...r.anchors]
  let out = marks
  for (const route of routes) {
    const mine = marks[route.id]
    if (!mine?.line) continue
    for (const slot of slots(route)) {
      if (mine.bolts?.[slot.position]) continue
      for (const other of routes) {
        const at = other.id === route.id ? undefined : marks[other.id]?.bolts?.[slot.position]
        const theirs = other.id === route.id ? undefined : slots(other).find((b) => b.position === slot.position)
        if (!at || !theirs || (slot.material !== '共用' && theirs.material !== '共用') || distanceToLine(at, mine.line) > SHARED_NEAR) continue
        out = { ...out, [route.id]: { ...out[route.id], bolts: { ...out[route.id].bolts, [slot.position]: at } } }
        break
      }
    }
  }
  return out
}

/**
 * 共用的 bolt、anchor 自動同步：路線資料裡某個位置（B01、A01…）標「共用」，表示和同分區另一條路線是同一個固定點
 * （例如〈細縫〉與〈Z字〉共用頂端的 anchor）。選到的路線 id 標了、移動或刪除了這個位置，另一條路線跟著一樣：
 * - 新標的：另一條路線有這個位置、已經畫了線、點離它的線不遠、還沒標這個位置時，標在同一個點
 * - 移動、刪除：另一條路線這個位置原本就在同一個點的，一起移動、刪除
 * before 是修改前的標記，marks 是修改後的（只有 id 這條路線改了）。
 */
export function syncShared(marks: Marks, before: Marks, id: string, routes: Route[]): Marks {
  const mine = routes.find((r) => r.id === id)
  if (!mine) return marks
  const was = before[id]?.bolts ?? {}
  const now = marks[id]?.bolts ?? {}
  const slot = (r: Route, position: string) => [...r.bolts, ...r.anchors].find((b) => b.position === position)
  let out = marks
  for (const position of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const [from, to] = [was[position], now[position]]
    if (from && to && sameSpot(from, to)) continue
    const mySlot = slot(mine, position)
    if (!mySlot) continue
    for (const other of routes) {
      const theirSlot = other.id === id ? undefined : slot(other, position)
      if (!theirSlot || (mySlot.material !== '共用' && theirSlot.material !== '共用')) continue
      const theirs = out[other.id]
      const at = theirs?.bolts?.[position]
      // 新標的：另一條路線的線要在附近，而且這個位置還空著；移動、刪除：原本就在同一個點的
      const follows = from ? !!at && sameSpot(at, from) : !!theirs?.line && !at && !!to && distanceToLine(to, theirs.line) <= SHARED_NEAR
      if (!follows) continue
      const bolts: Record<string, Point> = { ...theirs?.bolts }
      if (to) bolts[position] = to
      else delete bolts[position]
      const hasBolts = Object.keys(bolts).length > 0
      const next: RouteMarks = { ...(theirs?.line ? { line: theirs.line } : {}), ...(hasBolts ? { bolts } : {}) }
      if (next.line?.length || hasBolts) out = { ...out, [other.id]: next }
      else out = Object.fromEntries(Object.entries(out).filter(([key]) => key !== other.id))
    }
  }
  return out
}
