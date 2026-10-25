import { describe, expect, it } from 'vitest'
import { withShapes, type ScaleMapData } from '../src/map/mapData'
import { decodeShapes, encodeRings, simplifyRing } from '../src/map/shapes'

const RING: [number, number][] = [
  [25.11272, 121.92145],
  [25.11271, 121.9216],
  [25.1126, 121.9215],
]

describe('地圖多邊形的儲存格式', () => {
  it('多塊以「|」分隔，解碼後還原（小數 6 位）', () => {
    const raw = { areas: { 'school-gate': { rings: encodeRings([RING, RING]) } }, sectors: { s1: { sector: 'longdong/x', ring: encodeRings([RING]) } } }
    const shapes = decodeShapes(raw)
    expect(shapes.areas['school-gate']).toEqual([RING, RING])
    expect(shapes.sectors).toEqual([{ id: 's1', sector: 'longdong/x', ring: RING }])
    expect(decodeShapes(null)).toEqual({ areas: {}, sectors: [] })
  })
})

describe('簡化自動產生的形狀', () => {
  it('邊上多餘的點去掉，轉角留下（封閉多邊形不重複終點）', () => {
    // 10×10 公尺的正方形，每邊中間多一個點，最後重複起點
    const square: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5], [0, 0]]
    expect(simplifyRing(square, 1)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
  })
})

describe('套上管理員調整的多邊形', () => {
  const base: ScaleMapData = {
    layers: {},
    markers: [],
    areas: [{ id: 'school-gate', path: 'M0 0Z', label: [0, 0], size: 1, rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, { id: 'clocktower', path: 'M0 0Z', label: [0, 0], size: 1, rings: [] }],
    sectors: [],
  }

  it('有調整的大區域換成新的形狀，沒調整的不變；加上分區範圍', () => {
    const out = withShapes(base, { areas: { 'school-gate': [RING] }, sectors: [{ id: 's1', sector: 'longdong/x', ring: RING }] })
    expect(out.areas[0].rings[0]).toHaveLength(3)
    expect(out.areas[0].size).toBeGreaterThan(0)
    expect(out.areas[1]).toBe(base.areas[1])
    expect(out.sectors.map((s) => [s.id, s.sector])).toEqual([['s1', 'longdong/x']])
  })
})
