import { describe, expect, it } from 'vitest'
import type { Route } from '../src/data/schema'
import type { Tick } from '../src/personal/model'
import { sentRouteIds } from '../src/personal/model'
import { gradePyramid, groupByMonth, monthlyCounts } from '../src/personal/stats'

const tick = (routeId: string, date: string, style: Tick['style'] = 'redpoint'): Tick => ({
  id: `${routeId}-${date}-${style}`, routeId, date, style, createdAt: 'x', updatedAt: 'x',
})
const routes: Record<string, Partial<Route>> = {
  a: { grade: '5.10a', gradeValue: 40 },
  b: { grade: '5.10a', gradeValue: 40 },
  c: { grade: '5.11c', gradeValue: 46 },
  d: { grade: '5.10? R', gradeValue: 41.5 },
}
const lookup = (id: string) => routes[id] as Route | undefined

describe('gradePyramid', () => {
  it('每條路線只算一次、嘗試不算、難的在上', () => {
    const ticks = [tick('a', '2026-10-01'), tick('a', '2026-10-02', 'onsight'), tick('b', '2026-10-03'), tick('c', '2026-10-04', 'attempt'), tick('d', '2026-10-05')]
    expect(gradePyramid(sentRouteIds(ticks, new Map()), lookup)).toEqual([
      { grade: '5.10?', value: 41.5, routes: 1 },
      { grade: '5.10a', value: 40, routes: 2 },
    ])
  })

  it('路線清單勾選的也算完攀（沒有日期的攀登紀錄）', () => {
    const rows = gradePyramid(sentRouteIds([tick('a', '2026-10-01')], new Map([['c', 'redpoint']])), lookup)
    expect(rows.reduce((n, r) => n + r.routes, 0)).toBe(2)
  })
})

describe('monthlyCounts', () => {
  it('最近 12 個月，含本月', () => {
    const m = monthlyCounts([tick('a', '2026-10-01'), tick('b', '2026-10-09'), tick('c', '2025-11-30'), tick('c', '2025-10-30')], new Date(2026, 9, 11))
    expect(m).toHaveLength(12)
    expect(m[0]).toEqual({ key: '2025-11', count: 1 })
    expect(m[11]).toEqual({ key: '2026-10', count: 2 })
  })
})

describe('groupByMonth', () => {
  it('依月份分組', () => {
    const g = groupByMonth([tick('a', '2026-10-09'), tick('b', '2026-10-01'), tick('c', '2026-09-30')])
    expect(g.map((x) => [x.key, x.ticks.length])).toEqual([
      ['2026-10', 2],
      ['2026-09', 1],
    ])
  })
})
