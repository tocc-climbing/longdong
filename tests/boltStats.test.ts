import { describe, expect, it } from 'vitest'
import { boltStats, seriesOf } from '../src/boltStats'
import type { Dataset } from '../src/data/schema'

const bolt = (material: string, installed?: string) => ({ position: 'B01', material, installed, tests: [] })
const route = (bolts: ReturnType<typeof bolt>[], anchors: ReturnType<typeof bolt>[] = []) =>
  ({ id: 'longdong/1', isFixture: false, name: { zh: 'r' }, bolts, anchors, anchorHardware: [] }) as unknown as Dataset['areas'][number]['sectors'][number]['routes'][number]

const dataset = {
  hardware: ['316-TW', 'Ti-ETN', '304-FX', '304-PC', 'Ti-TTG'].map((code) => ({ code, description: code })),
  areas: [
    { id: 'longdong/a', name: { zh: 'A' }, summary: {}, sectors: [{ id: 'longdong/a1', name: { zh: 'A1' }, routes: [route([bolt('316-TW', '2005'), bolt('共用'), bolt('Ti-ETN', '2007-03')], [bolt('無 Anchor'), bolt('316-TW')])] }] },
    { id: 'longdong/b', name: { zh: 'B' }, summary: {}, sectors: [{ id: 'longdong/b1', name: { zh: 'B1' }, routes: [route([bolt('304-FX', '2005'), bolt('304-PC', '2004'), bolt('Ti-TTG', '2007'), bolt('待查')])] }] },
  ],
} as unknown as Dataset

describe('Bolt 統計', () => {
  const s = boltStats(dataset)

  it('只算硬體表裡的材質：共用、無 Anchor、待查不算顆數，待查另外計', () => {
    expect(s.total).toBe(6)
    expect(s.unknown).toBe(1)
    expect(s.dated).toBe(5)
  })

  it('304 各廠牌合併，少見的材質歸到其他', () => {
    expect(seriesOf('304-PC')).toBe('304')
    expect(seriesOf('Ti-TTG')).toBe('other')
    expect(s.counts).toMatchObject({ '316-TW': 2, 'Ti-ETN': 1, '304': 2, other: 1 })
  })

  it('年份從最早到最晚，中間沒有安裝的年份也列出', () => {
    expect(s.years.map((y) => [y.year, y.total])).toEqual([
      [2004, 1],
      [2005, 2],
      [2006, 0],
      [2007, 2],
    ])
  })

  it('各區域與各材質（多到少，含安裝年份範圍）', () => {
    expect(s.areas.map((a) => [a.name.zh, a.total])).toEqual([
      ['A', 3],
      ['B', 3],
    ])
    expect(s.materials[0]).toMatchObject({ code: '316-TW', count: 2, firstYear: 2005, lastYear: 2005 })
  })
})
