import { describe, expect, it, vi } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { connectTerrainLines, drape, elevation, terrainDashLines, terrainMesh, terrainPoint, terrainView, type Terrain, type TerrainRegion } from '../src/map/terrain'
import { coastalIslands, continuousTerrainOutline, terrainCoastMask, terrainDomains, terrainExtensions, terrainIslandParts, terrainRegionField } from '../src/map/terrainRegions'
import { terrainDisplayResolution } from '../src/map/terrainRaster'

// 突變：高程少乘 scale、雙線性內插改成單點取樣、把缺值改成 0、忽略 z 投影。
const grid: Terrain = { origin: [0, 0], u: [20, 0], v: [0, 20], columns: 2, rows: 2, scale: 0.1, heights: [0, 100, 200, 300] }
describe('20m DTM 地形', () => {
  it('地面虛線跨節點保持 8m 分段，隧道只接合 15m 內道路', () => {
    // 突變：每個原始節點重設分段、略過入口接合、把遠處入口也拉過去。
    const dashed = terrainDashLines([[[0, 0], [5, 0], [25, 0]]], 8, 8)
    expect(dashed).toHaveLength(2)
    expect(dashed[0][0][0]).toBe(0); expect(dashed[0].at(-1)![0]).toBeCloseTo(8)
    expect(dashed[1][0][0]).toBeCloseTo(16); expect(dashed[1].at(-1)![0]).toBeCloseTo(24)
    expect(connectTerrainLines([[[0, 9], [100, 9]]], [[[0, 0], [100, 0]]])).toEqual([[[0, 0], [100, 0]]])
    expect(connectTerrainLines([[[0, 20], [100, 20]]], [[[0, 0], [100, 0]]])).toEqual([[[0, 20], [100, 20]]])
  })
  it('可調整傾角：30 度保留約 87% 南北長度，俯視不壓縮平面', () => {
    // 突變：忽略 pitch，繼續固定使用 60 度。
    expect(terrainView([10, 100], 100, 0, 30)[0]).toBe(10)
    expect(terrainView([10, 100], 100, 0, 30)[1]).toBeCloseTo(36.6025403784)
    expect(terrainView([10, 100], 100, 0, 0)).toEqual([10, 100])
  })
  it('遠離岩壁的兩區交界仍連續混色，不以最近區域硬切', () => {
    // 突變：沒有岩壁遮罩權重時改回最近種子顏色。
    vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) })
    try {
      const t = { ...grid, columns: 30, rows: 30, heights: Array(900).fill(100) }
      const regions: TerrainRegion[] = [
        { id: 'red', color: '#ff0000', rings: [[[0, 0], [300, 0], [300, 500], [0, 500]]], walls: [[[100, 100], [100, 120]]] },
        { id: 'blue', color: '#0000ff', rings: [[[300, 0], [580, 0], [580, 500], [300, 500]]], walls: [[[500, 100], [500, 120]]] },
      ]
      const f = terrainRegionField(t, regions, 3, true)
      const sample = (x: number) => {
        const i = (Math.round((300/20+0.5)*3-0.5)*f.width+Math.round((x/20+0.5)*3-0.5))*4
        return [...f.pixels.slice(i, i+3)]
      }
      const a = sample(290), b = sample(310)
      expect(a[0]).toBeGreaterThan(70); expect(a[2]).toBeGreaterThan(70)
      expect(b[0]).toBeGreaterThan(70); expect(b[2]).toBeGreaterThan(70)
      expect(Math.max(...a.map((v, i) => Math.abs(v-b[i])))).toBeLessThan(40)
    } finally { vi.unstubAllGlobals() }
  })
  it('陸側分區邊界漸變接回山坡，岩壁仍保持完整顯色', () => {
    // 突變：移除顯色外框的平滑過渡，會恢復校門口左上方的硬切色塊。
    vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) })
    try {
      const t = { ...grid, columns: 20, rows: 20, heights: Array(400).fill(10) }
      const field = terrainRegionField(t, [{ id: 'school-gate', color: '#ff007f', rings: [[[100, 100], [200, 100], [200, 200], [100, 200]]], walls: [[[150, 150], [160, 150]]] }], 3)
      const alpha = (x: number) => field.pixels[(Math.round((150/20+0.5)*3-0.5)*field.width+Math.round((x/20+0.5)*3-0.5))*4+3]
      expect(alpha(60)).toBeGreaterThan(0)
      expect(alpha(60)).toBeLessThan(100)
      expect(alpha(70)).toBeGreaterThan(alpha(60))
      expect(alpha(150)).toBe(255)
    } finally { vi.unstubAllGlobals() }
  })
  it('完整向量範圍四角都有高程，攀岩岸段與重疊實測點保持原值', () => {
    // 突變：改載舊裁切格網、將周邊缺值一律補零、讓全圖海岸推動原攀岩分區。
    const full = JSON.parse(readFileSync('public/rescue/terrain-map-20m.json', 'utf8')) as Terrain
    const hero = JSON.parse(readFileSync('public/rescue/terrain-20m.json', 'utf8')) as Terrain
    expect(full.regionCoast).toEqual(hero.coast)
    const m = 6371000*Math.PI/180
    for (const lat of [25.0958, 25.1185]) for (const lng of [121.9052, 121.9313]) expect(elevation(full, [(lng-121.92)*m*Math.cos(25.107*Math.PI/180), (25.107-lat)*m])).toBeDefined()
    let matched = 0
    const filled = new Set(hero.interpolated)
    for (const [start, length] of hero.seaRuns ?? []) for (let i = start; i < start+length; i++) filled.add(i)
    hero.heights.forEach((z, i) => {
      const c = i%hero.columns+6, r = Math.floor(i/hero.columns)-9
      if (z !== null && !filled.has(i) && c < full.columns && r >= 0 && r < full.rows) { expect(full.heights[r*full.columns+c]).toBe(z); matched++ }
    })
    expect(matched).toBeGreaterThan(9000)
    expect(elevation(full, [-700, -600])).toBeGreaterThan(1)
  })
  it('全圖周邊山坡以中性色顯示，海面仍由完整海岸遮罩留空', () => {
    // 突變：不啟用全圖背景、或只保留攀岩主岸遮罩。
    vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) })
    try {
      const t = JSON.parse(readFileSync('public/rescue/terrain-map-20m.json', 'utf8')) as Terrain
      const field = terrainRegionField(t, [{ id: 'long-lane', color: '#287fc0', rings: [[[250, -500], [350, -500], [350, -400]]], walls: [[[260, -480], [340, -430]]] }], 2, true)
      const sample = (pixels: Uint8Array, width: number, scale: number, x: number, y: number, channels: number) => {
        const dx = x-t.origin[0], dy = y-t.origin[1], det = t.u[0]*t.v[1]-t.u[1]*t.v[0]
        const c = (dx*t.v[1]-dy*t.v[0])/det, r = (dy*t.u[0]-dx*t.u[1])/det
        const i = (Math.round((r+0.5)*scale-0.5)*width+Math.round((c+0.5)*scale-0.5))*channels
        return [...pixels.slice(i, i+channels)]
      }
      expect(sample(field.pixels, field.width, 2, -700, -600, 4)).toEqual([117, 151, 123, 255])
      const coast = terrainCoastMask(t, true)
      expect(sample(coast.pixels, coast.width, 10, -700, -600, 1)).toEqual([255])
      expect(sample(coast.pixels, coast.width, 10, 1000, -600, 1)).toEqual([0])
      // 突變：以救援示意圖拼接的 kitbase 當全圖海岸，北側台二線旁的山坡會被挖空。
      for (const [x, y] of [[-700, -1000], [-700, -850], [-600, -1000]]) {
        expect(elevation(t, [x, y])).toBeGreaterThan(0)
        expect(sample(coast.pixels, coast.width, 10, x, y, 1)).toEqual([255])
      }
    } finally { vi.unstubAllGlobals() }
  })
  it('南北延伸到自然端部、西側保持原位，圈選海角依鐘塔與長巷配色', () => {
    // 突變：拿掉延伸、把所有延伸點再做全域凸包、取消鐘塔礁的歸屬。
    const t = JSON.parse(readFileSync('public/rescue/terrain-20m.json', 'utf8')) as Terrain
    const data = JSON.parse(readFileSync('public/rescue/areas.geojson', 'utf8'))
    const m = 6371000*Math.PI/180
    const regions: TerrainRegion[] = data.features.map((f: { properties: { id: string }; geometry: { coordinates: [number, number][][][] } }) => ({ id: f.properties.id, color: f.properties.id, walls: [], rings: f.geometry.coordinates.map(([ring]) => ring.map(([x, y]): [number, number] => [(x-121.92)*m*Math.cos(25.107*Math.PI/180), (25.107-y)*m])) }))
    const extensions = terrainExtensions(t, regions)
    expect(extensions.map((e) => e.region.id).sort()).toEqual(['back-door', 'school-gate'])
    expect(Math.min(...extensions.find((e) => e.region.id === 'school-gate')!.ring.map((p) => p[1]))).toBeLessThan(-800)
    expect(Math.max(...extensions.find((e) => e.region.id === 'back-door')!.ring.map((p) => p[1]))).toBeGreaterThan(400)
    for (const e of extensions) expect(Math.min(...e.ring.map((p) => p[0]))).toBeGreaterThanOrEqual(Math.min(...e.region.rings.flat().map((p) => p[0])))
    expect(terrainDomains(t, regions)[0]).toEqual(terrainDomains({ ...t, coast: undefined }, regions)[0])
    const clocktowerGroup = [0, 2, 11, 13, 14, 16].map((i) => `coast-island-${i}`)
    const allIslands = coastalIslands(t, regions)
    for (const id of clocktowerGroup) expect(allIslands.find((i) => i.id === id)!.color).toBe('clocktower')
    expect(allIslands.find((i) => i.id === 'coast-island-12')!.color).toBe('long-lane')
    const clocktowerOnly = coastalIslands(t, regions.filter((r) => r.id === 'clocktower'))
    for (const id of clocktowerGroup) expect(clocktowerOnly.some((i) => i.id === id)).toBe(true)
    expect(coastalIslands(t, regions.filter((r) => r.id === 'school-gate')).some((i) => clocktowerGroup.includes(i.id))).toBe(false)
  })
  it('島礁取自海岸圖資，包含原區域圖未畫的鄰近小島並排除遠島', () => {
    // 突變：改回原區域圖的三塊島、或取消附近範圍限制。
    const main: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const island: [number, number][] = [[120, 20], [130, 20], [125, 30], [120, 20]]
    const far = island.map(([x, y]): [number, number] => [x+500, y])
    const parts = coastalIslands({ ...grid, coast: [[main], [island], [far]] }, [{ id: 'coast', color: '#ff9900', rings: [main], walls: [] }])
    expect(parts.map((i) => i.ring)).toEqual([island])
    expect(parts[0].color).toBe('#ff9900')
  })
  it('B5000 岬角、島礁與中間水道保留；不能再使用示意底圖陸地', () => {
    // 突變：把 coast 換回 kitbase 灰色底圖，兩個裸岩檢核點會被裁掉。
    const t = JSON.parse(readFileSync('public/rescue/terrain-20m.json', 'utf8')) as Terrain
    const onLand = ([lng, lat]: [number, number]) => {
      const m = 6371000*Math.PI/180
      const x = (lng-121.92)*m*Math.cos(25.107*Math.PI/180), y = (25.107-lat)*m
      return t.coast!.some(([ring]) => {
        let count = 0
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i+1)%ring.length]
          if ((a[1] > y) !== (b[1] > y) && x < a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])) count++
        }
        return count%2 === 1
      })
    }
    expect(onLand([121.9233751, 25.1123142])).toBe(true)
    expect(onLand([121.9235254, 25.1079911])).toBe(true)
    expect(onLand([121.9230640, 25.1123142])).toBe(false)
    expect(onLand([121.9240618, 25.1081854])).toBe(false)
  })
  it('顯色鋪滿，海灣由獨立的精細主岸遮罩裁切，不露灰色底層', () => {
    // 突變：顯色再乘上低解析度海陸遮罩，岸內邊緣會被過早挖空。
    vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) })
    try {
      const shore: [number, number][] = [[0, 0], [60, 0], [60, 60], [40, 60], [40, 20], [20, 20], [20, 60], [0, 60]]
      const terrain = { ...grid, columns: 4, rows: 4, heights: Array(16).fill(0), coast: [[shore]] }
      const field = terrainRegionField(terrain, [{ id: 'coast', color: '#ff9900', rings: [[[0, 0], [60, 0], [60, 60], [0, 60]]], walls: [[[10, 40], [50, 40]]] }], 3)
      const alpha = (x: number, y: number) => field.pixels[(Math.round((y/20+0.5)*3-0.5)*field.width+Math.round((x/20+0.5)*3-0.5))*4+3]
      expect(alpha(30, 40)).toBe(255)
      expect(alpha(10, 40)).toBe(255)
      expect(alpha(50, 40)).toBe(255)
      const coast = terrainCoastMask(terrain)
      const at = (x: number, y: number) => coast.pixels[Math.round((y/20+0.5)*10-0.5)*coast.width+Math.round((x/20+0.5)*10-0.5)]
      expect(at(30, 40)).toBe(0)
      expect(at(10, 40)).toBe(255)
      expect(at(50, 40)).toBe(255)
      expect(coast.meters).toBe(2)
    } finally { vi.unstubAllGlobals() }
  })
  it('原圖分離的小島獨立保留，主岸以面積辨識而非點數', () => {
    const main: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const island: [number, number][] = [[120, 0], [125, 0], [130, 0], [130, 5], [130, 10], [125, 10], [120, 10], [120, 5]]
    const parts = terrainIslandParts([{ id: 'coast', color: '#ff9900', rings: [island, main], walls: [] }])
    expect(parts.mainlands[0].rings).toEqual([main])
    expect(parts.islands.map((i) => i.ring)).toEqual([island])
    const west = island.map(([x, y]): [number, number] => [x-150, y])
    const withWest = terrainIslandParts([{ id: 'coast', color: '#ff9900', rings: [main, island, west], walls: [] }])
    expect(withWest.islands.map((i) => i.ring)).toEqual([island])
    expect(withWest.mainlands[0].rings).toContainEqual(west)
  })
  it('小圖超取樣、桌面提高顏色細節，高密度大圖仍限制總像素', () => {
    expect(terrainDisplayResolution(320, 120, 1).ratio).toBe(2)
    expect(terrainDisplayResolution(320, 120, 3).ratio).toBe(3)
    expect(terrainDisplayResolution(320, 120, 2).fieldScale).toBe(2)
    expect(terrainDisplayResolution(1000, 208, 2).fieldScale).toBe(3)
    const large = terrainDisplayResolution(1920, 600, 3)
    expect(1920*600*large.ratio**2).toBeLessThanOrEqual(1600000.001)
  })
  it('分開的區域合成一個連續外框，中間的地形保留在圖內', () => {
    // 突變：逐區建立外框，會再次把中間的陸地切掉。
    const outline = continuousTerrainOutline([[0, 0], [10, 0], [10, 10], [0, 10], [30, 0], [40, 0], [40, 10], [30, 10]])
    expect(outline).toHaveLength(4)
    expect(outline).toContainEqual([0, 0])
    expect(outline).toContainEqual([40, 10])
  })
  it('高程內插保留公尺單位，缺值不補成海平面', () => {
    expect(elevation(grid, [10, 10])).toBe(15)
    expect(elevation({ ...grid, heights: [0, 100, null, 300] }, [10, 10])).toBeCloseTo(40/3)
    expect(elevation({ ...grid, heights: [null, null, null, null] }, [10, 10])).toBeUndefined()
    expect(elevation(grid, [-10, 0])).toBeUndefined()
  })
  it('正投影使用真實高程，牆線隨高程升高', () => {
    expect(terrainView([20, 20], 30, 0)[1]).toBeCloseTo(10-30*Math.sqrt(3)/2)
    const d = drape(grid, [[[0, 0], [15, 0]]], 0, 0)
    expect(d).toContain('L10.0,-4.3')
  })
  it('細分高度保留原始點與平台，坡度跨網格邊界仍連續', () => {
    // 突變：改回雙線性內插，平台交界兩側的坡度會突然跳變。
    const slope: Terrain = { ...grid, columns: 4, rows: 4, heights: Array.from({ length: 4 }, () => [0, 0, 100, 100]).flat() }
    expect(elevation(slope, [20, 30])).toBe(0)
    expect(elevation(slope, [40, 30])).toBe(10)
    const left = (elevation(slope, [40, 30])!-elevation(slope, [39.99, 30])!)/0.01
    const right = (elevation(slope, [40.01, 30])!-elevation(slope, [40, 30])!)/0.01
    expect(Math.abs(left-right)).toBeLessThan(0.001)
    for (let x = 0; x < 60; x += 0.5) {
      const h = elevation(slope, [x, 30])!
      expect(h).toBeGreaterThanOrEqual(-1e-10)
      expect(h).toBeLessThanOrEqual(10+1e-10)
    }
  })
  it('龍洞真實資料涵蓋九區且維持 20m 原生網格', () => {
    const t = JSON.parse(readFileSync('public/rescue/terrain-20m.json', 'utf8')) as Terrain
    expect(Math.hypot(...t.u)).toBeCloseTo(20, 0)
    expect(Math.hypot(...t.v)).toBeCloseTo(20, 0)
    expect(t.heights.length).toBe(t.columns*t.rows)
    // 官方原始圖幅 97232056 / 57 / 66 / 67 裁切後的已知高程範圍。
    expect(Math.max(...t.heights.filter((h): h is number => h !== null))*t.scale).toBeCloseTo(355.4)
    expect(terrainPoint(t, 0, 0)).toEqual(t.origin)
    expect(t.interpolated).toHaveLength(5)
    expect(t.seaRuns!.reduce((n, [, count]) => n+count, 0)).toBe(1223)
    for (const [start, count] of t.seaRuns!) {
      expect(t.heights.slice(start, start+count).every((h) => h === 0)).toBe(true)
    }
    expect(t.interpolated!.every((i) => t.heights[i] !== null)).toBe(true)
  })
  it('海面零高程真正形成網格面，海面與陸地分開繪製', () => {
    // 突變：仍跳過補零海面或忘記區分海陸，便無法畫出海岸區域的完整表面。
    const sea: Terrain = { ...grid, heights: [0, 0, 0, 0], seaRuns: [[0, 4]], waterRuns: [[0, 4]] }
    const mesh = terrainMesh(sea, 0, [-1, -1, 30, 30], 1)
    expect(mesh.triangles).toBe(2)
    expect(mesh.paths.every((p) => p.sea)).toBe(true)
    expect(elevation(sea, [10, 10])).toBe(0)
  })
})
