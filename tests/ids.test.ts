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
  resolveRowId: (
    current: string,
    candidates: string[],
    isUsed: (id: string) => boolean,
    currentIsPublished: boolean,
  ) => { id: string | null }
  normalizeNumber: (raw: string) => string
  zhName: (raw: string) => string
  parsePublished: (status: number, text: string) => Record<string, string[]>
  buildPublishedIndex: (data: unknown) => Record<string, string[]>
  repairRows: (
    sheet: FakeSheet,
    layout: typeof LAYOUT,
    rows: { from: number; to: number } | null,
    oldValue: string | null,
    published: Record<string, string[]>,
  ) => { restored: number; created: number }
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

/* 模擬 Google Sheet：第 1 列是欄位標題，之後每列為 [分區, 路線編號, 路線名稱, 路線ID] */
const LAYOUT = { headerRow: 1, numberCol: 2, nameCol: 3, idCol: 4 }
type FakeSheet = ReturnType<typeof fakeSpreadsheet>['sheets'][number]

function fakeSpreadsheet(tabs: Record<string, string[][]>) {
  const ss = { getSheets: () => sheets }
  const sheets = Object.entries(tabs).map(([name, rows], i) => {
    const grid = [['分區', '路線編號', '路線名稱', '路線ID'], ...rows.map((r) => [...r])]
    return {
      grid,
      getName: () => name,
      getSheetId: () => i,
      getParent: () => ss,
      getLastRow: () => grid.length,
      getMaxRows: () => grid.length,
      getLastColumn: () => 4,
      getRange: (row: number, col: number, numRows = 1, numCols = 1) => ({
        getDisplayValues: () =>
          Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => grid[row - 1 + r][col - 1 + c])),
        setValues: (values: string[][]) =>
          values.forEach((line, r) => line.forEach((v, c) => (grid[row - 1 + r][col - 1 + c] = v))),
      }),
    }
  })
  return { sheets }
}

/** 已發布資料的對照：[分頁, 編號, 名稱, ID] */
function publishedIndex(routes: [string, string, string, string][]) {
  const areas = [...new Set(routes.map((r) => r[0]))].map((zh) => ({
    name: { zh },
    sectors: [{ routes: routes.filter((r) => r[0] === zh).map(([, number, name, id]) => ({ id: `longdong/${id}`, number, name: { zh: name } })) }],
  }))
  return appsScript.buildPublishedIndex({ idSource: 'sheet', areas })
}

const ids = (sheet: FakeSheet) => sheet.grid.slice(1).map((r) => r[3])

describe('Apps Script 編輯「路線ID」欄', () => {
  it('維護者依匯入錯誤訊息把 ID 改回原本的，接受而不還原', () => {
    // 已發布為 ygapmg，Sheet 上被改成 zzzzzz；維護者在儲存格打回 ygapmg（編輯前的值是 zzzzzz）
    const { sheets } = fakeSpreadsheet({ 後門: [['', '# 1', 'ㄅ', 'ygapmg']] })
    const result = appsScript.repairRows(sheets[0], LAYOUT, { from: 2, to: 2 }, 'zzzzzz', publishedIndex([['後門', '1', 'ㄅ', 'ygapmg']]))
    expect(ids(sheets[0])).toEqual(['ygapmg'])
    expect(result).toEqual({ restored: 0, created: 0 })
  })

  it('打字改掉 ID 時還原成編輯前的值', () => {
    const { sheets } = fakeSpreadsheet({ 後門: [['', '# 1', 'ㄅ', 'abcdef']] })
    appsScript.repairRows(sheets[0], LAYOUT, { from: 2, to: 2 }, 'ygapmg', publishedIndex([['後門', '1', 'ㄅ', 'ygapmg']]))
    expect(ids(sheets[0])).toEqual(['ygapmg'])
  })
})

