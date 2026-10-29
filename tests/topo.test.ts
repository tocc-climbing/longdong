import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset, Route } from '../src/data/schema'
import { routeKey } from '../src/social/model'
import { clampView, fitSize, IDENTITY, MAX_SCALE, moveView } from '../src/topo/viewport'
import { addLinePoint, drawnRuns, fillShared, forkLine, moveSharedPoint, segmentAt, syncShared } from '../src/topo/lines'
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

  it('拖曳共用的點時，所有落在同一點的線段端點一起移動，bolt 不動', () => {
    const marks: Marks = { a: { line: trunk, bolts: { B01: [4800, 6000] } }, b: { line: branch } }
    const moved = moveSharedPoint(marks, [4800, 6000], [4700, 6100])
    expect(moved.a.line![1]).toEqual([4700, 6100])
    expect(moved.b.line![1]).toEqual([4700, 6100])
    expect(moved.a.bolts!.B01).toEqual([4800, 6000])
    expect(moved.b.line![2]).toEqual([3000, 2000])
  })
})

describe('點在線段中間', () => {
  const line: Point[] = [[3000, 9000], [3000, 5000], [3000, 1000]]

  it('找到點所在的那一段；離線太遠、在兩端之外、在把手上都不算', () => {
    expect(segmentAt(line, [3050, 7000], 1)).toBe(0)
    expect(segmentAt(line, [3050, 3000], 1)).toBe(1)
    expect(segmentAt(line, [3400, 7000], 1)).toBe(-1)
    expect(segmentAt(line, [3000, 900], 1)).toBe(-1)
    expect(segmentAt(line, [3000, 9100], 1)).toBe(-1)
    expect(segmentAt([[3000, 9000]], [3000, 9000], 1)).toBe(-1)
  })

  it('距離依照片的寬高比計算：橫向的 100 在寬照片上比縱向的 100 長', () => {
    // 寬高比 2：橫向差 100（萬分比）= 200 單位，超過 150
    expect(segmentAt(line, [3100, 7000], 1)).toBe(0)
    expect(segmentAt(line, [3100, 7000], 2)).toBe(-1)
  })

  it('橫向的線段：寬高比不影響垂足的位置', () => {
    const across: Point[] = [[0, 5000], [1000, 5000]]
    expect(segmentAt(across, [500, 5100], 2)).toBe(0)
    expect(segmentAt(across, [900, 5100], 2)).toBe(0)
    expect(segmentAt(across, [1100, 5100], 2)).toBe(-1)
  })

  it('點在線段中間：插進那一段；其他地方接在線尾', () => {
    expect(addLinePoint({ a: { line } }, 'a', [3050, 7000], 1).a.line).toEqual([[3000, 9000], [3050, 7000], [3000, 5000], [3000, 1000]])
    expect(addLinePoint({ a: { line } }, 'a', [6000, 500], 1).a.line).toEqual([...line, [6000, 500]])
    expect(addLinePoint({}, 'a', [10, 20], 1)).toEqual({ a: { line: [[10, 20]] } })
  })

  it('保留 bolt；插入不改其他路線', () => {
    const marks: Marks = { a: { line, bolts: { B01: [3000, 7000] } }, b: { line: [[6000, 9000], [6000, 1000]] } }
    const next = addLinePoint(marks, 'a', [3050, 7000], 1)
    expect(next.a.bolts).toEqual({ B01: [3000, 7000] })
    expect(next.b).toEqual(marks.b)
  })

  it('插進共用的線段：分岔的路線一起插入，兩條線不會分開', () => {
    const trunk: Point[] = [[5000, 9000], [4800, 6000], [5000, 3000]]
    const branch: Point[] = [...forkLine(trunk, 1), [3000, 2000]]
    const next = addLinePoint({ a: { line: trunk }, b: { line: branch } }, 'b', [4900, 7500], 1)
    expect(next.b.line).toEqual([[5000, 9000], [4900, 7500], [4800, 6000], [3000, 2000]])
    expect(next.a.line).toEqual([[5000, 9000], [4900, 7500], [4800, 6000], [5000, 3000]])
    expect(drawnRuns([['a', next.a.line!], ['b', next.b.line!]]).get('b')).toEqual([[[4800, 6000], [3000, 2000]]])
  })

  it('方向相反的同一段也算共用', () => {
    const marks: Marks = { a: { line: [[0, 0], [0, 1000]] }, b: { line: [[0, 1000], [0, 0]] } }
    const next = addLinePoint(marks, 'a', [20, 500], 1)
    expect(next.a.line).toEqual([[0, 0], [20, 500], [0, 1000]])
    expect(next.b.line).toEqual([[0, 1000], [20, 500], [0, 0]])
  })
})

describe('全螢幕縮放與平移', () => {
  const stage = { w: 400, h: 800 }
  const content = fitSize(stage, 2)

  it('照片縮到剛好放得下舞台', () => {
    expect(content).toEqual({ w: 400, h: 200 })
    expect(fitSize({ w: 400, h: 100 }, 2)).toEqual({ w: 200, h: 100 })
  })

  it('沒放大時不能平移；放大後邊緣不能離開舞台邊緣，放不滿的方向仍置中', () => {
    expect(clampView({ scale: 1, x: 50, y: 50 }, stage, content)).toEqual({ scale: 1, x: 0, y: 0 })
    // 放大 3 倍：寬 1200 > 400，水平可移 ±400；高 600 < 800，垂直置中
    expect(clampView({ scale: 3, x: 999, y: 999 }, stage, content)).toEqual({ scale: 3, x: 400, y: 0 })
    expect(clampView({ scale: 3, x: -999, y: 5 }, stage, content)).toEqual({ scale: 3, x: -400, y: 0 })
  })

  it('縮放限制在 1 到上限', () => {
    expect(clampView({ scale: 0.2, x: 0, y: 0 }, stage, content).scale).toBe(1)
    expect(clampView({ scale: 99, x: 0, y: 0 }, stage, content).scale).toBe(MAX_SCALE)
  })

  it('雙指放大：手指下的那一點留在手指下', () => {
    const view = moveView(IDENTITY, { x: 100, y: 0 }, { x: 100, y: 0 }, 2, stage, content)
    expect(view.scale).toBe(2)
    // 內容座標 q = (p - t) / s；放大前後 100 這一點都在 x=100
    expect((100 - view.x) / view.scale).toBe(100)
  })

  it('單指拖曳：照片跟著手指移動同樣的距離', () => {
    const zoomed = { scale: 3, x: 0, y: 0 }
    expect(moveView(zoomed, { x: 0, y: 0 }, { x: -120, y: 30 }, 1, stage, content)).toEqual({ scale: 3, x: -120, y: 0 })
  })

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
