import { describe, expect, it } from 'vitest'
import { feelConsensus, nameKey, normalizeName, routeKey, summarize, type Rating } from '../src/social/model'

const r = (stars: number, feel?: Rating['feel']): Rating => ({ stars, feel, updatedAt: 'x' })

describe('summarize', () => {
  it('平均、各星等人數、體感統計', () => {
    const s = summarize({ a: r(5, 'hard'), b: r(4, 'hard'), c: r(3, 'fair'), d: r(4) })!
    expect(s.count).toBe(4)
    expect(s.average).toBe(4)
    expect(s.stars).toEqual([0, 0, 1, 2, 1])
    expect(s.feel).toEqual({ soft: 0, fair: 1, hard: 2 })
  })

  it('沒有評分時回傳 undefined，忽略不合法的星等', () => {
    expect(summarize(undefined)).toBeUndefined()
    expect(summarize({ a: r(0), b: r(6) })).toBeUndefined()
  })
})

describe('feelConsensus', () => {
  it('至少 3 人回答且過半才顯示', () => {
    expect(feelConsensus(summarize({ a: r(4, 'hard'), b: r(4, 'hard') }))).toBeUndefined()
    expect(feelConsensus(summarize({ a: r(4, 'hard'), b: r(4, 'hard'), c: r(4, 'soft') }))).toBe('hard')
    expect(feelConsensus(summarize({ a: r(4, 'hard'), b: r(4, 'soft'), c: r(4, 'fair') }))).toBeUndefined()
  })
})

describe('routeKey', () => {
  it('轉成 Realtime Database 可用的 key', () => {
    expect(routeKey('longdong/328ac2')).toBe('longdong:328ac2')
    expect(routeKey('longdong/100.1')).toBe('longdong:100,1')
  })
})

describe('暱稱的標準寫法與比對 key', () => {
  it('看起來一樣的寫法都整理成同一個', () => {
    expect(normalizeName('Kant Kang ')).toBe('Kant Kang')
    expect(normalizeName('  Kant   Kang')).toBe('Kant Kang')
    expect(normalizeName('Kant　Kang')).toBe('Kant Kang') // 全形空白
    expect(normalizeName('Kant Kang')).toBe('Kant Kang') // 不換行空白
    expect(normalizeName('Kant​Kang')).toBe('KantKang') // 零寬空白
    expect(normalizeName('Ｋａｎｔ　１２３')).toBe('Kant 123') // 全形英數字
    expect(normalizeName('岩友 小明')).toBe('岩友 小明')
  })

  it('不分大小寫；資料庫 key 不能用的字元轉成 %XX', () => {
    expect(nameKey('Kant Kang')).toBe(nameKey('kant kang'))
    expect(nameKey('a.b$c#d[e]f/g%h')).toBe('a%2Eb%24c%23d%5Be%5Df%2Fg%25h')
  })
})
