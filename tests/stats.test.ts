import { describe, expect, it } from 'vitest'
import type { Route } from '../src/data/schema'
import type { Tick } from '../src/personal/model'
import { gradePyramid, groupByMonth, monthlyCounts, sendStyles } from '../src/personal/stats'

const tick = (routeId: string, date: string, style: Tick['style'] = 'redpoint'): Tick => ({
  id: `${routeId}-${date}-${style}`, routeId, date, style, createdAt: 'x', updatedAt: 'x',
})
const routes: Record<string, Partial<Route>> = {
  a: { grade: '5.10a', gradeValue: 40, type: 'sport' },
  b: { grade: '5.10a', gradeValue: 40, type: 'trad' },
  c: { grade: '5.11c', gradeValue: 46, type: 'sport' },
  d: { grade: '5.10? R', gradeValue: 41.5, type: 'trad' },
  e: { grade: '5.8', gradeValue: 32, type: 'trad' },
  f: { grade: '5.9', gradeValue: 36, type: 'sport' },
}
const lookup = (id: string) => routes[id] as Route | undefined
const none = { onsight: 0, redpoint: 0, toprope: 0 }

describe('sendStyles', () => {
  it('每條路線取最好的方式；嘗試不算；Flash 算 RP、跟攀算 TR；路線清單一起算', () => {
    const ticks = [tick('a', '2026-10-01'), tick('a', '2026-10-02', 'onsight'), tick('b', '2026-10-03', 'flash'), tick('c', '2026-10-04', 'attempt'), tick('d', '2026-10-05', 'follow')]
    expect(Object.fromEntries(sendStyles(ticks, new Map([['e', 'toprope']])))).toEqual({ a: 'onsight', b: 'redpoint', d: 'toprope', e: 'toprope' })
  })

  it('攀登紀錄比路線清單好時，取攀登紀錄', () => {
    expect(sendStyles([tick('a', '2026-10-01', 'onsight')], new Map([['a', 'redpoint']])).get('a')).toBe('onsight')
  })
})

describe('gradePyramid', () => {
  const sends = new Map([
    ['a', 'onsight'],
    ['b', 'redpoint'],
    ['c', 'redpoint'],
    ['d', 'toprope'],
    ['e', 'onsight'],
    ['f', 'onsight'],
  ] as const)

  it('依完攀方式分開、難的在上；5.10a 以上中間沒完攀的也列出；5.9 以下合併成「5.9-」', () => {
    expect(gradePyramid(sends, lookup).map((r) => [r.grade, r.routes])).toEqual([
      ['5.11c', 1],
      ['5.11b', 0],
      ['5.11a', 0],
      ['5.10d', 0],
      ['5.10c', 0],
      ['5.10?', 1],
      ['5.10b', 0],
      ['5.10a', 2],
      ['5.9-', 2],
    ])
    const top = gradePyramid(sends, lookup)
    expect(top.find((r) => r.grade === '5.10a')?.styles).toEqual({ ...none, onsight: 1, redpoint: 1 })
    expect(top.find((r) => r.grade === '5.9-')?.styles).toEqual({ ...none, onsight: 2 })
  })

  it('只算選取的路線種類', () => {
    expect(gradePyramid(sends, lookup, ['trad']).map((r) => [r.grade, r.routes])).toEqual([
      ['5.10?', 1],
      ['5.10a', 1],
      ['5.9-', 1],
    ])
  })

  it('沒有完攀時是空的', () => {
    expect(gradePyramid(new Map(), lookup)).toEqual([])
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
