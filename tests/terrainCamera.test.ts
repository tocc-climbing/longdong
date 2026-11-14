import { describe, expect, it } from 'vitest'
import { normalizeBearing, reorientTerrainBox, terrainGround, touchRotation } from '../src/map/terrainCamera'
import { elevation, terrainGridBounds, terrainPoint, terrainView, type Terrain } from '../src/map/terrain'
import { terrainOrthoOverview, terrainOrthoPlan, terrainOrthoUV } from '../src/map/terrainOrtho'
import { readFileSync } from 'node:fs'

describe('3D 地圖朝向', () => {
  // 突變：反投影忘記旋轉、高程或傾角，轉動後錨點便會漂移。
  it('各朝向與傾角都能反投影回同一個位置', () => {
    for (const bearing of [-170, -90, 0, 45, 179]) for (const pitch of [0, 30, 60]) {
      const p: [number, number] = [340, -650]
      const back = terrainGround(terrainView(p, 73, bearing, pitch), 73, bearing, pitch)
      expect(back[0]).toBeCloseTo(p[0]); expect(back[1]).toBeCloseTo(p[1])
    }
  })
  it('旋轉與調整傾角保留手勢錨點及比例', () => {
    const box: [number, number, number, number] = [-200, -500, 600, 800]
    const anchor: [number, number] = [0.3, 0.7]
    const before = terrainGround([box[0]+600*anchor[0], box[1]+800*anchor[1]], 45, 20, 30)
    const next = reorientTerrainBox(box, 45, { bearing: 20, pitch: 30 }, { bearing: 85, pitch: 60 }, anchor)
    const after = terrainGround([next[0]+600*anchor[0], next[1]+800*anchor[1]], 45, 85, 60)
    expect(next.slice(2)).toEqual([600, 800])
    expect(after[0]).toBeCloseTo(before[0]); expect(after[1]).toBeCloseTo(before[1])
  })
  it('雙指轉角跨過正負 180 度時不跳整圈', () => {
    const pair = (a: number): [number, number][] => [[0, 0], [Math.cos(a*Math.PI/180), Math.sin(a*Math.PI/180)]]
    expect(touchRotation(pair(179), pair(-179))).toBeCloseTo(2)
    expect(touchRotation(pair(-179), pair(179))).toBeCloseTo(-2)
    expect(normalizeBearing(375)).toBe(15)
  })
  it('旋轉後的航照範圍涵蓋實際可見的地面格網', () => {
    // 突變：航照仍依北向上的視窗取圖，旋轉後會缺少左右兩側圖磚。
    const t = JSON.parse(readFileSync('public/rescue/terrain-map-20m.json', 'utf8')) as Terrain
    const center = terrainView([300, -300], elevation(t, [300, -300])!, 90, 30)
    const box: [number, number, number, number] = [center[0]-50, center[1]-250, 100, 500]
    const plan = terrainOrthoPlan(t, box, 390, 2, 8, 30, 90)
    const bounds = terrainGridBounds(t, 90, box, 1, 30)
    for (const c of [bounds.firstCol, bounds.lastCol+1]) for (const r of [bounds.firstRow, bounds.lastRow+1]) {
      const uv = terrainOrthoUV(terrainPoint(t, c, r), plan)
      expect(uv.every((n) => n >= 0 && n <= 1)).toBe(true)
    }
    const full = terrainOrthoOverview(t, 30, 90)
    for (const c of [0, t.columns-1]) for (const r of [0, t.rows-1]) {
      const p = terrainView(terrainPoint(t, c, r), 0, 90, 30)
      expect(p[0]).toBeGreaterThanOrEqual(full[0]); expect(p[0]).toBeLessThanOrEqual(full[0]+full[2])
      expect(p[1]).toBeGreaterThanOrEqual(full[1]); expect(p[1]).toBeLessThanOrEqual(full[1]+full[3])
    }
  })
})
