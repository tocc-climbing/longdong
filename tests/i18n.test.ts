import { describe, expect, it } from 'vitest'
import { LANGS, detectLang, localName, monthShort, monthTitle, translate } from '../src/i18n'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'
import { zh } from '../src/i18n/zh'

const PACKS = { zh, en, ja }

describe('i18n', () => {
  it('依系統語言偵測：zh、ja 開頭用該語言，其他用英文', () => {
    expect(detectLang(['zh-TW', 'en'])).toBe('zh')
    expect(detectLang(['zh-Hant'])).toBe('zh')
    expect(detectLang(['ja-JP'])).toBe('ja')
    expect(detectLang(['ja'])).toBe('ja')
    expect(detectLang(['en-US', 'zh-TW'])).toBe('en')
    expect(detectLang(['ko'])).toBe('en')
    expect(detectLang([])).toBe('en')
  })

  it('每個語言包的 key 都和中文完全相同，且沒有留空（英文的「日」單位除外）', () => {
    for (const l of LANGS) {
      expect(Object.keys(PACKS[l]).sort()).toEqual(Object.keys(zh).sort())
      const empty = Object.entries(PACKS[l]).filter(([, v]) => v === '').map(([k]) => k)
      expect(empty).toEqual(l === 'en' ? ['me.dayUnit'] : [])
    }
  })

  it('每個語言都有自己的語言名稱（lang.<代碼>），而且各語言包寫法一致', () => {
    for (const l of LANGS) for (const p of LANGS) expect(PACKS[p][`lang.${l}`]).toBe(zh[`lang.${l}`])
  })

  it('變數代入在各語言都保留同一組變數', () => {
    // 用到哪些變數（不計次數：英文單複數的 {n|…|…} 會再引用一次 n）
    const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]))].sort()
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      for (const l of LANGS) expect([l, key, vars(PACKS[l][key])]).toEqual([l, key, vars(zh[key])])
    }
  })

  it('變數代入與英文單複數', () => {
    expect(translate(zh, 'count.routes', { n: 12 })).toBe('12 條路線')
    expect(translate(en, 'count.routes', { n: 12 })).toBe('12 routes')
    expect(translate(ja, 'count.routes', { n: 12 })).toBe('12 ルート')
    expect(translate(en, 'search.results', { n: 1 })).toBe('1 result')
    expect(translate(en, 'search.results', { n: 0 })).toBe('0 results')
    expect(translate(en, 'count.routes', { n: 1 })).toBe('1 route')
    expect(translate(en, 'rating.badgeAria', { avg: '4.0', n: 1 })).toBe('Average 4.0 stars from 1 rating')
    expect(translate(zh, 'search.results', { n: 1 })).toBe('1 條結果')
  })

  it('名稱：英文模式以英文為主；中文與日文以漢字為主，沒有英文名時只有中文', () => {
    expect(localName({ zh: '後門', en: 'Back Door' }, 'en')).toEqual({ main: 'Back Door', sub: '後門' })
    expect(localName({ zh: '後門', en: 'Back Door' }, 'zh')).toEqual({ main: '後門', sub: 'Back Door' })
    expect(localName({ zh: '後門', en: 'Back Door' }, 'ja')).toEqual({ main: '後門', sub: 'Back Door' })
    expect(localName({ zh: '瑩養午餐' }, 'en')).toEqual({ main: '瑩養午餐', sub: undefined })
  })

  it('月份', () => {
    expect(monthTitle('2026-10', 'zh')).toBe('2026 年 10 月')
    expect(monthTitle('2026-10', 'en')).toBe('October 2026')
    expect(monthTitle('2026-10', 'ja')).toBe('2026年10月')
    expect(monthShort('2026-01', 'en')).toBe('Jan')
    expect(monthShort('2026-01', 'ja')).toBe('1月')
  })
})
