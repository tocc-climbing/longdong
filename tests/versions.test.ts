import { describe, expect, it } from 'vitest'
import { groupVersions } from '../src/edit/versions'

const v = (id: string, uid: string, day: number, hour: number) => ({ id, uid, createdAt: new Date(2026, 9, day, hour).getTime() })
const ids = (groups: ReturnType<typeof groupVersions<ReturnType<typeof v>>>) => groups.map((g) => g.members.map((m) => m.id))

describe('groupVersions（修改記錄：同一天同一人連續的版本合併）', () => {
  it('同一天、同一人、中間沒有別人：合併成一筆，顯示最新的', () => {
    const groups = groupVersions([v('a', 'KK', 26, 8), v('b', 'KK', 26, 12)])
    expect(ids(groups)).toEqual([['a', 'b']])
    expect(groups[0].latest.id).toBe('b')
  })

  it('不同天不合併', () => {
    expect(ids(groupVersions([v('a', 'KK', 25, 23), v('b', 'KK', 26, 1)]))).toEqual([['b'], ['a']])
  })

  it('中間有別人改過就不合併（A、B、A 是三筆）', () => {
    expect(ids(groupVersions([v('a', 'KK', 26, 8), v('b', 'Jin', 26, 9), v('c', 'KK', 26, 10)]))).toEqual([['c'], ['b'], ['a']])
  })

  it('輸出新到舊；沒有版本時是空的', () => {
    expect(ids(groupVersions([v('a', 'KK', 24, 8), v('b', 'Jin', 25, 8), v('c', 'Jin', 25, 9)]))).toEqual([['b', 'c'], ['a']])
    expect(groupVersions([])).toEqual([])
  })
})
