import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset } from '../src/data/schema'
import { AREA_RESCUE, EMS_LOCATIONS, RESCUE_POINTS, formatCoords, mapUrl, rescueKey } from '../src/data/rescue'
import { parseHash } from '../src/router'

const dataset = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset

describe('救援資訊', () => {
  it('每個大區域都有救援資訊與局部圖，沒有多出來的', () => {
    const keys = dataset.areas.map((a) => rescueKey(a.id))
    expect(keys).not.toContain(undefined)
    expect(new Set(keys)).toEqual(new Set(Object.keys(AREA_RESCUE)))
    for (const key of Object.keys(AREA_RESCUE)) expect(() => readFileSync(`public/rescue/${key}.webp`)).not.toThrow()
    expect(() => readFileSync('public/rescue/map.webp')).not.toThrow()
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

  it('座標都在龍洞一帶，且不同救援點不共用座標（地圖上「第二洞外」誤植為 #1 的座標）', () => {
    const coords = RESCUE_POINTS.flatMap((p) => (p.coords ? [p.coords] : []))
    for (const [lat, lng] of coords) {
      expect(lat).toBeGreaterThan(25.095)
      expect(lat).toBeLessThan(25.12)
      expect(lng).toBeGreaterThan(121.91)
      expect(lng).toBeLessThan(121.93)
    }
    expect(new Set(coords.map((c) => c.join())).size).toBe(coords.length)
  })

  it('座標照地圖的寫法固定 6 位小數；地圖連結帶座標', () => {
    expect(formatCoords([25.1067, 121.922483])).toBe('25.106700, 121.922483')
    expect(mapUrl([25.1067, 121.922483])).toBe('https://www.google.com/maps/search/?api=1&query=25.1067,121.922483')
  })

  it('路由：#/rescue 與 #/rescue/<大區域>', () => {
    expect(parseHash('#/rescue')).toEqual({ name: 'rescue' })
    expect(parseHash('#/rescue/golden-valley')).toEqual({ name: 'rescue', id: 'golden-valley' })
    expect(rescueKey('longdong/golden-valley')).toBe('golden-valley')
    expect(rescueKey('longdong/unknown')).toBeUndefined()
  })
})
