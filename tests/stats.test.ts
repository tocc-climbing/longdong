import { describe, expect, it } from 'vitest'
import type { Route } from '../src/data/schema'
import type { Tick } from '../src/personal/model'
import { gradePyramid, groupByMonth, recentActivity, recentVisits, sendStyles } from '../src/personal/stats'

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

describe('recentActivity', () => {
  const now = new Date(2026, 9, 11)
  const range = (dates: string[]) => recentActivity(dates.map((d, i) => tick(String(i), d)), now)

  it('近 12 個月沒有紀錄時不顯示', () => {
    expect(range([])).toBeUndefined()
    expect(range(['2025-10-30', '2026-10-12'])).toBeUndefined()
  })

  it('依最早的紀錄選最短的區間', () => {
    expect(range(['2026-10-05'])?.range).toBe('7d')
    expect(range(['2026-10-04'])?.range).toBe('14d')
    expect(range(['2026-09-20'])?.range).toBe('1m')
    expect(range(['2026-08-01'])?.range).toBe('3m')
    expect(range(['2026-05-01'])?.range).toBe('6m')
    expect(range(['2025-11-30', '2026-10-01'])?.range).toBe('12m')
  })

  it('按日：含今天的 7 天', () => {
    const a = range(['2026-10-05', '2026-10-11', '2026-10-11'])!
    expect(a.unit).toBe('day')
    expect(a.bins).toHaveLength(7)
    expect(a.bins[0]).toEqual({ from: '2026-10-05', to: '2026-10-05', count: 1 })
    expect(a.bins[6]).toEqual({ from: '2026-10-11', to: '2026-10-11', count: 2 })
  })

  it('按週：3 個月 13 週，最後一週到今天', () => {
    const a = range(['2026-08-01', '2026-10-11'])!
    expect(a.unit).toBe('week')
    expect(a.bins).toHaveLength(13)
    expect(a.bins[12]).toEqual({ from: '2026-10-05', to: '2026-10-11', count: 1 })
    expect(a.bins.reduce((n, b) => n + b.count, 0)).toBe(2)
  })

  it('按月：12 個月含本月，12 個月前的不算', () => {
    const a = range(['2026-10-01', '2026-10-09', '2025-11-30', '2025-10-30'])!
    expect(a.bins).toHaveLength(12)
    expect(a.bins[0]).toEqual({ from: '2025-11-01', to: '2025-11-30', count: 1 })
    expect(a.bins[11]).toEqual({ from: '2026-10-01', to: '2026-10-31', count: 2 })
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

describe('recentVisits', () => {
  it('同一天的放在一組，只取最近 n 天', () => {
    const v = recentVisits([tick('a', '2026-10-26'), tick('b', '2026-10-26'), tick('c', '2026-10-19'), tick('d', '2026-10-05')], 2)
    expect(v.map((x) => [x.key, x.ticks.map((t) => t.routeId)])).toEqual([
      ['2026-10-26', ['a', 'b']],
      ['2026-10-19', ['c']],
    ])
  })
})
