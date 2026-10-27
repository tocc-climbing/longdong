import { describe, expect, it } from 'vitest'
import { decodePins, mergePins, pinsForArea, pinsFromGeoJSON, type ReportPin } from '../src/map/reportPins'
import { project } from '../src/map/mapData'

const feature = (lng: number, lat: number, time: string, props: object = {}) => ({
  type: 'Feature',
  properties: { note: ' 牆底 ', accuracy: 12.4, time, ...props },
  geometry: { type: 'Point', coordinates: [lng, lat] },
})
const geojson = (...features: object[]) => JSON.stringify({ type: 'FeatureCollection', features })

describe('回報的去識別副本', () => {
  it('只留位置、說明、誤差、回報的是哪裡；不留帳號、時間', async () => {
    const [[key, pin]] = await pinsFromGeoJSON(
      geojson(feature(121.9231, 25.1124, '2026-10-26T01:00:00Z', { picked: [121.9232, 25.1125], target: { kind: 'start', areaId: 'longdong/school-gate', sectorId: 'longdong/s1', routeId: 'longdong/r1' } })),
      'alice-uid',
    )
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(pin).toEqual({ lat: 25.1124, lng: 121.9231, note: '牆底', accuracy: 12, picked: '25.112500,121.923200', kind: 'start', area: 'longdong/school-gate', sector: 'longdong/s1', route: 'longdong/r1' })
    const text = JSON.stringify([key, pin])
    expect(text).not.toContain('alice')
    expect(text).not.toContain('2026')
  })

  it('同一筆回報不管上傳幾次都是同一個代碼；不同的人、時間、位置是不同的代碼', async () => {
    const a = feature(121.9231, 25.1124, '2026-10-26T01:00:00Z')
    const b = feature(121.9235, 25.1128, '2026-10-26T02:00:00Z', { manual: true })
    const first = await pinsFromGeoJSON(geojson(a), 'alice')
    const second = await pinsFromGeoJSON(geojson(a, b), 'alice')
    expect(second[0][0]).toBe(first[0][0])
    expect(new Set(second.map(([k]) => k)).size).toBe(2)
    expect((await pinsFromGeoJSON(geojson(a), 'bob'))[0][0]).not.toBe(first[0][0])
    expect((await pinsFromGeoJSON(geojson(feature(121.9231, 25.1124, '2026-10-26T01:00:01Z')), 'alice'))[0][0]).not.toBe(first[0][0])
  })

  it('skip：只送上次上傳之後新增的；手動回報沒有誤差；壞掉的資料略過', async () => {
    const entries = await pinsFromGeoJSON(geojson(feature(121.9231, 25.1124, 't1'), feature(121.9235, 25.1128, 't2', { manual: true, accuracy: undefined }), { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }), 'alice', 1)
    expect(entries).toHaveLength(1)
    expect(entries[0][1]).toEqual({ lat: 25.1128, lng: 121.9235, note: '牆底', manual: true })
    expect(await pinsFromGeoJSON('{oops', 'alice')).toEqual([])
  })

  it('讀回來：編號依代碼排；沒有說明的也留著', () => {
    const pins = decodePins({
      b: { lat: 25.1128, lng: 121.9235, manual: true },
      a: { lat: 25.1124, lng: 121.9231, note: '牆底', accuracy: 12, picked: '25.112500,121.923200', kind: 'base', area: 'longdong/school-gate', sector: 'longdong/s1' },
    })
    expect(pins.map((p) => p.id)).toEqual(['0', '1'])
    expect(pins[0]).toEqual({ id: '0', at: [25.1124, 121.9231], picked: [25.1125, 121.9232], manual: false, accuracy: 12, note: '牆底', target: { kind: 'base', areaId: 'longdong/school-gate', sectorId: 'longdong/s1', routeId: undefined } })
    expect(pins[1]).toMatchObject({ manual: true, note: '', target: undefined })
  })
})

describe('一個區域相關的回報', () => {
  const rings: [number, number][][] = [[project([25.113, 121.922]), project([25.113, 121.924]), project([25.111, 121.924]), project([25.111, 121.922]), project([25.113, 121.922])]]
  const pin = (lat: number, lng: number, target?: object): ReportPin => ({ id: '', at: [lat, lng], manual: false, note: '', target: target as never })
  const inside = pin(25.112, 121.923)
  const outside = pin(25.1, 121.93)

  it('沒指定回報的是哪裡時，看位置在不在區域裡或附近（剛好在範圍外的回報正是編輯範圍要參考的）', () => {
    expect(pinsForArea([inside, outside], { key: 'school-gate', rings })).toEqual([inside])
    // 範圍的西邊界在 121.922：往西約 30 公尺（0.0003 度）在附近，約 150 公尺不算
    const nearOutside = pin(25.112, 121.9217)
    const farOutside = pin(25.112, 121.9205)
    expect(pinsForArea([nearOutside, farOutside], { key: 'school-gate', rings })).toEqual([nearOutside])
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

describe('合併同一個點附近的回報', () => {
  /** 往東偏 dx 公尺 */
  const at = (dx: number): [number, number] => [25.112, 121.923 + dx / 100800]
  const pin = (dx: number, note: string, extra: Partial<ReportPin> = {}): ReportPin => ({ id: '', at: at(dx), manual: false, accuracy: 10, note, ...extra })

  it('8 公尺內的合併：位置取平均，相同的說明合在一起算有幾筆，多的在前面', () => {
    const [g] = mergePins([pin(0, '牆底'), pin(3, '牆底'), pin(5, '步道岔路'), pin(2, '牆底', { accuracy: 6 }), pin(4, '')])
    expect(g.count).toBe(5)
    expect(g.notes).toEqual([
      { text: '牆底', count: 3 },
      { text: '步道岔路', count: 1 },
    ])
    expect(g.blank).toBe(1)
    expect(g.accuracy).toBe(6)
    expect(g.manual).toBe(false)
  })

  it('離得遠的不合併；同一個位置不同路線的起攀點不合併', () => {
    expect(mergePins([pin(0, 'a'), pin(30, 'b')])).toHaveLength(2)
    const t = (routeId: string) => ({ kind: 'start' as const, areaId: 'longdong/x', sectorId: 'longdong/s', routeId })
    expect(mergePins([pin(0, 'a', { target: t('r1') }), pin(1, 'a', { target: t('r2') })])).toHaveLength(2)
    expect(mergePins([pin(0, 'a', { target: t('r1') }), pin(1, 'b', { target: t('r1') })])).toHaveLength(1)
  })

  it('菱形（回報者點的位置）取平均；全部手動才算手動', () => {
    const [g] = mergePins([pin(0, 'a', { manual: true, picked: [25.1121, 121.9231] }), pin(2, 'a', { manual: true, picked: [25.1123, 121.9233] })])
    expect(g.manual).toBe(true)
    expect(g.picked?.[0]).toBeCloseTo(25.1122, 6)
    expect(g.picked?.[1]).toBeCloseTo(121.9232, 6)
  })
})
