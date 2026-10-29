import { describe, expect, it } from 'vitest'
import { decodeLine, encodeLine } from '../src/map/walls'

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

})
