import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validate, type Layer, type MapView, type PhotoView } from '../vendor/climbio-format/format'
import { areaSet, cragSet, fileId, globalId, topo, wallMap, type TopoInput } from '../scripts/lib/climbio'
import type { Dataset } from '../src/data/schema'
import type { LatLng } from '../src/geo'

const read = <T>(path: string) => JSON.parse(readFileSync(resolve(__dirname, '..', path), 'utf8')) as T
const dataset = read<Dataset>('public/data/longdong.json')
const common = { dataUrl: 'https://longdong.web.app/data/longdong.json' }
const walls: Record<string, LatLng[][]> = Object.fromEntries(
  read<{ features: { properties: { sector: string }; geometry: { coordinates: [number, number][][] } }[] }>('public/rescue/walls.geojson').features.map((f) => [
    f.properties.sector,
    f.geometry.coordinates.map((l) => l.map(([lng, lat]): LatLng => [lat, lng])),
  ]),
)
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
    expect(validate(cragSet(dataset, common))).toEqual([])
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
    expect(route.props).toMatchObject({ grade: { yds: jag38d.grade }, style: jag38d.type, 'longdong:safety': jag38d.safety, 'longdong:bolts': jag38d.bolts })
  })

  it('岩場的組合列出每個區域的組合', () => {
    const doc = cragSet(dataset, common)
    expect(doc.items!.map((i) => i.id)).toEqual(dataset.areas.map((a) => fileId(a.id, 'set')))
    expect(doc.items!.every((i) => i.href === `${i.id}.json`)).toBe(true)
  })
})

describe('岩壁地圖', () => {
  it('「緯度,經度」換成經度在前，每個有岩壁的分區一個標註，通過官方驗證', () => {
    const map = wallMap(dataset, schoolGate, walls, 1)!
    expect(validate(map)).toEqual([])
    const sector = schoolGate.sectors.find((s) => walls[s.id])!
    const mark = map.marks!.find((m) => m.node === globalId(sector.id))!
    const [lat, lng] = walls[sector.id][0][0]
    expect((mark.geometry.coordinates as number[][][])[0][0]).toEqual([lng, lat])
  })

  it('整區都沒有岩壁就沒有地圖', () => {
    expect(wallMap(dataset, schoolGate, {}, 1)).toBeUndefined()
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

  it('區域的組合列出地圖與 Topo', () => {
    const map = wallMap(dataset, schoolGate, walls, 1) as MapView
    const { view } = topo(input)
    expect(areaSet(dataset, schoolGate, { map, topos: [{ view }] }, common).items!.map((i) => i.id)).toEqual([map.id, view.id])
  })
})
