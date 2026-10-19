import { describe, expect, it } from 'vitest'
import type { Best, Favorite, Tick } from '../src/personal/model'
import { favoriteKey, reconcile } from '../src/personal/reconcile'

const fav = (routeId: string, updatedAt: string, deleted?: boolean): Favorite => ({
  routeId, createdAt: '2026-01-01T00:00:00Z', updatedAt, ...(deleted ? { deleted } : {}),
})
const tick = (id: string, updatedAt: string, over: Partial<Tick> = {}): Tick => ({
  id, routeId: 'longdong/328ac2', date: '2026-10-01', style: 'redpoint', createdAt: '2026-10-01T00:00:00Z', updatedAt, ...over,
})

describe('reconcile', () => {
  it('第一次登入：本機紀錄全部上傳', () => {
    const { toLocal, toRemote } = reconcile('u1', { favorites: [fav('longdong/328ac2', 'a')], ticks: [tick('t1', 'a')] }, null)
    expect(toLocal).toEqual({ favorites: [], ticks: [], best: [] })
    expect(Object.keys(toRemote).sort()).toEqual(['v2/personal/u1/favorites/longdong:328ac2', 'v2/personal/u1/ticks/t1'])
  })

  it('新裝置登入：雲端紀錄全部下載', () => {
    const remote = { favorites: { 'longdong:328ac2': fav('longdong/328ac2', 'a') }, ticks: { t1: tick('t1', 'a') } }
    const { toLocal, toRemote } = reconcile('u1', { favorites: [], ticks: [] }, remote)
    expect(toLocal.favorites).toHaveLength(1)
    expect(toLocal.ticks).toHaveLength(1)
    expect(toRemote).toEqual({})
  })

  it('兩邊都有改：各取較新的，刪除也會同步', () => {
    const local = { favorites: [fav('longdong/aaaaaa', '2026-10-05', true)], ticks: [tick('t1', '2026-10-01'), tick('t2', '2026-10-09')] }
    const remote = {
      favorites: { 'longdong:aaaaaa': fav('longdong/aaaaaa', '2026-10-02') },
      ticks: { t1: tick('t1', '2026-10-03', { note: '別台裝置改的' }), t2: tick('t2', '2026-10-08') },
    }
    const { toLocal, toRemote } = reconcile('u1', local, remote)
    expect(toLocal.ticks.map((t) => t.note)).toEqual(['別台裝置改的'])
    expect(toLocal.favorites).toEqual([])
    expect(Object.keys(toRemote).sort()).toEqual(['v2/personal/u1/favorites/longdong:aaaaaa', 'v2/personal/u1/ticks/t2'])
    expect((toRemote['v2/personal/u1/favorites/longdong:aaaaaa'] as Favorite).deleted).toBe(true)
  })

  it('已經一致時不做任何事（避免同步迴圈）', () => {
    const local = { favorites: [fav('longdong/aaaaaa', 'a')], ticks: [tick('t1', 'a')] }
    const remote = { favorites: { 'longdong:aaaaaa': fav('longdong/aaaaaa', 'a') }, ticks: { t1: tick('t1', 'a') } }
    expect(reconcile('u1', local, remote)).toEqual({ toLocal: { favorites: [], ticks: [], best: [] }, toRemote: {} })
  })

  it('路線清單的最佳攀登方式：以路線 key 存放，各取較新的', () => {
    const best = (routeId: string, style: Best['style'], updatedAt: string): Best => ({ routeId, style, createdAt: 'a', updatedAt })
    const local = { favorites: [], ticks: [], best: [best('longdong/aaaaaa', 'onsight', '2026-10-05'), best('longdong/bbbbbb', 'redpoint', '2026-10-01')] }
    const remote = { best: { 'longdong:bbbbbb': best('longdong/bbbbbb', 'flash', '2026-10-03') } }
    const { toLocal, toRemote } = reconcile('u1', local, remote)
    expect(toLocal.best.map((b) => b.style)).toEqual(['flash'])
    expect(Object.keys(toRemote)).toEqual(['v2/personal/u1/best/longdong:aaaaaa'])
  })

  it('寫入雲端的資料不含 undefined', () => {
    const { toRemote } = reconcile('u1', { favorites: [], ticks: [tick('t1', 'a', { note: undefined })] }, null)
    expect('note' in (toRemote['v2/personal/u1/ticks/t1'] as object)).toBe(false)
  })

  it('路線 ID 轉成合法的 key', () => {
    expect(favoriteKey('longdong/100.1')).toBe('longdong:100,1')
  })
})
