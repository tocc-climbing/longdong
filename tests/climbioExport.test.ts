import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validate, type Layer, type PhotoView, type Position } from '../vendor/climbio-format/format'
import { areaSet, cragSet, fileId, globalId, topo, type TopoInput } from '../scripts/lib/climbio'
import { longdongMap } from '../scripts/lib/climbioMap'
import type { Dataset } from '../src/data/schema'
import type { MapShapes } from '../src/map/shapes'

const read = <T>(path: string) => JSON.parse(readFileSync(resolve(__dirname, '..', path), 'utf8')) as T
const dataset = read<Dataset>('public/data/longdong.json')
const common = { dataUrl: 'https://longdong.web.app/data/longdong.json' }
/** 出口的岩場地圖：只有龍洞自己的 */
const ownMap = longdongMap(dataset, undefined, false)
const schoolGate = dataset.areas.find((a) => a.id === 'longdong/school-gate')!
const jag38d = schoolGate.sectors.flatMap((s) => s.routes).find((r) => r.id === 'longdong/jag38d')!

describe('全域 id', () => {
  it('由代號算出：16 碼小寫英數，每次一樣', () => {
    expect(globalId('longdong/jag38d')).toMatch(/^[0-9a-z]{16}$/)
    expect(globalId('longdong/jag38d')).toBe(globalId('longdong/jag38d'))
    expect(fileId('longdong/school-gate', 'set')).not.toBe(fileId('longdong/school-gate', 'map'))
  })

  it('路線資料裡的岩場、區域、分區、路線不撞號', () => {
    const codes = [dataset.crag.id, ...dataset.areas.flatMap((a) => [a.id, ...a.sectors.flatMap((s) => [s.id, ...s.routes.map((r) => r.id)])])]
    expect(new Set(codes.map(globalId)).size).toBe(codes.length)
  })
})

describe('路線資料換成組合（真實資料）', () => {
  it('岩場與每個區域的組合都通過官方驗證', () => {
    expect(validate(cragSet(dataset, ownMap, common))).toEqual([])
    for (const area of dataset.areas) expect([area.id, validate(areaSet(dataset, area, { topos: [] }, common))]).toEqual([area.id, []])
  })

  it('區域 → 分區 → 路線：parent 依序指向上一層，代號放 props.code', () => {
    const doc = areaSet(dataset, schoolGate, { topos: [] }, common)
    const route = doc.nodes!.find((n) => n.props?.code === 'longdong/jag38d')!
    const sector = doc.nodes!.find((n) => n.id === route.parent)!
    const area = doc.nodes!.find((n) => n.id === sector.parent)!
    expect([route.type, sector.type, area.type]).toEqual(['route', 'sector', 'area'])
    expect(area.parent).toBe(globalId('longdong'))
    expect(route.id).toBe(globalId('longdong/jag38d'))
  })

  it('路線：難度、種類、長度用通用詞彙；五金、安全評級用 longdong: 詞彙', () => {
    const route = areaSet(dataset, schoolGate, { topos: [] }, common).nodes!.find((n) => n.props?.code === 'longdong/jag38d')!
    expect(route.name).toEqual({ 'zh-Hant': jag38d.name.zh, ...(jag38d.name.en ? { en: jag38d.name.en } : {}) })
    expect(route.props).toMatchObject({ grade: { yds: jag38d.grade }, style: jag38d.type, bolts: jag38d.boltCount, 'longdong:safety': jag38d.safety, 'longdong:bolts': jag38d.bolts })
  })

  it('岩場的組合列出岩場地圖與每個區域的組合', () => {
    const doc = cragSet(dataset, ownMap, common)
    expect(doc.items!.map((i) => i.id)).toEqual([ownMap.id, ...dataset.areas.map((a) => fileId(a.id, 'set'))])
    expect(doc.items!.every((i) => i.href === `${i.id}.json`)).toBe(true)
  })
})

