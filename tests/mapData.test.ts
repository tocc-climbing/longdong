import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasUnuploaded, toGeoJSON, type Fix } from '../src/map/calibration'
import { AREA_RESCUE, RESCUE_POINTS } from '../src/data/rescue'
import { distanceM } from '../src/geo'
import { parseLocation } from '../src/router'
import { centroid, loadScaleMap, project, unproject } from '../src/map/mapData'

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

describe('底圖的台二線與地名（scale-map.geojson）', () => {
  type Feature = { properties: { kind: string; zh?: string }; geometry: { type: string; coordinates: unknown } }
  const features = (JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')) as { features: Feature[] }).features

  it('台二線各段的端點不會差幾十公尺（接點斷開：龍洞街口）', () => {
    const lines = features.filter((f) => f.properties.kind === 'highway').flatMap((f) => f.geometry.coordinates as [number, number][][])
    const ends = lines.flatMap((l, i) => [l[0], l.at(-1)!].map((p) => ({ i, p })))
    const gaps = ends.flatMap((a, k) => ends.slice(k + 1).filter((b) => a.i !== b.i).map((b) => distanceM([a.p[1], a.p[0]], [b.p[1], b.p[0]])))
    // 端點相距不到 5 公尺是接上了；超過 100 公尺是各自的端點（頁框外、隧道兩端）；中間的是斷口
    expect(gaps.filter((m) => m > 5 && m < 100)).toEqual([])
  })

  it('校門口急救器材 #1 在現場回報的位置（2 公尺內）', () => {
    const ems = features.find((f) => f.properties.kind === 'ems' && (f.properties as { no?: number }).no === 1)!
    const [lng, lat] = ems.geometry.coordinates as [number, number]
    expect(distanceM([lat, lng], [25.11274, 121.92159])).toBeLessThan(2)
  })

  it('和美國小、西靈巖寺的位置在 OpenStreetMap 建物的 15 公尺內', () => {
    const at = (zh: string) => {
      const [lng, lat] = features.find((f) => f.properties.kind === 'place' && f.properties.zh === zh)!.geometry.coordinates as [number, number]
      return [lat, lng] as [number, number]
    }
    expect(distanceM(at('和美國小'), [25.1123339, 121.9195433])).toBeLessThan(15)
    expect(distanceM(at('西靈巖寺'), [25.1051223, 121.9211926])).toBeLessThan(15)
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

  it('在地圖上點的位置放在 properties.picked（[經度, 緯度]，小數 6 位）', () => {
    const out = toGeoJSON({ marks: [{ ...fix(25.11, 121.92), note: '鐘塔', picked: [25.1101234567, 121.9201234567] }] }) as {
      features: { properties: Record<string, unknown> }[]
    }
    expect(out.features[0].properties.picked).toEqual([121.920123, 25.110123])
  })

  it('手動回報：Point 是在地圖上點的位置，properties.manual 為 true、沒有 accuracy', () => {
    const target = { kind: 'base' as const, areaId: 'longdong/school-gate', sectorId: 'longdong/school-gate-a1151r' }
    const out = toGeoJSON({ marks: [{ manual: true, coords: [25.1127198, 121.9214567], time: 0, note: '校門口 · 牆底', target }] }) as {
      features: { properties: Record<string, unknown>; geometry: { coordinates: unknown } }[]
    }
    expect(out.features[0].geometry.coordinates).toEqual([121.921457, 25.11272])
    expect(out.features[0].properties).toEqual({ note: '校門口 · 牆底', manual: true, time: '1970-01-01T00:00:00.000Z', target })
  })
})

describe('地圖座標與經緯度互換', () => {
  it('unproject 是 project 的反函數（在地圖上點的位置換回經緯度）', () => {
    const at: [number, number] = [25.1123, 121.9234]
    const [lat, lng] = unproject(project(at))
    expect(distanceM(at, [lat, lng])).toBeLessThan(0.01)
  })
})

describe('比例尺地圖資料', () => {
  it('重心與面積', () => {
    const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    expect(centroid(square)).toEqual({ at: [5, 5], size: 100 })
    // 順時針（面積為負）也一樣
    expect(centroid([...square].reverse())).toEqual({ at: [5, 5], size: 100 })
  })

  it('9 個大區域都有範圍，且就近的救援點在該區範圍附近（60 公尺內；第二洞列的是鄰區的，120 公尺內）', () => {
    const areas = JSON.parse(readFileSync('public/rescue/areas.geojson', 'utf8')) as {
      features: { properties: { id: string }; geometry: { coordinates: [number, number][][][] } }[]
    }
    expect(areas.features.map((f) => f.properties.id).sort()).toEqual(Object.keys(AREA_RESCUE).sort())
    /** 點到多邊形邊界的距離（公尺，地圖座標） */
    const toEdges = (q: [number, number], rings: [number, number][][]) =>
      Math.min(
        ...rings.flatMap((r) =>
          r.slice(1).map((b, i) => {
            const a = r[i]
            const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
            const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
            return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1])
          }),
        ),
      )
    for (const f of areas.features) {
      const rings = f.geometry.coordinates.map((polygon) => polygon[0].map(([lng, lat]) => project([lat, lng])))
      const nearest = Math.min(
        ...AREA_RESCUE[f.properties.id].points.flatMap((no) => RESCUE_POINTS.filter((p) => p.no === no && p.coords).map((p) => toEdges(project(p.coords!), rings))),
      )
      // 第二洞自己的救援點 #9 沒有座標，列的是南北兩側鄰區的 #8、#10
      expect(nearest, f.properties.id).toBeLessThan(f.properties.id === 'second-cave' ? 120 : 60)
    }
  })

  describe('分區岩壁的原始版（walls.geojson）', () => {
    const walls = (JSON.parse(readFileSync('public/rescue/walls.geojson', 'utf8')) as { features: { properties: { sector: string }; geometry: { coordinates: [number, number][][] } }[] }).features
    const dataset = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as { areas: { sectors: { id: string; name: { zh: string } }[] }[] }
    const sectors = dataset.areas.flatMap((a) => a.sectors)

    it('每個分區都有岩壁，沒有不存在的分區', () => {
      expect(walls.map((f) => f.properties.sector).sort()).toEqual(sectors.map((s) => s.id).sort())
    })

    /** 點到某個分區岩壁的距離（公尺） */
    const toWall = (at: [number, number], zh: string) => {
      const id = sectors.find((s) => s.name.zh === zh)!.id
      const lines = walls.find((f) => f.properties.sector === id)!.geometry.coordinates
      const q = project(at)
      return Math.min(
        ...lines.flatMap((l) =>
          l.slice(1).map((b, i) => {
            const [a, c] = [project([l[i][1], l[i][0]]), project([b[1], b[0]])]
            const [dx, dy] = [c[0] - a[0], c[1] - a[1]]
            const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
            return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1])
          }),
        ),
      )
    }
    const ems = (no: number): [number, number] => {
      const f = (JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')) as { features: { properties: { kind: string; no?: number }; geometry: { coordinates: [number, number] } }[] }).features.find(
        (f) => f.properties.kind === 'ems' && f.properties.no === no,
      )!
      return [f.geometry.coordinates[1], f.geometry.coordinates[0]]
    }

    it('急救器材依放置位置的說明靠著分區岩壁：長巷最深處、第一洞洞內、鱷魚岬與老人牆的內角', () => {
      // 長巷的岩壁是兩側牆底連成的 U 字，最深處是離入口（線的兩端）最遠的地方
      const lane = walls.find((f) => f.properties.sector === sectors.find((s) => s.name.zh === '長巷')!.id)!.geometry.coordinates[0]
      const [start, end] = [lane[0], lane.at(-1)!].map(([lng, lat]) => project([lat, lng]))
      const depth = (p: [number, number]) => Math.min(Math.hypot(p[0] - start[0], p[1] - start[1]), Math.hypot(p[0] - end[0], p[1] - end[1]))
      const deepest = Math.max(...lane.map(([lng, lat]) => depth(project([lat, lng]))))
      expect(deepest - depth(project(ems(3)))).toBeLessThan(3)
      expect(toWall(ems(3), '長巷')).toBeLessThan(5)
      for (const zh of ['第一洞內 西面', '第一洞內 東北面', '第一洞內 南面']) expect(toWall(ems(4), zh), zh).toBeLessThan(3)
      for (const zh of ['鱷魚岬', '老人牆']) expect(toWall(ems(6), zh), zh).toBeLessThan(6)
    })

    it('急救器材 #5 在傳奇岩前面：靠著岩壁、在面向谷地的東側', () => {
      expect(toWall(ems(5), '傳奇岩')).toBeLessThan(6)
      // 同一個緯度上岩壁的位置（地圖座標 y 往南增加）
      const [x, y] = project(ems(5))
      const wall = walls.find((f) => f.properties.sector === sectors.find((s) => s.name.zh === '傳奇岩')!.id)!.geometry.coordinates[0].map(([lng, lat]) => project([lat, lng]))
      const i = wall.findIndex((p, j) => j > 0 && (wall[j - 1][1] - y) * (p[1] - y) <= 0)
      const [a, b] = [wall[i - 1], wall[i]]
      expect(x).toBeGreaterThan(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
    })
  })

  it('步道是編輯修改後的原始版，不是救援資訊圖自動產生的路線', () => {
    const base = JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')) as { features: { properties: { kind: string }; geometry: { coordinates: [number, number][][] } }[] }
    const points = base.features.find((f) => f.properties.kind === 'trail')!.geometry.coordinates.flat()
    // 修改後的路線經過這一點（自動產生的離這裡約 29 公尺）
    const q = project([25.10706, 121.921294])
    expect(Math.min(...points.map(([lng, lat]) => project([lat, lng])).map((p) => Math.hypot(p[0] - q[0], p[1] - q[1])))).toBeLessThan(1)
  })

  it('3 個停車場、13 處船艇接駁點、5 處直升機吊掛點、6 處急救器材、2 處危險地形、救援資訊圖上的地名；每處急救器材離該區的就近救援點 100 公尺內', () => {
    const base = JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')) as {
      features: { properties: { kind: string; no?: number; zh?: string; en?: string; ja?: string; tone?: string; line?: string }; geometry: { type: string; coordinates: [number, number] } }[]
    }
    const points = base.features.filter((f) => f.geometry.type === 'Point')
    expect(points.filter((f) => f.properties.kind === 'parking')).toHaveLength(3)
    expect(points.filter((f) => f.properties.kind === 'boat')).toHaveLength(13)
    expect(points.filter((f) => f.properties.kind === 'hoist')).toHaveLength(5)
    const places = points.filter((f) => f.properties.kind === 'place')
    expect(places.map((f) => f.properties.zh)).toEqual(expect.arrayContaining(['和美國小', '西靈巖寺', '往基隆、台北', '海巡署龍洞安檢所']))
    // 道路、步道、隧道的名稱沿著線排（kind: 'name'，標明是哪一個圖層的線）
    const names = points.filter((f) => f.properties.kind === 'name')
    expect(names.map((f) => f.properties.zh)).toEqual(expect.arrayContaining(['龍洞街', '台二線濱海公路', '龍洞隧道', '黃金谷小徑']))
    for (const { properties: p } of names) expect(['highway', 'tunnel', 'road', 'trail']).toContain(p.line)
    for (const { properties: p } of [...places, ...names]) {
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

describe('地圖資料只載入一次', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('各頁的地圖共用同一份；載入失敗時下次重新下載', async () => {
    const urls: string[] = []
    let offline = true
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      if (offline) return new Response(null, { status: 503 })
      return new Response(readFileSync(`public${url}`, 'utf8'))
    })
    const FILES = ['/rescue/scale-map.geojson', '/rescue/areas.geojson', '/rescue/walls.geojson']
    await expect(loadScaleMap()).rejects.toThrow('503')
    offline = false
    const first = await loadScaleMap()
    expect(await loadScaleMap()).toBe(first)
    expect(urls).toEqual([...FILES, ...FILES])
  })
})
