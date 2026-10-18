import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasUnuploaded, loadCalibration, toGeoJSON, type Fix } from '../src/calibration'
import { AREA_RESCUE, RESCUE_POINTS } from '../src/data/rescue'
import { distanceM } from '../src/geo'
import { parseLocation } from '../src/router'
import { centroid } from '../src/scaleMap'

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

describe('手機上的記錄', () => {
  it('舊版存的軌跡（track）讀出時去掉，只留下回報的點', () => {
    const mark = { ...fix(25.11, 121.92), note: '鐘塔' }
    const store = new Map<string, string>()
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null } as unknown as Storage
    store.set('longdong.calibration', JSON.stringify({ marks: [mark], track: [fix(25.1, 121.9)], uploaded: { time: 1, marks: 1, track: 1 }, queued: true }))
    expect(loadCalibration()).toEqual({ marks: [mark], uploaded: { time: 1, marks: 1 }, queued: true })
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

  it('3 個停車場、13 處船艇接駁點、5 處直升機吊掛點、6 處急救器材、2 個地名；每處急救器材離該區的就近救援點 100 公尺內', () => {
    const base = JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')) as {
      features: { properties: { kind: string; no?: number; zh?: string }; geometry: { type: string; coordinates: [number, number] } }[]
    }
    const points = base.features.filter((f) => f.geometry.type === 'Point')
    expect(points.filter((f) => f.properties.kind === 'parking')).toHaveLength(3)
    expect(points.filter((f) => f.properties.kind === 'boat')).toHaveLength(13)
    expect(points.filter((f) => f.properties.kind === 'hoist')).toHaveLength(5)
    expect(points.filter((f) => f.properties.kind === 'place').map((f) => f.properties.zh)).toEqual(['和美國小', '西靈巖寺'])
    const ems = points.filter((f) => f.properties.kind === 'ems')
    expect(ems.map((f) => f.properties.no)).toEqual([1, 2, 3, 4, 5, 6])
    for (const f of ems) {
      const [lng, lat] = f.geometry.coordinates
      const nos = Object.values(AREA_RESCUE).filter((a) => a.ems === f.properties.no).flatMap((a) => a.points)
      const nearest = Math.min(...RESCUE_POINTS.filter((p) => nos.includes(p.no) && p.coords).map((p) => distanceM(p.coords!, [lat, lng])))
      expect(nearest, `急救器材 #${f.properties.no}`).toBeLessThan(100)
    }
  })

  it('/map 是地圖；舊的校正頁網址轉到地圖', () => {
    expect(parseLocation('/map')).toEqual({ name: 'map' })
    expect(parseLocation('/calibrate')).toEqual({ name: 'map' })
  })
})
