import { describe, expect, it } from 'vitest'
import { decodeLine, decodeWalls, encodeLine } from '../src/map/walls'

describe('岩壁標記的座標', () => {
  it('「緯度,經度」以空格分隔、小數 6 位（資料庫規則要求的格式）', () => {
    expect(encodeLine([[25.1127198, 121.9214567], [25.11271, 121.9216]])).toBe('25.112720,121.921457 25.112710,121.921600')
  })

  it('解碼是編碼的反函數（到小數 6 位）', () => {
    expect(decodeLine(encodeLine([[25.11272, 121.92145], [25.11271, 121.9216]]))).toEqual([
      [25.11272, 121.92145],
      [25.11271, 121.9216],
    ])
  })

  it('所有人的岩壁攤平成一份，依建立時間由舊到新，帶著畫的人', () => {
    const raw = {
      bob: { w2: { sector: 'longdong/b', line: '25.1,121.9 25.2,121.9', createdAt: 2 } },
      alice: { w1: { sector: 'longdong/a', line: '25.1,121.9 25.2,121.9', createdAt: 1 } },
    }
    expect(decodeWalls(raw).map((w) => [w.id, w.uid, w.sector])).toEqual([
      ['w1', 'alice', 'longdong/a'],
      ['w2', 'bob', 'longdong/b'],
    ])
    expect(decodeWalls(null)).toEqual([])
  })
})
