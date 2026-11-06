import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset, Route } from '../src/data/schema'
import { routeKey } from '../src/social/model'
import { fillShared, syncShared } from '../src/topo/shared'
import { boltPositions, decodeEdit, encodeMarks, routeIdFromKey, sameMarks } from '../src/topo/model'
import { FULL_CROP, isFullCrop, MIN_CROP, moveCrop, resizeCrop, sameCrop, toPoint, type Marks, type Point } from '../src/core/topo/geometry'

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

describe('Topo 編輯', () => {
  describe('共用的 anchor（〈細縫〉與〈Z字〉共用頂端的 anchor）自動同步', () => {
    const slot = (position: string, material: string) => ({ position, material, tests: [] })
    const route = (id: string, bolts: ReturnType<typeof slot>[], anchors: ReturnType<typeof slot>[]) => ({ id, bolts, anchors }) as unknown as Route
    // 細縫的 anchor 標「共用」；Z 字有自己的材質
    const thin = route('r/thin', [], [slot('A01', '共用')])
    const z = route('r/z', [slot('B01', '316-TW')], [slot('A01', '316-TW')])
    const other = route('r/other', [], [slot('A01', '316-TW')])
    const routes = [thin, z, other]
    const lines: Marks = {
      'r/thin': { line: [[4000, 9000], [4100, 3000], [4200, 1000]] },
      'r/z': { line: [[4600, 9000], [4400, 3000], [4250, 1000]] },
      'r/other': { line: [[8000, 9000], [8100, 1000]] },
    }
    const withAnchor = (marks: Marks, id: string, at: Point): Marks => ({ ...marks, [id]: { ...marks[id], bolts: { ...marks[id].bolts, A01: at } } })

    it('一條路線標了 anchor，另一條共用的路線在同一個點也標上（不管從哪一條標）', () => {
      const a = syncShared(withAnchor(lines, 'r/z', [4250, 900]), lines, 'r/z', routes)
      expect(a['r/thin'].bolts).toEqual({ A01: [4250, 900] })
      const b = syncShared(withAnchor(lines, 'r/thin', [4200, 900]), lines, 'r/thin', routes)
      expect(b['r/z'].bolts).toEqual({ A01: [4200, 900] })
    })

    it('沒標「共用」的、離得遠的、沒畫線的路線不跟著標', () => {
      const a = syncShared(withAnchor(lines, 'r/z', [4250, 900]), lines, 'r/z', routes)
      expect(a['r/other'].bolts).toBeUndefined()
      // 另一條路線的線離這個點很遠：不是同一個點
      const far = syncShared(withAnchor(lines, 'r/z', [9000, 100]), lines, 'r/z', routes)
      expect(far['r/thin'].bolts).toBeUndefined()
      const noLine: Marks = { ...lines, 'r/thin': {} }
      expect(syncShared(withAnchor(noLine, 'r/z', [4250, 900]), noLine, 'r/z', routes)['r/thin'].bolts).toBeUndefined()
    })

    it('顯示：只有〈Z字〉標了 anchor（舊資料）時，選〈細縫〉也補畫同一個點；沒標共用或離得遠的不補', () => {
      const onlyZ = withAnchor(lines, 'r/z', [4250, 900])
      const shown = fillShared(onlyZ, routes)
      expect(shown['r/thin'].bolts).toEqual({ A01: [4250, 900] })
      expect(shown['r/other'].bolts).toBeUndefined()
      expect(onlyZ['r/thin'].bolts).toBeUndefined()
      expect(fillShared(withAnchor(lines, 'r/z', [9000, 100]), routes)['r/thin'].bolts).toBeUndefined()
    })

    it('顯示：旁邊另一條路線（排在前面）的 anchor 也不遠時，補的是離線最近的（〈細縫〉不會接到〈最後難關〉的頂端）', () => {
      const near = route('r/near', [], [slot('A01', '316-TW')])
      const marks = withAnchor(withAnchor({ ...lines, 'r/near': { line: [[3500, 9000], [3700, 1300]] } }, 'r/near', [3700, 1100]), 'r/z', [4250, 900])
      expect(fillShared(marks, [thin, near, z, other])['r/thin'].bolts).toEqual({ A01: [4250, 900] })
    })

    it('移動、刪除：原本在同一個點的一起移動、刪除；另一條已經標在別處的不動', () => {
      const both = syncShared(withAnchor(lines, 'r/z', [4250, 900]), lines, 'r/z', routes)
      const moved = syncShared(withAnchor(both, 'r/z', [4300, 800]), both, 'r/z', routes)
      expect(moved['r/thin'].bolts).toEqual({ A01: [4300, 800] })
      const removed = syncShared({ ...moved, 'r/z': { line: moved['r/z'].line } }, moved, 'r/z', routes)
      expect(removed['r/thin']).toEqual({ line: lines['r/thin'].line })
      // 細縫的 anchor 已經標在別處：Z 字再標，不覆蓋細縫的
      const apart = withAnchor(lines, 'r/thin', [4100, 1500])
      expect(syncShared(withAnchor(apart, 'r/z', [4250, 900]), apart, 'r/z', routes)['r/thin'].bolts).toEqual({ A01: [4100, 1500] })
    })

    it('其他位置、其他欄位沒改的不處理；路線資料裡沒有這個位置的不同步', () => {
      const noSlot = syncShared({ ...lines, 'r/z': { ...lines['r/z'], bolts: { B09: [4300, 5000] } } }, lines, 'r/z', routes)
      expect(noSlot['r/thin'].bolts).toBeUndefined()
      expect(syncShared(lines, lines, 'r/z', routes)).toBe(lines)
    })
  })
})