describe('出口的岩場地圖', () => {
  const full = longdongMap(dataset)

  it('只有龍洞自己的：沒有 OpenStreetMap 的線與停車場範圍，陸地、建物只到頁框；區域、分區、地點都在；CC BY-SA', () => {
    expect(validate(ownMap)).toEqual([])
    expect(ownMap.marks!.flatMap((m) => (m.node ? [] : [m.props!.kind]))).toEqual(['land', 'building', 'highway', 'tunnel', 'road', 'trail'])
    const land = (m: typeof full) => (m.marks![0].geometry.coordinates as Position[][][]).flat(2)
    const west = (m: typeof full) => Math.min(...land(m).map((p) => p[0]))
    expect(west(ownMap)).toBeGreaterThan(west(full))
    expect(ownMap.nodes).toEqual(full.nodes)
    expect([ownMap.license, ownMap.id]).toEqual(['CC-BY-SA-4.0', fileId('longdong', 'map')])
  })

  it('套上地圖編輯的最新版本：區域、岩壁（空的就不畫）、步道；t 是最後一次編輯', () => {
    const ring: [number, number][] = [[25.11, 121.92], [25.11, 121.921], [25.111, 121.921]]
    const line: [number, number][] = [[25.112, 121.921], [25.1121, 121.9211]]
    const shapes: MapShapes = {
      areas: { 'school-gate': [ring] },
      walls: { 'longdong/school-gate-ppyc81': [line], 'longdong/school-gate-g6qhy9': [] },
      lines: { trails: [line] },
      versions: { trails: [{ id: 'v', uid: 'u', createdAt: 1893456000000, shapes: [line] }] },
    }
    const map = longdongMap(dataset, shapes, false)
    expect(validate(map)).toEqual([])
    const lngLat = line.map(([lat, lng]) => [lng, lat])
    const of = (code: string) => map.marks!.find((m) => m.node === globalId(code))?.geometry.coordinates
    expect(of('longdong/school-gate')).toEqual([[[...ring.map(([lat, lng]) => [lng, lat]), [ring[0][1], ring[0][0]]]]])
    expect(of('longdong/school-gate-ppyc81')).toEqual([lngLat])
    expect(of('longdong/school-gate-g6qhy9')).toBeUndefined()
    expect(map.marks!.find((m) => m.props?.kind === 'trail')!.geometry.coordinates).toEqual([lngLat])
    expect(map.t).toBe(1893456000000)
  })
})

describe('Topo', () => {
  const input: TopoInput = {
    key: '-P4xMGWX39F7Iokg754u',
    sectorName: { zh: '騙人的牆' },
    createdAt: 1793104618291,
    width: 2560,
    height: 1711,
    license: 'CC-BY-SA-4.0',
    attribution: 'KK',
    origin: 'self',
    shot: { exifLat: 25.1129, exifLng: 121.9215, exifHeading: 300, exifHeadingRef: 'M' },
    image: { ext: 'webp', sha256: 'a'.repeat(64) },
    edit: { createdAt: 1793200000000, marks: { 'longdong/jag38d': { line: [[5000, 9000], [5200, 1000]], bolts: { B01: [5100, 7000] } } }, crop: { x: 1000, y: 0, w: 8000, h: 9000 }, editors: ['KK', 'Alice'] },
  }

  it('照片畫面與線段圖層通過官方驗證；組合把兩份都列進去', () => {
    const { view, layer } = topo(input)
    expect(validate(view)).toEqual([])
    expect(validate(layer!)).toEqual([])
    const set = areaSet(dataset, schoolGate, { topos: [{ view, layer }] }, common)
    expect(validate(set)).toEqual([])
    expect(set.items!.map((i) => i.href)).toEqual([`${view.id}.json`, `${layer!.id}.json`])
  })

  it('照片放在畫面旁邊（相對路徑），署名照存；圖層疊在畫面上，署名是所有改過的人；磁北朝向換成正北', () => {
    const { view, layer } = topo(input) as { view: PhotoView; layer: Layer }
    expect(view.href).toBe(`${view.id}.webp`)
    expect([view.attribution, view.origin, view.license, view.sha256]).toEqual(['KK', 'self', 'CC-BY-SA-4.0', 'a'.repeat(64)])
    expect(view.camera!.heading).toBeCloseTo(294.9)
    expect([layer.on, layer.href, layer.attribution]).toEqual([view.id, `${view.id}.json`, 'KK、Alice'])
    expect(layer.marks![0].node).toBe(globalId('longdong/jag38d'))
  })

  it('沒有版本時只有照片畫面', () => {
    const { edit: _, ...noEdit } = input
    expect(topo(noEdit).layer).toBeUndefined()
  })

  it('區域的組合列出 Topo', () => {
    const { view } = topo(input)
    expect(areaSet(dataset, schoolGate, { topos: [{ view }] }, common).items!.map((i) => i.id)).toEqual([view.id])
  })
})

describe('龍洞地圖（地圖截圖基準的 v2 地圖畫面）', () => {
  it('通過官方驗證；陸地與建物裁切合併成一塊，區域、分區、救援點都在', () => {
    const map = longdongMap(dataset)
    expect(validate(map)).toEqual([])
    const kinds = map.marks!.flatMap((m) => (m.node ? [] : [m.props!.kind]))
    expect(kinds).toEqual(['land', 'building', 'parking', 'highway', 'highway', 'tunnel', 'road', 'road', 'trail', 'trail'])
    const types = (t: string) => map.nodes!.filter((n) => n.type === t).length
    expect([types('area'), types('sector') > 0, map.nodes!.filter((n) => n.props?.kind === 'rescue').length]).toEqual([9, true, 14])
  })

  it('基準裡的 longdong-map.json 是目前的轉換結果', () => {
    expect(read('tests/fixtures/map-shots/longdong-map.json')).toEqual(JSON.parse(JSON.stringify(longdongMap(dataset))))
  })
})
