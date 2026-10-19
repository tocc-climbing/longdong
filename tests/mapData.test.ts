import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasUnuploaded, toGeoJSON, type Fix } from '../src/map/calibration'
import { AREA_RESCUE, RESCUE_POINTS } from '../src/data/rescue'
import { distanceM } from '../src/geo'
import { parseLocation } from '../src/router'
import { centroid } from '../src/map/mapData'

const fix = (lat: number, lng: number, accuracy = 5, time = 0): Fix => ({ coords: [lat, lng], accuracy, time })

describe('上傳狀態', () => {
  it('沒有記錄不算未上傳；上傳後點數有變才算未上傳', () => {
    const mark = { ...fix(25.11, 121.92), note: '鐘塔' }
    expect(hasUnuploaded({ marks: [] })).toBe(false)
    expect(hasUnuploaded({ marks: [mark] })).toBe(true)
    expect(hasUnuploaded({ marks: [mark], uploaded: { time: 0, marks: 1 } })).toBe(false)
    expect(hasUnuploaded({ marks: [mark, mark], uploaded: { time: 0, marks: 1 } })).toBe(true)
  })
})

describe('匯出 GeoJSON', () => {
  it('每個回報一個 Point，座標順序是 [經度, 緯度]', () => {
    const out = toGeoJSON({ marks: [{ ...fix(25.11, 121.92, 7.6, 0), note: '鐘塔' }] }) as {
      features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[]
    }
    expect(out.features).toHaveLength(1)
    expect(out.features[0].geometry).toEqual({ type: 'Point', coordinates: [121.92, 25.11] })
    expect(out.features[0].properties).toEqual({ note: '鐘塔', accuracy: 8, time: '1970-01-01T00:00:00.000Z' })
  })
})

describe('比例尺地圖資料', () => {
  it('重心與面積', () => {
    const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    expect(centroid(square)).toEqual({ at: [5, 5], size: 100 })
    // 順時針（面積為負）也一樣
    expect(centroid([...square].reverse())).toEqual({ at: [5, 5], size: 100 })
  })

  it('9 個大區域都有範圍，且就近的救援點在該區範圍附近（50 公尺內）', () => {
    const areas = JSON.parse(readFileSync('public/rescue/areas.geojson', 'utf8')) as {
      features: { properties: { id: string }; geometry: { coordinates: [number, number][][][] } }[]
    }
    expect(areas.features.map((f) => f.properties.id).sort()).toEqual(Object.keys(AREA_RESCUE).sort())
    for (const f of areas.features) {
      const vertices = f.geometry.coordinates.flat(2)
      const nearest = Math.min(
        ...AREA_RESCUE[f.properties.id].points.flatMap((no) =>
          RESCUE_POINTS.filter((p) => p.no === no && p.coords).map((p) => Math.min(...vertices.map(([lng, lat]) => distanceM(p.coords!, [lat, lng])))),
        ),
      )
      expect(nearest, f.properties.id).toBeLessThan(50)
    }
  })

  it('3 個停車場、13 處船艇接駁點、5 處直升機吊掛點、6 處急救器材、2 處危險地形、救援資訊圖上的地名；每處急救器材離該區的就近救援點 100 公尺內', () => {
    const base = JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')) as {
      features: { properties: { kind: string; no?: number; zh?: string; en?: string; ja?: string; tone?: string }; geometry: { type: string; coordinates: [number, number] } }[]
    }
    const points = base.features.filter((f) => f.geometry.type === 'Point')
    expect(points.filter((f) => f.properties.kind === 'parking')).toHaveLength(3)
    expect(points.filter((f) => f.properties.kind === 'boat')).toHaveLength(13)
    expect(points.filter((f) => f.properties.kind === 'hoist')).toHaveLength(5)
    const places = points.filter((f) => f.properties.kind === 'place')
    expect(places.map((f) => f.properties.zh)).toEqual(expect.arrayContaining(['和美國小', '西靈巖寺', '龍洞隧道', '黃金谷小徑', '海巡署龍洞安檢所']))
    for (const { properties: p } of places) {
      expect([p.zh, p.en, p.ja].every(Boolean), `${p.zh} 要有中英日三種名稱`).toBe(true)
      expect(['place', 'road', 'trail', 'sea', 'warning']).toContain(p.tone)
    }
    // 危險地形在岩場裡：離最近的救援點 150 公尺內
    const hazards = points.filter((f) => f.properties.kind === 'hazard')
    expect(hazards).toHaveLength(2)
    for (const f of hazards) {
      const [lng, lat] = f.geometry.coordinates
      expect(Math.min(...RESCUE_POINTS.filter((p) => p.coords).map((p) => distanceM(p.coords!, [lat, lng])))).toBeLessThan(150)
    }
    const ems = points.filter((f) => f.properties.kind === 'ems')
    expect(ems.map((f) => f.properties.no)).toEqual([1, 2, 3, 4, 5, 6])
    for (const f of ems) {
      const [lng, lat] = f.geometry.coordinates
      const nos = Object.values(AREA_RESCUE).filter((a) => a.ems === f.properties.no).flatMap((a) => a.points)
      const nearest = Math.min(...RESCUE_POINTS.filter((p) => nos.includes(p.no) && p.coords).map((p) => distanceM(p.coords!, [lat, lng])))
      expect(nearest, `急救器材 #${f.properties.no}`).toBeLessThan(100)
    }
  })

  it('/map 是地圖', () => {
    expect(parseLocation('/map')).toEqual({ name: 'map' })
  })
})
