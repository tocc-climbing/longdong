import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { MAX_REMOVALS_PER_IMPORT, checkRouteIds, type PublishedRoute } from '../scripts/lib/ids'
import { ROUTE_ID, parseAreaSheet } from '../scripts/lib/parse'

const appsScript = createRequire(import.meta.url)('../apps-script/RouteIds.gs') as {
  randomId: () => string
  newUniqueId: (used: Record<string, boolean>) => string
  isRouteRow: (no: string, name: string) => boolean
  resolveRowId: (current: string, candidates: string[], isUsed: (id: string) => boolean) => { id: string | null }
  normalizeNumber: (raw: string) => string
  zhName: (raw: string) => string
  parsePublished: (status: number, text: string) => Record<string, string[]>
  PUBLISHED_URL: string
}

describe('Apps Script', () => {
  it('產生的 ID 符合匯入程式的格式', () => {
    for (let i = 0; i < 500; i++) expect(appsScript.randomId()).toMatch(ROUTE_ID)
  })

  it('不會產生重複的 ID', () => {
    const used: Record<string, boolean> = {}
    const ids = Array.from({ length: 2000 }, () => appsScript.newUniqueId(used))
    expect(new Set(ids).size).toBe(2000)
  })

  it('只替路線列產生 ID', () => {
    expect(appsScript.isRouteRow('# 523', 'V槽')).toBe(true)
    expect(appsScript.isRouteRow('314.1', '左翼')).toBe(true)
    expect(appsScript.isRouteRow('', '')).toBe(false)
    expect(appsScript.isRouteRow('316-TW', '316 - 台製')).toBe(false)
  })
})

describe('Apps Script 讀取已發布的網站資料', () => {
  it('網址指向正式站（firebase.json 的 hosting.site）', () => {
    const site = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).hosting.site
    expect(appsScript.PUBLISHED_URL).toBe(`https://${site}.web.app/data/longdong.json`)
  })

  it('讀不到或讀不懂時丟出錯誤，不當成沒有已發布的 ID', () => {
    expect(() => appsScript.parsePublished(404, 'Not Found')).toThrow(/讀不到已發布的網站資料.*HTTP 404/)
    expect(() => appsScript.parsePublished(200, '<html>')).toThrow(/內容不是 JSON/)
  })

  it('網站資料還是舊規則的 ID 時，沒有可找回的 ID', () => {
    expect(appsScript.parsePublished(200, JSON.stringify({ idSource: 'legacy', areas: [] }))).toEqual({})
  })

  it('建立對照', () => {
    const data = { idSource: 'sheet', areas: [{ name: { zh: '後門' }, sectors: [{ routes: [{ id: 'longdong/7kq2mx', number: '1', name: { zh: 'ㄅ' } }] }] }] }
    expect(appsScript.parsePublished(200, JSON.stringify(data))['full|後門|1|ㄅ']).toEqual(['7kq2mx'])
  })
})

describe('Apps Script 還原 ID', () => {
  const none = () => false

  it('改掉或清除時，還原成編輯前的值', () => {
    expect(appsScript.resolveRowId('zzzzzz', ['7kq2mx'], none)).toEqual({ id: '7kq2mx' })
    expect(appsScript.resolveRowId('', ['7kq2mx'], none)).toEqual({ id: '7kq2mx' })
  })

  it('沒有編輯前的值時，用已發布資料中的 ID', () => {
    expect(appsScript.resolveRowId('', ['h3w9tc'], none)).toEqual({ id: 'h3w9tc' })
  })

  it('候選 ID 已被別列使用時不採用（例如複製整列新增路線）', () => {
    const used = (id: string) => id === '7kq2mx'
    expect(appsScript.resolveRowId('7kq2mx', [], used)).toEqual({ id: null })
    expect(appsScript.resolveRowId('', ['7kq2mx', 'h3w9tc'], used)).toEqual({ id: 'h3w9tc' })
  })

  it('沒有候選時保留格式正確的現有值，否則產生新的', () => {
    expect(appsScript.resolveRowId('7kq2mx', [], none)).toEqual({ id: '7kq2mx' })
    expect(appsScript.resolveRowId('ABC', [], none)).toEqual({ id: null })
  })

  it('編號與名稱的正規化和匯入程式一致', () => {
    expect(appsScript.normalizeNumber('# 523')).toBe('523')
    expect(appsScript.normalizeNumber('0.00')).toBe('')
    expect(appsScript.zhName('⽯花凍 | P1\nAgar Jelly | P1')).toBe('石花凍 | P1')
    expect(appsScript.zhName('第一洞內\n南面\nInterior\nSouth End')).toBe('第一洞內 南面')
    expect(appsScript.zhName('Sorry Erica')).toBe('Sorry Erica')
  })
})

