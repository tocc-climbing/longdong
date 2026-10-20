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

export interface MonthCount {
  /** YYYY-MM */
  key: string
  count: number
}

/** 最近 12 個月（含本月）每月的攀登紀錄筆數 */
export function monthlyCounts(ticks: Tick[], now = new Date()): MonthCount[] {
  const months: MonthCount[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({ key, count: 0 })
  }
  const index = new Map(months.map((m) => [m.key, m]))
  for (const t of ticks) {
    const m = index.get(t.date.slice(0, 7))
    if (m) m.count++
  }
  return months
}

/** 依月份（YYYY-MM）分組（新到舊），給時間軸用 */
export function groupByMonth(ticks: Tick[]): { key: string; ticks: Tick[] }[] {
  const groups: { key: string; ticks: Tick[] }[] = []
  for (const t of ticks) {
    const key = t.date.slice(0, 7)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = { key, ticks: [] }
      groups.push(g)
    }
    g.ticks.push(t)
  }
  return groups
}
