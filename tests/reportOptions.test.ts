import { describe, expect, it } from 'vitest'
import { MAX_OPTIONS, innermost, insideRing, reportOptions, ringArea, ringDistance } from '../src/map/reportOptions'
import type { RescuePoint } from '../src/data/rescue'
import { project } from '../src/map/mapData'

const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]
const area = (id: string, dx: number) => ({ id, path: '', label: [dx + 50, 50] as [number, number], size: 1e4, rings: [square.map(([x, y]) => [x + dx, y] as [number, number])] })

describe('回報位置的選項', () => {
  it('點在多邊形內距離為 0；在外面是到邊界的距離', () => {
    expect(insideRing([50, 50], square)).toBe(true)
    expect(insideRing([150, 50], square)).toBe(false)
    expect(ringDistance([50, 50], square)).toBe(0)
    expect(ringDistance([130, 50], square)).toBe(30)
  })

  it('套疊的多邊形：點在小塊裡取小塊，不管先後順序', () => {
    const small: [number, number][] = [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]
    expect(ringArea(square)).toBe(1e4)
    expect(innermost([50, 50], [square, small], (r) => [r])).toBe(small)
    expect(innermost([50, 50], [small, square], (r) => [r])).toBe(small)
    expect(innermost([10, 10], [small, square], (r) => [r])).toBe(square)
    expect(innermost([150, 10], [small, square], (r) => [r])).toBeUndefined()
  })

  it('在區域內排第一，附近的救援點、標示、區域依距離排序；太遠的不列', () => {
    // 救援點在投影原點 (0, 0)；目前位置在它南方 10 公尺，落在 clocktower（x -50～50、y 0～100）裡
    const point: RescuePoint = { key: '4', no: 4, name: { zh: '鐘塔' }, coords: [25.107, 121.92] }
    expect(project(point.coords!)).toEqual([0, 0])
    const map = {
      areas: [area('clocktower', -50), area('long-lane', 60), area('far', 500)],
      markers: [{ kind: 'parking' as const, at: [20, 0] as [number, number] }],
    }
    const options = reportOptions([0, 10], map, [point])
    expect(options.map((o) => o.kind + (o.kind === 'area' ? `:${o.id}` : ''))).toEqual(['area:clocktower', 'rescue', 'marker', 'area:long-lane'])
    expect(options[0]).toMatchObject({ inside: true, distance: 0 })
    expect(options[3]).toMatchObject({ inside: false, distance: 60 })
  })

  it(`最多列 ${MAX_OPTIONS} 個`, () => {
    const map = { areas: Array.from({ length: 10 }, (_, i) => area(`a${i}`, i)), markers: [] }
    expect(reportOptions([50, 50], map, [])).toHaveLength(MAX_OPTIONS)
  })
})
