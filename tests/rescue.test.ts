import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset } from '../src/data/schema'
import { AREA_RESCUE, EMS_LOCATIONS, RESCUE_POINTS, formatCoords, rescueKey } from '../src/data/rescue'
import { parseLocation } from '../src/router'

const dataset = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset

describe('救援資訊', () => {
  it('每個大區域都有救援資訊與地圖上的區域形狀，沒有多出來的', () => {
    const keys = dataset.areas.map((a) => rescueKey(a.id))
    expect(keys).not.toContain(undefined)
    expect(new Set(keys)).toEqual(new Set(Object.keys(AREA_RESCUE)))
    const shapes = (JSON.parse(readFileSync('public/rescue/areas.geojson', 'utf8')) as { features: { properties: { id: string } }[] }).features
    expect(new Set(shapes.map((f) => f.properties.id))).toEqual(new Set(Object.keys(AREA_RESCUE)))
  })

  it('各區引用的救援點與急救器材都存在', () => {
    const points = new Set(RESCUE_POINTS.map((p) => p.no))
    const ems = new Set(EMS_LOCATIONS.map((e) => e.no))
    for (const { points: ps, ems: e } of Object.values(AREA_RESCUE)) {
      for (const p of ps) expect(points).toContain(p)
      expect(ems).toContain(e)
    }
  })

  it('15 個救援點、6 處急救器材', () => {
    expect(new Set(RESCUE_POINTS.map((p) => p.no)).size).toBe(15)
    expect(EMS_LOCATIONS.map((e) => e.no)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('#12 的兩個救援點（地下二樓、地下一樓）key 不同、各有自己的座標', () => {
    expect(new Set(RESCUE_POINTS.map((p) => p.key)).size).toBe(RESCUE_POINTS.length)
    const [b2, b1] = RESCUE_POINTS.filter((p) => p.no === 12)
    expect(b2.coords).toEqual([25.104733, 121.922833])
    expect(b1.coords).toEqual([25.103783, 121.922933])
  })

  it('救援點與急救器材的座標都在龍洞一帶，且不同救援點不共用座標（地圖上「第二洞外」誤植為 #1 的座標）', () => {
    const coords = RESCUE_POINTS.flatMap((p) => (p.coords ? [p.coords] : []))
    for (const [lat, lng] of EMS_LOCATIONS.map((e) => e.coords)) {
      expect(lat).toBeGreaterThan(25.095)
      expect(lat).toBeLessThan(25.12)
      expect(lng).toBeGreaterThan(121.91)
      expect(lng).toBeLessThan(121.93)
    }
    for (const [lat, lng] of coords) {
      expect(lat).toBeGreaterThan(25.095)
      expect(lat).toBeLessThan(25.12)
      expect(lng).toBeGreaterThan(121.91)
      expect(lng).toBeLessThan(121.93)
    }
    expect(new Set(coords.map((c) => c.join())).size).toBe(coords.length)
  })

  it('座標照地圖的寫法固定 6 位小數', () => {
    expect(formatCoords([25.1067, 121.922483])).toBe('25.106700, 121.922483')
  })

  it('路由：/rescue；舊的 /rescue/<大區域> 也到救援頁', () => {
    expect(parseLocation('/rescue')).toEqual({ name: 'rescue' })
    expect(parseLocation('/rescue/golden-valley')).toEqual({ name: 'rescue' })
    expect(rescueKey('longdong/golden-valley')).toBe('golden-valley')
    expect(rescueKey('longdong/unknown')).toBeUndefined()
  })
})
