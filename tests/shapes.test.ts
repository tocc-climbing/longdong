import { describe, expect, it } from 'vitest'
import { withShapes, type ScaleMapData } from '../src/map/mapData'
import { decodeMapEdits, encodeShapes, isOpenTarget, sectorOf, simplifyRing, wallLabelAt, wallTarget } from '../src/map/shapes'

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

  it('岩壁：分區的最新版本（線段，可以清空）', () => {
    const target = wallTarget('longdong/school-gate-a1151r')
    expect(target).toBe('wall:longdong:school-gate-a1151r')
    expect(sectorOf(target)).toBe('longdong/school-gate-a1151r')
    expect(isOpenTarget(target)).toBe(true)
    const shapes = decodeMapEdits({ [target]: { a: { uid: 'a', createdAt: 1, lines: encodeShapes([RING.slice(0, 2), OTHER.slice(0, 2)]) } } })
    expect(shapes.walls['longdong/school-gate-a1151r']).toEqual([RING.slice(0, 2), OTHER.slice(0, 2)])
    const cleared = decodeMapEdits({ [target]: { a: { uid: 'a', createdAt: 1, lines: encodeShapes([RING.slice(0, 2)]) }, b: { uid: 'b', createdAt: 2, lines: '' } } })
    expect(cleared.walls['longdong/school-gate-a1151r']).toEqual([])
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

describe('分區名稱的位置', () => {
  it('最長的一段岩壁沿線走到一半的那一點（不是端點的平均）', () => {
    // L 形：往東 0.002 度、再往北 0.0002 度；一半在第一段上
    const wall: [number, number][] = [[25.11, 121.92], [25.11, 121.922], [25.1102, 121.922]]
    const short: [number, number][] = [[25.1, 121.9], [25.1, 121.9001]]
    const [lat, lng] = wallLabelAt([short, wall])!
    expect(lat).toBeCloseTo(25.11, 9)
    expect(lng).toBeGreaterThan(121.9205)
    expect(lng).toBeLessThan(121.9215)
  })

  it('沒有岩壁時沒有位置', () => {
    expect(wallLabelAt([])).toBeUndefined()
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
    lineLayers: { trail: [[[0, 0], [1, 1]]], highway: [], tunnel: [], road: [[[0, 0], [2, 2]]] },
    names: [],
  }

  it('有版本的大區域、步道換成新的，沒有的（其他道路）不變', () => {
    const out = withShapes(base, decodeMapEdits({
      'area:school-gate': { a: { uid: 'a', createdAt: 1, rings: encodeShapes([RING]) } },
      trails: { a: { uid: 'a', createdAt: 1, lines: encodeShapes([RING]) } },
    }))
    expect(out.areas[0].rings[0]).toHaveLength(3)
    expect(out.areas[1]).toBe(base.areas[1])
    expect(out.lineLayers.trail[0]).toHaveLength(3)
    expect(out.layers.trail).not.toBe(base.layers.trail)
    expect(out.layers.road).toBe(base.layers.road)
    expect(out.lineLayers.road).toBe(base.lineLayers.road)
  })

  it('草稿把大區域刪光時，這個區域不畫（不留下舊的形狀），其他區域不受影響', () => {
    const out = withShapes(base, { ...decodeMapEdits(null), areas: { 'school-gate': [] } })
    expect(out.areas.map((a) => a.id)).toEqual(['clocktower'])
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
