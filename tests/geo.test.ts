import { describe, expect, it } from 'vitest'
import { RESCUE_POINTS } from '../src/data/rescue'
import { bearingDeg, direction, distanceM, nearestPoints } from '../src/geo'

describe('距離與方位', () => {
  it('距離：緯度差 0.001 度約 111 公尺；同一點為 0', () => {
    expect(distanceM([25.1, 121.92], [25.101, 121.92])).toBeCloseTo(111.2, 0)
    expect(distanceM([25.1, 121.92], [25.1, 121.92])).toBe(0)
  })

  it('方位角：正北 0、正東約 90、正南 180、正西約 270', () => {
    expect(bearingDeg([25.1, 121.92], [25.11, 121.92])).toBeCloseTo(0, 1)
    expect(bearingDeg([25.1, 121.92], [25.1, 121.93])).toBeCloseTo(90, 0)
    expect(bearingDeg([25.1, 121.92], [25.09, 121.92])).toBeCloseTo(180, 1)
    expect(bearingDeg([25.1, 121.92], [25.1, 121.91])).toBeCloseTo(270, 0)
  })

  it('八個方位，北方跨 0 度', () => {
    expect(direction(0)).toBe('n')
    expect(direction(350)).toBe('n')
    expect(direction(22)).toBe('n')
    expect(direction(23)).toBe('ne')
    expect(direction(135)).toBe('se')
    expect(direction(250)).toBe('w')
  })
})

describe('最近的救援點', () => {
  it('站在 #10 黃金谷：最近的是它自己，接著是 #11 鱷魚岬（約 140 公尺）、#14 停車場（約 173 公尺）', () => {
    const near = nearestPoints([25.1067, 121.922483], RESCUE_POINTS, 3)
    expect(near.map((n) => n.point.no)).toEqual([10, 11, 14])
    expect(near[0].distance).toBe(0)
    expect(near[1].distance).toBeCloseTo(140, -1)
    // #11 鱷魚岬在黃金谷的東南（方位角約 153 度）
    expect(near[1].direction).toBe('se')
    expect(near[2].distance).toBeCloseTo(173, -1)
  })

  it('沒有座標的救援點不列入', () => {
    const near = nearestPoints([25.108, 121.9225], RESCUE_POINTS, 20)
    expect(near.every((n) => n.point.coords)).toBe(true)
    expect(near.map((n) => n.point.no)).not.toContain(9)
    expect(near.map((n) => n.point.no)).not.toContain(13)
  })
})
