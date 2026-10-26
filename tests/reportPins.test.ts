import { describe, expect, it } from 'vitest'
import { parseReportPins, pinsForArea } from '../src/map/reportPins'
import { project } from '../src/map/mapData'

const feature = (lng: number, lat: number, time: string, props: object = {}) => ({
  type: 'Feature',
  properties: { note: ' 牆底 ', accuracy: 12, time, ...props },
  geometry: { type: 'Point', coordinates: [lng, lat] },
})
const upload = (...features: object[]) => ({ geojson: JSON.stringify({ type: 'FeatureCollection', features }) })

describe('回報的位置與說明（修改地圖時當參考）', () => {
  it('只留位置、說明、回報的是哪裡；不留是誰、什麼時候', () => {
    const pins = parseReportPins({
      alice: { u1: upload(feature(121.9231, 25.1124, '2026-10-26T01:00:00Z', { picked: [121.9232, 25.1125], target: { kind: 'start', areaId: 'longdong/school-gate', sectorId: 's1', routeId: 'r1' } })) },
    })
    expect(pins).toEqual([
      { id: '0', at: [25.1124, 121.9231], picked: [25.1125, 121.9232], manual: false, accuracy: 12, note: '牆底', target: { kind: 'start', areaId: 'longdong/school-gate', sectorId: 's1', routeId: 'r1' } },
    ])
    const text = JSON.stringify(pins)
    expect(text).not.toContain('alice')
    expect(text).not.toContain('2026')
  })

  it('同一支手機的每次上傳都含之前的記錄：依帳號、時間、位置去掉重複；不同帳號的不算重複', () => {
    const a = feature(121.9231, 25.1124, '2026-10-26T01:00:00Z')
    const b = feature(121.9235, 25.1128, '2026-10-26T02:00:00Z', { manual: true })
    const pins = parseReportPins({
      alice: { u1: upload(a), u2: upload(a, b) },
      bob: { u1: upload(a) },
    })
    expect(pins).toHaveLength(3)
    expect(pins.filter((p) => p.manual)).toHaveLength(1)
  })

  it('壞掉的上傳、不是點的資料略過；編號依時間排', () => {
    const pins = parseReportPins({
      alice: { bad: { geojson: '{oops' }, u1: upload(feature(121.9235, 25.1128, '2026-10-26T02:00:00Z', { note: 'later' }), feature(121.9231, 25.1124, '2026-10-26T01:00:00Z', { note: 'first' }), { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }) },
    })
    expect(pins.map((p) => p.note)).toEqual(['first', 'later'])
  })
})

describe('一個區域相關的回報', () => {
  const rings: [number, number][][] = [[project([25.113, 121.922]), project([25.113, 121.924]), project([25.111, 121.924]), project([25.111, 121.922]), project([25.113, 121.922])]]
  const pin = (lat: number, lng: number, target?: object) => ({ id: '', at: [lat, lng] as [number, number], manual: false, note: '', target: target as never })
  const inside = pin(25.112, 121.923)
  const outside = pin(25.1, 121.93)

  it('沒指定回報的是哪裡時，看位置在不在區域裡', () => {
    expect(pinsForArea([inside, outside], { key: 'school-gate', rings })).toEqual([inside])
  })

  it('有指定時，看指定的區域，不管位置', () => {
    const mine = pin(25.1, 121.93, { kind: 'base', areaId: 'longdong/school-gate', sectorId: 's1' })
    const other = pin(25.112, 121.923, { kind: 'base', areaId: 'longdong/clocktower', sectorId: 's2' })
    expect(pinsForArea([mine, other], { key: 'school-gate', rings })).toEqual([mine])
  })

  it('分區：只留這個分區的，加上沒指定分區、位置在區域裡的', () => {
    const mine = pin(25.1, 121.93, { kind: 'base', areaId: 'longdong/school-gate', sectorId: 's1' })
    const sibling = pin(25.112, 121.923, { kind: 'base', areaId: 'longdong/school-gate', sectorId: 's2' })
    expect(pinsForArea([mine, sibling, inside, outside], { key: 'school-gate', sectorId: 's1', rings })).toEqual([mine, inside])
  })
})
