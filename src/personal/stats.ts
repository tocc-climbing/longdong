import type { Route, RouteType } from '../data/schema'
import { BEST_STYLES, bestStyle, checklistStyle, isSent, type BestStyle, type Tick } from './model'

/** 完攀方式（與路線清單相同的三種）：OS、RP、TR */
export type SendStyle = (typeof BEST_STYLES)[number]

/** 每條完攀過的路線最好的方式：攀登紀錄（嘗試不算）加上路線清單；Flash 算 RP、跟攀算 TR */
export function sendStyles(ticks: Tick[], best: Map<string, BestStyle>): Map<string, SendStyle> {
  const styles = new Map<string, Tick['style'][]>()
  for (const t of ticks) if (isSent(t.style)) styles.set(t.routeId, [...(styles.get(t.routeId) ?? []), t.style])
  for (const [id, style] of best) styles.set(id, [...(styles.get(id) ?? []), style])
  const sends = new Map<string, SendStyle>()
  for (const [id, list] of styles) {
    const style = checklistStyle(bestStyle(list)!)
    if (style) sends.set(id, style)
  }
  return sends
}

export interface PyramidRow {
  grade: string
  value: number
  /** 這個難度完攀的路線數（同一條路線只算一次） */
  routes: number
  /** 依完攀方式 */
  styles: Record<SendStyle, number>
}

/** 5.10a（40）以上每個字母一級；以下合併成一列「5.9-」 */
const LETTER_GRADES_FROM = 40
const EASY_VALUE = LETTER_GRADES_FROM - 1

/** 難度數值 → 名稱（40 = 5.10a、44 = 5.11a…） */
function letterGrade(value: number): string {
  const step = value - LETTER_GRADES_FROM
  return `5.${10 + Math.floor(step / 4)}${'abcd'[step % 4]}`
}

const emptyStyles = (): Record<SendStyle, number> => ({ onsight: 0, redpoint: 0, toprope: 0 })

/**
 * 難度金字塔：每個難度完攀過幾條不同的路線，依完攀方式分開，難的在上。
 * 5.10a 以上每一級都列出（中間沒完攀的為 0，看得出缺口）；5.9 以下合併成「5.9-」。types 有值時只算這些路線種類。
 */
export function gradePyramid(sends: Map<string, SendStyle>, lookup: (id: string) => Route | undefined, types: RouteType[] = []): PyramidRow[] {
  const byValue = new Map<number, PyramidRow>()
  const row = (value: number, grade: string) => {
    const existing = byValue.get(value)
    if (existing) return existing
    const created = { grade, value, routes: 0, styles: emptyStyles() }
    byValue.set(value, created)
    return created
  }
  for (const [id, style] of sends) {
    const r = lookup(id)
    if (!r?.grade || r.gradeValue === undefined) continue
    if (types.length > 0 && (!r.type || !types.includes(r.type))) continue
    const easy = r.gradeValue < LETTER_GRADES_FROM
    const target = easy ? row(EASY_VALUE, '5.9-') : row(r.gradeValue, r.grade.replace(/\s.*$/, ''))
    target.routes++
    target.styles[style]++
  }
  // 補上中間沒有完攀的字母難度
  const letters = [...byValue.keys()].filter((v) => v >= LETTER_GRADES_FROM && Number.isInteger(v))
  if (letters.length > 0) {
    for (let v = Math.min(...letters); v <= Math.max(...letters); v++) row(v, letterGrade(v))
  }
  return [...byValue.values()].sort((a, b) => b.value - a.value)
}

/** 近期攀登的區間：依有紀錄的範圍自動選最短、又包含所有紀錄的一個 */
export type ActivityRange = '7d' | '14d' | '1m' | '3m' | '6m' | '12m'

export interface ActivityBin {
  /** 第一天 YYYY-MM-DD */
  from: string
  /** 最後一天 YYYY-MM-DD（按日的與 from 相同） */
  to: string
  count: number
}

export interface Activity {
  range: ActivityRange
  /** 按日（7 天、14 天、1 個月）、按週（3 個月）或按月（6、12 個月） */
  unit: 'day' | 'week' | 'month'
  bins: ActivityBin[]
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const DAYS: Partial<Record<ActivityRange, number>> = { '7d': 7, '14d': 14, '1m': 30 }

/** 每個區間的長條：按日、按週從今天往回數，按月含本月 */
function activityBins(range: ActivityRange, now: Date): Activity {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = DAYS[range]
  if (days) {
    const bins = Array.from({ length: days }, (_, i) => {
      const d = ymd(addDays(today, i - days + 1))
      return { from: d, to: d, count: 0 }
    })
    return { range, unit: 'day', bins }
  }
  if (range === '3m') {
    const bins = Array.from({ length: 13 }, (_, i) => ({ from: ymd(addDays(today, (i - 13) * 7 + 1)), to: ymd(addDays(today, (i - 12) * 7)), count: 0 }))
    return { range, unit: 'week', bins }
  }
  const n = range === '6m' ? 6 : 12
  const bins = Array.from({ length: n }, (_, i) => {
    const first = new Date(today.getFullYear(), today.getMonth() - n + 1 + i, 1)
    return { from: ymd(first), to: ymd(new Date(first.getFullYear(), first.getMonth() + 1, 0)), count: 0 }
  })
  return { range, unit: 'month', bins }
}

const RANGES: ActivityRange[] = ['7d', '14d', '1m', '3m', '6m', '12m']

/**
 * 近期每日／週／月的攀登紀錄筆數。區間依有紀錄的範圍自動調整：
 * 7 天、14 天、1 個月、3 個月、6 個月、12 個月中，第一個包含近 12 個月內所有紀錄的；
 * 近 12 個月都沒有紀錄時回傳 undefined（不顯示）。
 */
export function recentActivity(ticks: Tick[], now = new Date()): Activity | undefined {
  const today = ymd(now)
  const year = activityBins('12m', now).bins[0].from
  const dates = ticks.map((t) => t.date).filter((d) => year <= d && d <= today)
  if (dates.length === 0) return undefined
  const oldest = dates.reduce((a, b) => (a < b ? a : b))
  const activity = RANGES.map((r) => activityBins(r, now)).find((a) => a.bins[0].from <= oldest)!
  for (const d of dates) {
    const bin = activity.bins.find((b) => b.from <= d && d <= b.to)
    if (bin) bin.count++
  }
  return activity
}

/** 依月份（YYYY-MM）分組（新到舊），給時間軸用 */
export function groupByMonth(ticks: Tick[]): { key: string; ticks: Tick[] }[] {
  return groupBy(ticks, (t) => t.date.slice(0, 7))
}

/** 最近去過的 n 天（新到舊），每天一組；key 是日期 YYYY-MM-DD */
export function recentVisits(ticks: Tick[], n: number): { key: string; ticks: Tick[] }[] {
  return groupBy(ticks, (t) => t.date).slice(0, n)
}

/** ticks 已依日期新到舊排好：相鄰同一個 key 的放在一組 */
function groupBy(ticks: Tick[], keyOf: (t: Tick) => string): { key: string; ticks: Tick[] }[] {
  const groups: { key: string; ticks: Tick[] }[] = []
  for (const t of ticks) {
    const key = keyOf(t)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = { key, ticks: [] }
      groups.push(g)
    }
    g.ticks.push(t)
  }
  return groups
}
