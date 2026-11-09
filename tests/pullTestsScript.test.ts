import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * apps-script/PullTests.gs 的純函式（找位置、合併日期、改公式範圍）。
 * 版面依 2026-11-09 讀到的 TOCC 拉測工作紀錄「2026」分頁與路線資料 Sheet。
 */
const ctx = createContext({})
runInContext(readFileSync('apps-script/PullTests.gs', 'utf8'), ctx)
type Fns = {
  findMonth: (display: string[], month: string) => { marker: number; total: number } | null
  dayInsertRow: (raw: unknown[], marker: number, total: number, date: Date) => number
  newMonthRow: (display: string[], month: string) => number | null
  totalFormulas: (formulas: string[][], first: number, last: number) => string[][]
  routeBlock: (ids: string[], numbers: string[], id: string) => { row: number; end: number } | null
  mergeTests: (existing: unknown[], date: Date) => unknown[] | null
  toDate: (iso: string) => Date
}
const f = ctx as unknown as Fns
// vm 裡的 Date 與外面不是同一個建構子：用 vm 的 toDate 建日期
const d = (iso: string) => f.toDate(iso)

describe('工作紀錄：月份與日期的位置', () => {
  // 第 8 列「10」、第 9 列 10/28、第 14 列 10/02、第 20 列 10 月總計；第 23 列「09」、第 24 列 9/16、第 30 列 09 月總計
  const display = Array<string>(32).fill('')
  const raw: unknown[] = Array(32).fill('')
  display[7] = '10'
  raw[8] = d('2026-10-28')
  raw[13] = d('2026-10-02')
  display[19] = '10 月總計'
  display[22] = '09'
  raw[23] = d('2026-09-16')
  display[29] = '09 月總計'

  it('找到月份列與它的月總計（09 和 9 都算）', () => {
    expect(f.findMonth(display, '10')).toEqual({ marker: 8, total: 20 })
    expect(f.findMonth(display, '09')).toEqual({ marker: 23, total: 30 })
    expect(f.findMonth(display, '11')).toBeNull()
  })

  it('新的一天放在第一個比它舊的日期之前；最舊時放在月總計之前', () => {
    expect(f.dayInsertRow(raw, 8, 20, d('2026-11-09'))).toBe(9)
    expect(f.dayInsertRow(raw, 8, 20, d('2026-10-10'))).toBe(14)
    expect(f.dayInsertRow(raw, 8, 20, d('2026-10-28'))).toBe(14)
    expect(f.dayInsertRow(raw, 8, 20, d('2026-10-01'))).toBe(20)
  })

  it('新的月份放在第一個比它早的月份之前；沒有更早的月份時找不到位置', () => {
    expect(f.newMonthRow(display, '11')).toBe(8)
    expect(f.newMonthRow(display, '10')).toBe(23)
    expect(f.newMonthRow(display, '08')).toBeNull()
  })

  it('月總計的公式範圍換成新的列，單一儲存格（月份）不動', () => {
    const formulas = [
      ['=TEXTJOIN(" ","",A8,"月總計")', '=COUNTA(D9:D36)', '', '', '', '=SUM(F9:F36)'],
      ['', '=COUNTIF(A9:A36,">2026/1/1<2026/1/31")'],
      ['', '=COUNTIF(B9:B36,"出勤人員*")'],
    ]
    expect(f.totalFormulas(formulas, 9, 48)).toEqual([
      ['=TEXTJOIN(" ","",A8,"月總計")', '=COUNTA(D9:D48)', '', '', '', '=SUM(F9:F48)'],
      ['', '=COUNTIF(A9:A48,">2026/1/1<2026/1/31")'],
      ['', '=COUNTIF(B9:B48,"出勤人員*")'],
    ])
  })
})

describe('路線資料：拉測日期', () => {
  // 第 11 列路線 bn6q6j（3 列）、第 14 列 ffwwrm（4 列：材質、安裝日期、年資、拉測）、第 18 列 ctse76；最後是圖例
  const ids = Array<string>(25).fill('')
  const numbers = Array<string>(25).fill('')
  ids[10] = 'bn6q6j'
  numbers[10] = '473'
  ids[13] = 'ffwwrm'
  numbers[13] = '474'
  ids[17] = 'ctse76'
  numbers[17] = '475'
  numbers[21] = '304-FX'

  it('路線的區塊到下一條路線之前；最後一條到圖例之前', () => {
    expect(f.routeBlock(ids, numbers, 'ffwwrm')).toEqual({ row: 14, end: 17 })
    expect(f.routeBlock(ids, numbers, 'ctse76')).toEqual({ row: 18, end: 21 })
    expect(f.routeBlock(ids, numbers, 'zzzzzz')).toBeNull()
  })

  it('新的日期放最上面，空白的格子去掉；同一天已經有就不寫', () => {
    const old = d('2019-10-24')
    expect(f.mergeTests([old, ''], d('2026-11-09'))).toEqual([d('2026-11-09'), old])
    expect(f.mergeTests([], d('2026-11-09'))).toEqual([d('2026-11-09')])
    expect(f.mergeTests([d('2026-11-09'), old], d('2026-11-09'))).toBeNull()
  })
})