describe('parseAreaSheet 讀取「路線ID」欄', () => {
  const header = ['分區', '路線編號', '路線名稱', '難度', '路線種類', '高度', '首攀', '首攀日期', '路線資訊描述', '安全評級',
    'B01', 'A01', 'Anchor 配件', 'Bolt 統計', '路線狀態', '日期', '備註', '路線ID']
  const csv = (rows: string[][]) => Papa.unparse([['  後門\n  Back Door'], header, ...rows])
  const r = (no: string, name: string, id: string) => {
    const row = header.map(() => '')
    row[1] = no
    row[2] = name
    row[17] = id
    return row
  }
  const opts = { cragId: 'longdong', areaId: 'back-door', expectedZh: '後門' }

  it('用「路線ID」欄當 ID', () => {
    const area = parseAreaSheet(csv([r('# 1', 'ㄅ', '7kq2mx'), r('# 0', '私設固定點', 'h3w9tc')]), opts)
    expect(area.hasIdColumn).toBe(true)
    expect(area.idErrors).toEqual([])
    expect(area.sectors.flatMap((s) => s.routes.map((x) => x.id))).toEqual(['longdong/7kq2mx', 'longdong/h3w9tc'])
  })

  it('缺 ID 或格式錯誤時回報', () => {
    const area = parseAreaSheet(csv([r('# 1', 'ㄅ', ''), r('# 2', 'ㄆ', 'ABC')]), opts)
    expect(area.idErrors).toHaveLength(2)
    expect(area.idErrors[0]).toMatch(/缺少路線ID/)
    expect(area.idErrors[1]).toMatch(/格式不對/)
  })
})

describe('checkRouteIds', () => {
  const pr = (id: string, number: string, name = `路線${number}`, areaId = 'longdong/back-door'): PublishedRoute => ({
    id: `longdong/${id}`, areaId, number, name,
  })
  const prev = (routes: PublishedRoute[]) => ({ idSource: 'sheet' as const, routes })

  it('ID 不可重複', () => {
    const { errors } = checkRouteIds('sheet', [pr('aaaaaa', '1', '甲'), pr('aaaaaa', '2', '乙')], undefined)
    expect(errors).toEqual(['路線ID longdong/aaaaaa 重複：甲、乙'])
  })

  it('從舊規則切換時不檢查消失', () => {
    const old = { idSource: 'legacy' as const, routes: [{ ...pr('x', '523'), id: 'longdong/523' }] }
    expect(checkRouteIds('sheet', [pr('7kq2mx', '523')], old)).toEqual({ errors: [], removed: [] })
  })

  it('刪除路線直接放行，並列出刪掉了哪些', () => {
    const { errors, removed } = checkRouteIds('sheet', [pr('7kq2mx', '1')], prev([pr('7kq2mx', '1'), pr('h3w9tc', '2')]))
    expect(errors).toEqual([])
    expect(removed.map((r) => r.id)).toEqual(['longdong/h3w9tc'])
  })

  it('改名、改編號不影響（ID 還在）', () => {
    const { errors, removed } = checkRouteIds('sheet', [pr('7kq2mx', '610', '新名字')], prev([pr('7kq2mx', '523', '舊名字')]))
    expect(errors).toEqual([])
    expect(removed).toEqual([])
  })

  it('同一條路線的 ID 被改掉時擋下，並提示原本的 ID', () => {
    const { errors } = checkRouteIds('sheet', [pr('zzzzzz', '1', 'ㄅ')], prev([pr('ygapmg', '1', 'ㄅ')]))
    expect(errors).toEqual(['#1 ㄅ 的路線ID 從 ygapmg 變成 zzzzzz，請在 Sheet 把它改回 ygapmg'])
  })

  it('一次消失太多條視為誤刪，列入 allowRemoved 則放行', () => {
    const many = Array.from({ length: MAX_REMOVALS_PER_IMPORT + 1 }, (_, i) => pr(`gone${'abcdefghjkmn'[i]}a`, String(100 + i)))
    const { errors } = checkRouteIds('sheet', [], prev(many))
    expect(errors[0]).toMatch(/疑似誤刪/)
    expect(checkRouteIds('sheet', [], prev(many), many.map((r) => r.id)).errors).toEqual([])
  })
})
