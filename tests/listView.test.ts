import { describe, expect, it } from 'vitest'
import type { Route } from '../src/data/schema'
import { EMPTY_FILTER, applyView, filterCount, nextSort, toggle, type ListView } from '../src/listView'

const r = (id: string, gradeValue: number | undefined, type: Route['type'], safety?: Route['safety']) => ({
  route: { id, gradeValue, type, safety } as Route,
})
// a: 5.9 運攀綠燈、b: 5.11 傳攀黃燈、c: 5.10 運攀綠燈、d: 沒有難度、e: 5.12 頂繩、沒評級
const items = [r('a', 39, 'sport', 'green'), r('b', 45, 'trad', 'yellow'), r('c', 41, 'sport', 'green'), r('d', undefined, 'sport'), r('e', 48, 'toprope')]
const ratings: Record<string, number> = { a: 3, b: 4.5, e: 4 }
const ids = (view: Partial<ListView>) =>
  applyView(items, { sort: 'default', desc: false, filter: EMPTY_FILTER, ...view }, (id) => ratings[id]).map((i) => i.route.id)

describe('路線清單排序與篩選', () => {
  it('預設保持原本順序', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('依難度排序，沒有難度的永遠在最後', () => {
    expect(ids({ sort: 'grade' })).toEqual(['a', 'c', 'b', 'e', 'd'])
    expect(ids({ sort: 'grade', desc: true })).toEqual(['e', 'b', 'c', 'a', 'd'])
  })

  it('依評分排序，沒有評分的在最後', () => {
    expect(ids({ sort: 'rating', desc: true })).toEqual(['b', 'e', 'a', 'c', 'd'])
  })

  it('篩選：難度區間、路線種類（可複選）、安全燈號，條件之間是「且」', () => {
    expect(ids({ filter: { ...EMPTY_FILTER, bands: ['g10', 'g11'] } })).toEqual(['b', 'c'])
    expect(ids({ filter: { ...EMPTY_FILTER, kinds: ['trad'] } })).toEqual(['b'])
    expect(ids({ filter: { ...EMPTY_FILTER, kinds: ['trad', 'toprope'] } })).toEqual(['b', 'e'])
    expect(ids({ filter: { ...EMPTY_FILTER, safety: ['green'] } })).toEqual(['a', 'c'])
    expect(ids({ filter: { bands: ['easy', 'g10'], kinds: ['sport'], safety: ['green'] }, sort: 'grade', desc: true })).toEqual(['c', 'a'])
  })

  it('點欄位標題：同欄切換方向，換欄用自然方向', () => {
    const view: ListView = { sort: 'default', desc: false, filter: EMPTY_FILTER }
    expect(nextSort(view, 'grade')).toEqual({ sort: 'grade', desc: false })
    expect(nextSort(view, 'rating')).toEqual({ sort: 'rating', desc: true })
    expect(nextSort({ ...view, sort: 'grade' }, 'grade')).toEqual({ sort: 'grade', desc: true })
  })

  it('小工具', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
    expect(filterCount({ bands: ['g10'], kinds: [], safety: ['red', 'green'] })).toBe(3)
  })
})