describe('Apps Script「補上缺少的 ID」', () => {
  const fill = (rows: string[][], published: [string, string, string, string][]) => {
    const { sheets } = fakeSpreadsheet({ 後門: rows })
    const result = appsScript.repairRows(sheets[0], LAYOUT, null, null, publishedIndex(published))
    return { ids: ids(sheets[0]), result }
  }

  it('新路線不會搶走改了編號的路線原本的 ID，結果與列的順序無關', () => {
    // 甲從 #5 改成 #6（ID aaaaaa 不變），之後在 #5 新增乙
    const published: [string, string, string, string][] = [['後門', '5', '甲', 'aaaaaa']]
    const newRoute = ['', '# 5', '乙', '']
    const renumbered = ['', '# 6', '甲', 'aaaaaa']
    for (const rows of [[newRoute, renumbered], [renumbered, newRoute]]) {
      const { ids: out, result } = fill(rows, published)
      expect(out[rows.indexOf(renumbered)]).toBe('aaaaaa')
      expect(out[rows.indexOf(newRoute)]).toMatch(ROUTE_ID)
      expect(out[rows.indexOf(newRoute)]).not.toBe('aaaaaa')
      expect(result).toEqual({ restored: 0, created: 1 })
    }
  })

  it('複製整列造成的重複 ID，原路線保留、複製的換新，與列的順序無關', () => {
    const published: [string, string, string, string][] = [['後門', '5', '甲', 'aaaaaa']]
    const original = ['', '# 5', '甲', 'aaaaaa']
    const copy = ['', '# 7', '丙', 'aaaaaa']
    for (const rows of [[original, copy], [copy, original]]) {
      const { ids: out } = fill(rows, published)
      expect(out[rows.indexOf(original)]).toBe('aaaaaa')
      expect(out[rows.indexOf(copy)]).toMatch(ROUTE_ID)
      expect(out[rows.indexOf(copy)]).not.toBe('aaaaaa')
    }
  })

  it('現有 ID 沒發布過、而這條路線已發布的 ID 沒被使用時，找回已發布的 ID', () => {
    expect(fill([['', '# 5', '甲', 'bbbbbb']], [['後門', '5', '甲', 'aaaaaa']]).ids).toEqual(['aaaaaa'])
  })

  it('格式正確、不重複的現有 ID 保留', () => {
    expect(fill([['', '# 5', '甲', 'bbbbbb'], ['', '# 6', '乙', 'cccccc']], []).ids).toEqual(['bbbbbb', 'cccccc'])
  })
})

describe('Apps Script 還原 ID', () => {
  const none = () => false

  it('改掉或清除時，還原成編輯前的值', () => {
    expect(appsScript.resolveRowId('zzzzzz', ['7kq2mx'], none, false)).toEqual({ id: '7kq2mx' })
    expect(appsScript.resolveRowId('', ['7kq2mx'], none, false)).toEqual({ id: '7kq2mx' })
  })

  it('沒有編輯前的值時，用已發布資料中的 ID', () => {
    expect(appsScript.resolveRowId('', ['h3w9tc'], none, false)).toEqual({ id: 'h3w9tc' })
  })

  it('候選 ID 已被別列使用時不採用（例如複製整列新增路線）', () => {
    const used = (id: string) => id === '7kq2mx'
    expect(appsScript.resolveRowId('7kq2mx', [], used, false)).toEqual({ id: null })
    expect(appsScript.resolveRowId('', ['7kq2mx', 'h3w9tc'], used, false)).toEqual({ id: 'h3w9tc' })
  })

  it('維護者把 ID 改回已發布的原 ID 時接受，不還原成編輯前的錯誤 ID', () => {
    // 匯入錯誤訊息要維護者「在 Sheet 把它改回 ygapmg」：編輯前的值是錯的新 ID zzzzzz
    expect(appsScript.resolveRowId('ygapmg', ['zzzzzz'], none, true)).toEqual({ id: 'ygapmg' })
    // 已發布的 ID 已被別列使用時不接受
    expect(appsScript.resolveRowId('ygapmg', ['zzzzzz'], (id) => id === 'ygapmg', true)).toEqual({ id: 'zzzzzz' })
  })

  it('沒有候選時保留格式正確的現有值，否則產生新的', () => {
    expect(appsScript.resolveRowId('7kq2mx', [], none, false)).toEqual({ id: '7kq2mx' })
    expect(appsScript.resolveRowId('ABC', [], none, false)).toEqual({ id: null })
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
