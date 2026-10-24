import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset, Route } from '../src/data/schema'
import { routeKey } from '../src/social/model'
import { boltPositions, decodeEdit, encodeMarks, routeIdFromKey, sameMarks, toPoint, type Marks } from '../src/topo/model'

const rules = JSON.parse(readFileSync('firebase/database.rules.json', 'utf8')).rules.v2.topoEdits.$photo.$edit.routes.$route
/** 規則裡 .validate 的 /…/ 正規表示式 */
const ruleRegex = (validate: string) => new RegExp(validate.match(/matches\(\/(.+?)\/\)/)![1])
const LINE = ruleRegex(rules.line['.validate'])
const BOLT = ruleRegex(rules.bolts.$position['.validate'].split('&&').at(-1)!)
const POSITION = ruleRegex(rules.bolts.$position['.validate'])
const ROUTE_KEY = ruleRegex(rules['.validate'])

const dataset = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset
const routes = dataset.areas.flatMap((a) => a.sectors.flatMap((s) => s.routes))

describe('encodeMarks：寫入的格式通過資料庫規則', () => {
  const marks: Marks = {
    'longdong/jar2yu': { line: [toPoint(0.5, 0.95), toPoint(0.48, 0.5), toPoint(0.5, 0)], bolts: { B01: toPoint(0.5, 0.8), A01: toPoint(1, 0) } },
  }
  const routesOut = encodeMarks(marks)

  it('路線 key、線段、bolt 位置與座標', () => {
    const [[key, r]] = Object.entries(routesOut)
    expect(key).toMatch(ROUTE_KEY)
    expect(r.line).toMatch(LINE)
    for (const [pos, p] of Object.entries(r.bolts!)) {
      expect(pos).toMatch(POSITION)
      expect(p).toMatch(BOLT)
    }
  })

  it('資料檔裡每一條路線的 key 與 bolt 位置都能寫入', () => {
    for (const route of routes) {
      expect(routeKey(route.id)).toMatch(ROUTE_KEY)
      for (const pos of boltPositions(route)) expect(pos).toMatch(POSITION)
    }
  })

  it('只有一點的線段、沒有標記的路線不存', () => {
    expect(encodeMarks({ 'longdong/jar2yu': { line: [toPoint(0.1, 0.1)] }, 'longdong/abcdef': { bolts: {} } })).toEqual({})
  })

  it('解碼後與原本相同', () => {
    const edit = decodeEdit('e1', { uid: 'alice', createdAt: 1, routes: routesOut })
    expect(edit.marks).toEqual(marks)
    expect(sameMarks(edit.marks, marks)).toBe(true)
  })
})

describe('sameMarks', () => {
  it('順序不同視為相同；座標不同、多一條路線視為不同', () => {
    const a: Marks = { 'longdong/aaaaaa': { bolts: { B01: [1, 2], B02: [3, 4] } }, 'longdong/bbbbbb': { line: [[1, 1], [2, 2]] } }
    const b: Marks = { 'longdong/bbbbbb': { line: [[1, 1], [2, 2]] }, 'longdong/aaaaaa': { bolts: { B02: [3, 4], B01: [1, 2] } } }
    expect(sameMarks(a, b)).toBe(true)
    expect(sameMarks(a, { ...b, 'longdong/aaaaaa': { bolts: { B01: [1, 2], B02: [3, 5] } } })).toBe(false)
    expect(sameMarks(a, { ...a, 'longdong/cccccc': { line: [[1, 1], [2, 2]] } })).toBe(false)
  })
})

describe('routeIdFromKey', () => {
  it('是 routeKey 的反向', () => {
    for (const route of routes) expect(routeIdFromKey(routeKey(route.id))).toBe(route.id)
  })
})

describe('boltPositions', () => {
  it('bolt 由下往上，接著是 anchor', () => {
    const route = { bolts: [{ position: 'B01' }, { position: 'B02' }], anchors: [{ position: 'A01' }] } as Route
    expect(boltPositions(route)).toEqual(['B01', 'B02', 'A01'])
  })
})

describe('toPoint', () => {
  it('照片上的相對位置換成 0–10000 的整數', () => {
    expect(toPoint(0, 1)).toEqual([0, 10000])
    expect(toPoint(0.12345, 0.5)).toEqual([1235, 5000])
  })
})
