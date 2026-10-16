import { describe, expect, it } from 'vitest'
import type { Bolt, Route } from '../src/data/schema'
import { quickdraws, typeText } from '../src/format'
import { translate } from '../src/i18n'
import { en } from '../src/i18n/en'
import { zh } from '../src/i18n/zh'

const tz = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(zh, k, v)
const te = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(en, k, v)

const bolt = (position: string, material = '316-TW'): Bolt => ({ position, material, tests: [] })
const route = (over: Partial<Route>): Route => ({
  id: 'r1', isFixture: false, name: { zh: '測試' }, bolts: [], anchors: [], anchorHardware: [], ...over,
})

describe('quickdraws', () => {
  it('bolt 加 anchor，共用的 bolt 也算', () => {
    const r = route({
      type: 'sport',
      bolts: [bolt('B01', '共用'), bolt('B02', '共用'), ...Array.from({ length: 14 }, (_, i) => bolt(`B${i + 3}`))],
      anchors: [bolt('A01', 'Ti-U'), bolt('A02', 'Ti-U')],
    })
    expect(quickdraws(r)).toBe(18)
    expect(typeText(r, tz)).toBe('18快扣 運攀')
    expect(typeText(r, te)).toBe('18 draws Sport')
  })

  it('無 Anchor、天然固定點不算', () => {
    const r = route({ type: 'sport', bolts: [bolt('B01')], anchors: [bolt('A01', '無 Anchor'), bolt('A02', '天然固定點')] })
    expect(quickdraws(r)).toBe(1)
  })

  it('非運攀或沒有 bolt 時不顯示快扣數', () => {
    expect(typeText(route({ type: 'trad', anchors: [bolt('A01')] }), tz)).toBe('傳攀')
    expect(typeText(route({ type: 'sport' }), tz)).toBe('運攀')
    expect(typeText(route({ isFixture: true }), tz)).toBe('固定點')
  })
})

import { gradeBand } from '../src/format'

describe('gradeBand', () => {
  it('依難度分區', () => {
    expect(gradeBand(36)).toBe('easy') // 5.9
    expect(gradeBand(40)).toBe('g10') // 5.10a
    expect(gradeBand(47)).toBe('g11') // 5.11d
    expect(gradeBand(48)).toBe('g12') // 5.12a
    expect(gradeBand(53)).toBe('g13') // 5.13b
    expect(gradeBand(undefined)).toBeUndefined()
  })
})

import { gradeDistribution } from '../src/format'

describe('gradeDistribution', () => {
  it('依五個區間計數，沒有難度的不算', () => {
    const d = gradeDistribution([{ gradeValue: 30 }, { gradeValue: 36 }, { gradeValue: 41 }, { gradeValue: 55 }, {}])
    expect(d.map((x) => [x.label, x.count])).toEqual([
      ['5.9-', 2],
      ['5.10', 1],
      ['5.11', 0],
      ['5.12', 0],
      ['5.13+', 1],
    ])
  })
})

import { sectorColor, typeSummary } from '../src/format'

describe('typeSummary', () => {
  it('簡化為運攀與傳攀／其他，固定點不計', () => {
    expect(
      typeSummary([{ type: 'sport' }, { type: 'sport' }, { type: 'trad' }, { type: 'boulder' }, { type: 'toprope' }, { isFixture: true }], tz),
    ).toBe('運攀 2 · 傳攀／其他 3')
    expect(typeSummary([{ type: 'trad' }], te)).toBe('Trad/other 1')
    expect(typeSummary([], tz)).toBe('')
  })
})

describe('sectorColor', () => {
  it('依區域色由深到淺', () => {
    expect(sectorColor('#cc0000', 0, 1)).toBe('#cc0000')
    expect(sectorColor('#cc0000', 0, 3)).toBe('#8f0000')
    expect(sectorColor('#cc0000', 2, 3)).toBe('#e37373')
    expect(sectorColor(undefined, 0, 3)).toBeUndefined()
  })
})
