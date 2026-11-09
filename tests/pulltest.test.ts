import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { Bolt, Dataset, Route } from '../src/data/schema'
import { approvedSummary, counts, missingResults, newRouteEntry, photosToUpload, restPass, testable, toRecord, type Outing, type StoredPullTest } from '../src/pulltest/model'
import { indexDataset } from '../src/data/dataset'
import { addPhoto, createOuting, currentState, deleteOuting, photosOf, recordRoute, refresh, saveOuting } from '../src/pulltest/store'
import { today } from '../src/personal/model'

const bolt = (position: string, material: string): Bolt => ({ position, material, tests: [] })
const route = (id: string, bolts: Bolt[], anchors: Bolt[] = []): Route => ({
  id, isFixture: false, name: { zh: id }, bolts, anchors, anchorHardware: [],
})

describe('拉測表單的路線', () => {
  const r = route('longdong/aaaaaa', [bolt('B01', '316-TW'), bolt('B02', 'Ti-U'), bolt('B03', '共用'), bolt('B04', '天然固定點')], [bolt('A01', '316-TW'), bolt('A02', '無 Anchor')])

  it('共用、沒有 anchor、天然固定點不列出，其他依 bolt、anchor 順序', () => {
    expect(testable(r).map((b) => b.position)).toEqual(['B01', 'B02', 'A01'])
  })

  it('鈦材質預設免測，其他空白', () => {
    expect(newRouteEntry(r).bolts).toEqual({ B01: {}, B02: { result: 'exempt' }, A01: {} })
  })

  it('其餘全部合格：只填空白的，已填的不變', () => {
    const e = newRouteEntry(r)
    e.bolts.A01 = { result: 'fail' }
    expect(restPass(e).bolts).toEqual({ B01: { result: 'pass' }, B02: { result: 'exempt' }, A01: { result: 'fail' } })
  })

  it('統計：實測是合格加不合格，免測不算', () => {
    const e = { routeId: 'x', bolts: { B01: { result: 'pass' as const }, B02: { result: 'fail' as const }, B03: { result: 'exempt' as const }, B04: { result: 'untested' as const }, B05: { result: 'cancelled' as const }, B06: {} } }
    expect(counts([e, e])).toEqual({ tested: 4, pass: 2, fail: 2, untested: 2, cancelled: 2 })
  })
})

describe('出勤草稿', () => {
  it('記錄拉測：加進今天的出勤；同一條路線不重複', async () => {
    const a = route('longdong/bbbbbb', [bolt('B01', '316-TW')])
    const b = route('longdong/cccccc', [bolt('B01', '316-TW')])
    const id = await recordRoute(a)
    expect(await recordRoute(b)).toBe(id)
    expect(await recordRoute(a)).toBe(id)
    const { outings } = await read()
    const o = outings.find((x) => x.id === id)!
    expect(o.date).toBe(today())
    expect(o.routes.map((r) => r.routeId)).toEqual(['longdong/bbbbbb', 'longdong/cccccc'])
    await deleteOuting(id)
  })

  it('不是今天的出勤不會被加進去', async () => {
    const old = await createOuting()
    await saveOuting({ ...old, date: '2020-01-01' })
    const id = await recordRoute(route('longdong/dddddd', [bolt('B01', '316-TW')]))
    expect(id).not.toBe(old.id)
    await deleteOuting(id)
    await deleteOuting(old.id)
  })

  it('刪除出勤時照片一起刪掉', async () => {
    const o = await createOuting()
    await addPhoto(o.id, 'longdong/eeeeee', 'B01', new Blob(['x'], { type: 'image/webp' }))
    expect(photosOf(await read(), o.id, 'longdong/eeeeee', 'B01')).toHaveLength(1)
    await deleteOuting(o.id)
    const s = await read()
    expect(s.outings.find((x) => x.id === o.id)).toBeUndefined()
    expect(photosOf(s, o.id, 'longdong/eeeeee', 'B01')).toEqual([])
  })
})

/** 重新讀一次 IndexedDB，回傳快照 */
async function read() {
  await refresh()
  return currentState()
}

describe('上傳的內容', () => {
  const outing: Outing = {
    id: '11111111-1111-4111-8111-111111111111',
    date: '2026-11-09',
    crew: ['甲 / A'],
    createdAt: '',
    updatedAt: '',
    routes: [
      { routeId: 'longdong/aaaaaa', bolts: { B01: { result: 'pass' }, B02: {}, A01: { result: 'fail' } }, note: ' 7.5kN ', anchorHardware: '' },
    ],
  }
  const photos = [
    { id: 'p1', routeId: 'longdong/aaaaaa', position: 'A01', type: 'image/webp' },
    { id: 'p2', routeId: 'longdong/aaaaaa', position: 'B02', type: 'image/jpeg' },
  ]

  it('沒填結果的 bolt 不送；照片掛在它的 bolt 下；備註去掉前後空白，空的不送', () => {
    expect(toRecord(outing, 'u1', photos)).toEqual({
      uid: 'u1',
      date: '2026-11-09',
      crew: ['甲 / A'],
      routes: { 'longdong:aaaaaa': { bolts: { B01: { result: 'pass' }, A01: { result: 'fail', photos: { p1: 'webp' } } }, note: '7.5kN' } },
    })
  })

  it('只上傳有結果的 bolt 的照片，路徑在上傳者自己的資料夾', () => {
    const record = toRecord(outing, 'u1', photos)
    expect(photosToUpload(record, 'u1', outing.id, photos).map((p) => p.path)).toEqual([`pulltests/u1/${outing.id}/p1.webp`])
  })

  it('每條路線至少一顆有結果', () => {
    expect(missingResults(outing)).toEqual([])
    expect(missingResults({ ...outing, routes: [...outing.routes, { routeId: 'longdong/bbbbbb', bolts: { B01: {} } }] })).toEqual(['longdong/bbbbbb'])
  })
})

describe('通過後的摘要', () => {
  const r = route('longdong/aaaaaa', [bolt('B01', '316-TW')], [bolt('A01', 'Ti-U')])
  const data = indexDataset({
    areas: [{ id: 'longdong/clocktower', name: { zh: '鐘塔' }, summary: {}, sectors: [{ id: 'longdong/s', name: { zh: '分區' }, routes: [{ ...r, number: '499', name: { zh: '叢林熱', en: 'Jungle Fever' } }] }] }],
    hardware: [],
  } as unknown as Dataset)
  const stored: StoredPullTest = {
    uid: 'u1', date: '2026-11-09', createdAt: 1, status: 'pending',
    routes: { 'longdong:aaaaaa': { bolts: { B01: { result: 'pass', photos: { p1: 'webp' } }, A01: { result: 'exempt' } }, note: 'n' } },
  }

  it('帶上區域、編號、名稱與材質，不含照片', () => {
    expect(approvedSummary(stored, data)).toEqual({
      date: '2026-11-09',
      routes: { 'longdong:aaaaaa': { area: '鐘塔', number: '499', name: '叢林熱', bolts: { B01: { result: 'pass', material: '316-TW' }, A01: { result: 'exempt', material: 'Ti-U' } }, note: 'n' } },
    })
  })

  it('路線已不在資料裡時不能通過', () => {
    expect(approvedSummary({ ...stored, routes: { 'longdong:zzzzzz': stored.routes['longdong:aaaaaa'] } }, data)).toBeUndefined()
  })
})
