import { describe, expect, it } from 'vitest'
import { RESCUE_POINTS } from '../src/data/rescue'
import { NEAR_CRAG_M, bearingDeg, direction, distanceM, nearestPoints, whereabouts } from '../src/geo'

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

describe('是否在龍洞岩場附近', () => {
  const nearest = (lat: number, lng: number) => nearestPoints([lat, lng], RESCUE_POINTS, 1)[0].distance
  it('岩場、龍洞村、步道入口都在範圍內', () => {
    expect(nearest(25.1067, 121.922483)).toBeLessThan(NEAR_CRAG_M) // 黃金谷
    expect(nearest(25.1105, 121.9135)).toBeLessThan(NEAR_CRAG_M) // 龍洞村（安檢所西南方約 220 公尺）
  })

  it('台北、福隆都不在範圍內', () => {
    expect(nearest(25.033, 121.5654)).toBeGreaterThan(NEAR_CRAG_M)
    expect(nearest(25.0163, 121.9446)).toBeGreaterThan(NEAR_CRAG_M)
  })
})

describe('救援頁依位置顯示', () => {
  it('在黃金谷：通報地點是 #10 黃金谷，最近的急救器材是 #5 黃金谷中央區小木屋', () => {
    const w = whereabouts([25.1067, 121.922483])
    expect(w.kind).toBe('crag')
    if (w.kind !== 'crag') return
    expect(w.point.point.no).toBe(10)
    expect(w.ems.point.no).toBe(5)
    expect(w.ems.distance).toBeLessThan(20)
  })

  it('在校門口：最近的急救器材是 #1 校門口，不是救援點同區的其他器材', () => {
    const w = whereabouts([25.1129, 121.921617])
    expect(w.kind === 'crag' && [w.point.point.no, w.ems.point.no]).toEqual([3, 1])
  })

  it('急救器材以自己的位置找最近的，不是以最近的救援點找（音樂廳南側：救援點 #7，器材 #4 第一洞比 #3 長巷近）', () => {
    const w = whereabouts([25.1098, 121.9226])
    expect(w.kind === 'crag' && [w.point.point.no, w.ems.point.no]).toEqual([7, 4])
  })

  it('在台北：不在岩場附近，只給離最近救援點的距離', () => {
    const w = whereabouts([25.033, 121.5654])
    expect(w.kind).toBe('outside')
    expect(w.kind === 'outside' && w.distance).toBeGreaterThan(30_000)
  })
})
