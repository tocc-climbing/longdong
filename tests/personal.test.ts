import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { bestStyle, daysAgo, mergeRecords, NOTE_MAX, sentRouteIds, today, type Tick } from '../src/personal/model'
import { addTick, applyRecords, clearAll, deleteTick, exportAll, setBest, setFavorite } from '../src/personal/store'

const tick = (id: string, updatedAt: string, over: Partial<Tick> = {}): Tick => ({
  id, routeId: 'longdong/328ac2', date: '2026-10-01', style: 'redpoint', createdAt: '2026-10-01T00:00:00Z', updatedAt, ...over,
})

describe('mergeRecords', () => {
  it('同一筆取較新者，刪除標記也會蓋過舊資料', () => {
    const current = [tick('a', '2026-10-01T00:00:00Z'), tick('b', '2026-10-05T00:00:00Z')]
    const incoming = [
      tick('a', '2026-10-03T00:00:00Z', { deleted: true }),
      tick('b', '2026-10-02T00:00:00Z', { note: '舊的' }),
      tick('c', '2026-10-04T00:00:00Z'),
    ]
    const { merged, changed } = mergeRecords(current, incoming, (t) => t.id)
    expect(changed.map((t) => t.id)).toEqual(['a', 'c'])
    expect(merged.find((t) => t.id === 'a')?.deleted).toBe(true)
    expect(merged.find((t) => t.id === 'b')?.note).toBeUndefined()
  })
})

describe('store（IndexedDB）', () => {
  it('收藏、紀錄、刪除，舊資料不會蓋掉較新的刪除', async () => {
    await setFavorite('longdong/328ac2', true)
    await addTick({ routeId: 'longdong/328ac2', date: today(), style: 'onsight' })
    await addTick({ routeId: 'longdong/q3ek73', date: '2026-01-02', style: 'attempt', note: '第三 bolt 卡關' })

    const snapshot = await exportAll()
    expect(snapshot.favorites.map((f) => f.routeId)).toEqual(['longdong/328ac2'])
    expect(snapshot.ticks).toHaveLength(2)

    const removed = snapshot.ticks.find((t) => t.routeId === 'longdong/q3ek73')!
    await deleteTick(removed.id)
    await setFavorite('longdong/328ac2', false)

    // 例如另一台裝置送來較舊的版本
    expect(await applyRecords(snapshot.favorites, snapshot.ticks)).toEqual({ favorites: 0, ticks: 0, best: 0 })
    const after = await exportAll()
    expect(after.ticks.find((t) => t.id === removed.id)?.deleted).toBe(true)
    expect(after.favorites[0].deleted).toBe(true)

    await clearAll()
    expect(await exportAll()).toMatchObject({ favorites: [], ticks: [], best: [] })
  })

  it('路線清單的最佳攀登方式：每條路線一筆，改了就覆蓋，清除時留刪除標記', async () => {
    await setBest('longdong/aaaaaa', 'redpoint')
    await setBest('longdong/aaaaaa', 'onsight')
    await setBest('longdong/bbbbbb', 'toprope')
    await setBest('longdong/bbbbbb', null)
    const { best } = await exportAll()
    expect(best).toHaveLength(2)
    expect(best!.find((b) => b.routeId === 'longdong/aaaaaa')).toMatchObject({ style: 'onsight' })
    expect(best!.find((b) => b.routeId === 'longdong/bbbbbb')?.deleted).toBe(true)

    // 較舊的版本（例如另一台裝置）不會蓋掉清除
    const older = { ...best!.find((b) => b.routeId === 'longdong/bbbbbb')!, deleted: false, updatedAt: '2000-01-01T00:00:00Z' }
    expect((await applyRecords([], [], [older])).best).toBe(0)
    await clearAll()
  })

  it('備註超過上限（資料庫規則會拒絕）時不寫入本機', async () => {
    await expect(addTick({ routeId: 'longdong/328ac2', date: '2026-10-01', style: 'redpoint', note: 'x'.repeat(NOTE_MAX + 1) })).rejects.toThrow()
    await addTick({ routeId: 'longdong/328ac2', date: '2026-10-01', style: 'redpoint', note: 'x'.repeat(NOTE_MAX) })
    const { ticks } = await exportAll()
    expect(ticks.map((t) => t.note?.length)).toEqual([NOTE_MAX])
    await clearAll()
  })

  it('刪除標記不留備註：本機留有超過上限備註的舊紀錄也能刪除並同步', async () => {
    // 加上上限之前存下的紀錄
    await applyRecords([], [tick('old', '2026-10-01T00:00:00Z', { note: 'x'.repeat(NOTE_MAX + 1) })])
    await deleteTick('old')
    const { ticks } = await exportAll()
    expect(ticks).toEqual([
      { id: 'old', routeId: 'longdong/328ac2', date: '2026-10-01', style: 'redpoint', createdAt: '2026-10-01T00:00:00Z', updatedAt: expect.any(String), deleted: true },
    ])
    await clearAll()
  })
})

describe('最佳攀登方式', () => {
  it('幾種方式中取最好的：OS > FL > RP > TR、跟攀 > 嘗試', () => {
    expect(bestStyle(['redpoint', 'onsight', 'flash'])).toBe('onsight')
    expect(bestStyle(['attempt', 'toprope'])).toBe('toprope')
    expect(bestStyle([])).toBeUndefined()
  })

  it('完攀過的路線：攀登紀錄（嘗試不算）加上路線清單勾選的', () => {
    const ticks = [tick('t1', 'x', { routeId: 'a' }), tick('t2', 'x', { routeId: 'b', style: 'attempt' })]
    expect([...sentRouteIds(ticks, new Map([['c', 'flash']]))].sort()).toEqual(['a', 'c'])
  })
})

describe('daysAgo', () => {
  it('用日曆往前推：跨月、跨年、閏日', () => {
    expect(daysAgo(0, new Date(2026, 9, 25))).toBe('2026-10-25')
    expect(daysAgo(1, new Date(2026, 9, 25))).toBe('2026-10-24')
    expect(daysAgo(1, new Date(2026, 10, 1))).toBe('2026-10-31')
    expect(daysAgo(1, new Date(2027, 0, 1))).toBe('2026-12-31')
    expect(daysAgo(1, new Date(2028, 2, 1))).toBe('2028-02-29')
  })

  it('不改動傳入的時間', () => {
    const now = new Date(2026, 9, 25, 13, 30)
    daysAgo(3, now)
    expect(now.getDate()).toBe(25)
  })
})
