import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset, Route } from '../src/data/schema'
import { routeKey } from '../src/social/model'
import { drawnRuns, forkLine, moveSharedPoint, spreadBadges } from '../src/topo/lines'
import { boltPositions, decodeEdit, encodeMarks, FULL_CROP, isFullCrop, MIN_CROP, moveCrop, resizeCrop, routeIdFromKey, sameCrop, sameMarks, toCropPoint, toPoint, type Marks, type Point } from '../src/topo/model'

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

describe('裁切', () => {
  const crop = { x: 2000, y: 1000, w: 4000, h: 6000 }

  it('沒有裁切與整張視為相同；解碼保留裁切', () => {
    expect(isFullCrop(undefined)).toBe(true)
    expect(isFullCrop(FULL_CROP)).toBe(true)
    expect(isFullCrop(crop)).toBe(false)
    expect(sameCrop(undefined, FULL_CROP)).toBe(true)
    expect(sameCrop(crop, { ...crop, w: 4001 })).toBe(false)
    expect(decodeEdit('e', { uid: 'a', createdAt: 1, routes: {}, crop }).crop).toEqual(crop)
    expect(decodeEdit('e', { uid: 'a', createdAt: 1, routes: {} })).not.toHaveProperty('crop')
  })

  it('裁切範圍內的位置換回整張照片上的點，標記座標與裁切無關', () => {
    expect(toCropPoint(undefined, 0.25, 0.5)).toEqual([2500, 5000])
    expect(toCropPoint(crop, 0, 0)).toEqual([2000, 1000])
    expect(toCropPoint(crop, 1, 1)).toEqual([6000, 7000])
    expect(toCropPoint(crop, 0.5, 0.5)).toEqual([4000, 4000])
  })

  it('拖曳邊與角：只動被拖的邊，對邊不動', () => {
    expect(resizeCrop(crop, -1, 0, [3000, 9999])).toEqual({ x: 3000, y: 1000, w: 3000, h: 6000 })
    expect(resizeCrop(crop, 1, 1, [7000, 8000])).toEqual({ x: 2000, y: 1000, w: 5000, h: 7000 })
    expect(resizeCrop(crop, 0, -1, [0, 500])).toEqual({ x: 2000, y: 500, w: 4000, h: 6500 })
  })

  it('拖出照片外停在邊緣，寬高不小於下限', () => {
    expect(resizeCrop(crop, -1, -1, [-50, -50])).toEqual({ x: 0, y: 0, w: 6000, h: 7000 })
    expect(resizeCrop(crop, 1, 1, [20000, 20000])).toEqual({ x: 2000, y: 1000, w: 8000, h: 9000 })
    expect(resizeCrop(crop, 1, 0, [0, 0]).w).toBe(MIN_CROP)
    expect(resizeCrop(crop, -1, 0, [9000, 0])).toEqual({ x: 5500, y: 1000, w: MIN_CROP, h: 6000 })
    expect(resizeCrop(crop, 0, -1, [0, 9999]).h).toBe(MIN_CROP)
  })

  it('整個框移動，大小不變並停在照片內', () => {
    expect(moveCrop(crop, [3000, 3000], [3500, 2500])).toEqual({ x: 2500, y: 500, w: 4000, h: 6000 })
    expect(moveCrop(crop, [0, 0], [-9999, -9999])).toEqual({ x: 0, y: 0, w: 4000, h: 6000 })
    expect(moveCrop(crop, [0, 0], [9999, 9999])).toEqual({ x: 6000, y: 4000, w: 4000, h: 6000 })
  })
})

describe('共用線段', () => {
  const trunk: Point[] = [[5000, 9000], [4800, 6000], [5000, 3000]]
  const branch: Point[] = [...forkLine(trunk, 1), [3000, 2000], [2900, 500]]

  it('分岔出來的路線複製到分岔點為止的前段', () => {
    expect(forkLine(trunk, 1)).toEqual([[5000, 9000], [4800, 6000]])
    expect(forkLine(trunk, 0)).toEqual([[5000, 9000]])
  })

  it('共用的線段只畫一次，歸排在前面的路線；各自的部分接成折線', () => {
    const runs = drawnRuns([['a', trunk], ['b', branch]])
    expect(runs.get('a')).toEqual([trunk])
    expect(runs.get('b')).toEqual([[[4800, 6000], [3000, 2000], [2900, 500]]])
    // 順序對調：共用段歸 b，a 只剩自己的一段
    const flipped = drawnRuns([['b', branch], ['a', trunk]])
    expect(flipped.get('b')).toEqual([branch])
    expect(flipped.get('a')).toEqual([[[4800, 6000], [5000, 3000]]])
  })

  it('端點相同但方向相反的線段視為同一段；只差一點座標就不算共用', () => {
    expect(drawnRuns([['a', [[1, 1], [2, 2]]], ['b', [[2, 2], [1, 1]]]]).get('b')).toEqual([])
    expect(drawnRuns([['a', [[1, 1], [2, 2]]], ['b', [[1, 1], [2, 3]]]]).get('b')).toEqual([[[1, 1], [2, 3]]])
  })

  it('被共用段隔開的兩段各自成一條折線', () => {
    const middle: Point[] = [[0, 0], [1, 1], [2, 2], [3, 3]]
    const runs = drawnRuns([['a', [[1, 1], [2, 2]]], ['b', middle]])
    expect(runs.get('b')).toEqual([[[0, 0], [1, 1]], [[2, 2], [3, 3]]])
  })

  it('同一位置的編號橫向排開並置中，不同位置不動', () => {
    const offsets = spreadBadges([
      { id: 'a', at: [100, 100], width: 20 },
      { id: 'b', at: [100, 100], width: 30 },
      { id: 'c', at: [900, 100], width: 20 },
    ])
    // 總寬 20 + 3 + 30 = 53，左緣 -26.5：a 的中心 -16.5，b 的中心 -26.5 + 23 + 15 = 11.5
    expect(offsets.get('a')).toBe(-16.5)
    expect(offsets.get('b')).toBe(11.5)
    expect(offsets.get('c')).toBe(0)
  })

  it('拖曳共用的點時，所有落在同一點的線段端點一起移動，bolt 不動', () => {
    const marks: Marks = { a: { line: trunk, bolts: { B01: [4800, 6000] } }, b: { line: branch } }
    const moved = moveSharedPoint(marks, [4800, 6000], [4700, 6100])
    expect(moved.a.line![1]).toEqual([4700, 6100])
    expect(moved.b.line![1]).toEqual([4700, 6100])
    expect(moved.a.bolts!.B01).toEqual([4800, 6000])
    expect(moved.b.line![2]).toEqual([3000, 2000])
  })
})
