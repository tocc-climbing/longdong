import { describe, expect, it } from 'vitest'
import { withShapes, type ScaleMapData } from '../src/map/mapData'
import { decodeMapEdits, encodeShapes, sectorTarget, simplifyRing } from '../src/map/shapes'

const RING: [number, number][] = [
  [25.11272, 121.92145],
  [25.11271, 121.9216],
  [25.1126, 121.9215],
]
const OTHER: [number, number][] = [
  [25.11, 121.92],
  [25.111, 121.921],
  [25.112, 121.92],
]

describe('地圖編輯的版本', () => {
  it('每個對象取最新的版本（依建立時間）；所有版本舊到新保留', () => {
    const shapes = decodeMapEdits({
      'area:school-gate': {
        b: { uid: 'bob', createdAt: 2, rings: encodeShapes([OTHER]) },
        a: { uid: 'alice', createdAt: 1, rings: encodeShapes([RING, RING]) },
      },
    })
    expect(shapes.areas['school-gate']).toEqual([OTHER])
    expect(shapes.versions['area:school-gate'].map((v) => v.uid)).toEqual(['alice', 'bob'])
  })

  it('分區：最新版本的每一塊各一筆；最新版本是空的表示沒有範圍', () => {
    const target = sectorTarget('longdong/school-gate-a1151r')
    expect(target).toBe('sector:longdong:school-gate-a1151r')
    const two = decodeMapEdits({ [target]: { a: { uid: 'a', createdAt: 1, rings: encodeShapes([RING, OTHER]) } } })
    expect(two.sectors.map((s) => s.sector)).toEqual(['longdong/school-gate-a1151r', 'longdong/school-gate-a1151r'])
    const cleared = decodeMapEdits({ [target]: { a: { uid: 'a', createdAt: 1, rings: encodeShapes([RING]) }, b: { uid: 'b', createdAt: 2, rings: '' } } })
    expect(cleared.sectors).toEqual([])
  })

  it('步道與道路：有版本時用最新的線段，沒有的不在裡面（用自動產生的）', () => {
    const shapes = decodeMapEdits({
      trails: { a: { uid: 'a', createdAt: 1, lines: encodeShapes([RING.slice(0, 2)]) } },
      road: { a: { uid: 'a', createdAt: 1, lines: encodeShapes([OTHER.slice(0, 2)]) } },
    })
    expect(shapes.lines.trails).toEqual([RING.slice(0, 2)])
    expect(shapes.lines.road).toEqual([OTHER.slice(0, 2)])
    expect(shapes.lines.highway).toBeUndefined()
    expect(decodeMapEdits(null).lines).toEqual({})
  })
})

describe('簡化自動產生的形狀', () => {
  it('邊上多餘的點去掉，轉角留下（封閉多邊形不重複終點）', () => {
    // 10×10 公尺的正方形，每邊中間多一個點，最後重複起點
    const square: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5], [0, 0]]
    expect(simplifyRing(square, 1)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
  })
})

describe('套上編輯的最新版本', () => {
  const base: ScaleMapData = {
    layers: { trail: 'M0 0L1 1', road: 'M0 0L2 2' },
    markers: [],
    areas: [{ id: 'school-gate', path: 'M0 0Z', label: [0, 0], size: 1, rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, { id: 'clocktower', path: 'M0 0Z', label: [0, 0], size: 1, rings: [] }],
    sectors: [],
    lineLayers: { trail: [[[0, 0], [1, 1]]], highway: [], tunnel: [], road: [[[0, 0], [2, 2]]] },
  }

  it('有版本的大區域、步道換成新的，沒有的（其他道路）不變；加上分區範圍', () => {
    const out = withShapes(base, decodeMapEdits({
      'area:school-gate': { a: { uid: 'a', createdAt: 1, rings: encodeShapes([RING]) } },
      [sectorTarget('longdong/x')]: { a: { uid: 'a', createdAt: 1, rings: encodeShapes([RING]) } },
      trails: { a: { uid: 'a', createdAt: 1, lines: encodeShapes([RING]) } },
    }))
    expect(out.areas[0].rings[0]).toHaveLength(3)
    expect(out.areas[1]).toBe(base.areas[1])
    expect(out.sectors.map((s) => s.sector)).toEqual(['longdong/x'])
    expect(out.lineLayers.trail[0]).toHaveLength(3)
    expect(out.layers.trail).not.toBe(base.layers.trail)
    expect(out.layers.road).toBe(base.layers.road)
    expect(out.lineLayers.road).toBe(base.lineLayers.road)
  })

  it('沒有任何版本時與自動產生的相同', () => {
    const out = withShapes(base, decodeMapEdits(null))
    expect(out.layers).toBe(base.layers)
    expect(out.lineLayers).toBe(base.lineLayers)
  })
})

describe('提交前整理（合併多餘的點）', () => {
  it('幾乎在一條直線上、靠得很近的點刪掉；轉角留下', async () => {
    const { tidyShapes } = await import('../src/edit/useMapItem')
    // 一條往東 30 公尺再往北的線：中間夾著幾乎共線（偏 0.1 公尺）與重複的點
    const line: [number, number][] = [
      [25.11, 121.92],
      [25.110001, 121.9201],
      [25.110001, 121.920101],
      [25.11, 121.9203],
      [25.1103, 121.9203],
    ]
    const [out] = tidyShapes([line], false)
    expect(out).toEqual([line[0], line[3], line[4]])
  })

  it('整理後點數不夠（例如很小的三角形）就保留原樣', async () => {
    const { tidyShapes } = await import('../src/edit/useMapItem')
    const tiny: [number, number][] = [
      [25.11, 121.92],
      [25.110001, 121.920001],
      [25.110002, 121.92],
    ]
    expect(tidyShapes([tiny], true)[0]).toEqual(tiny)
  })
})
