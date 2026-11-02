import { describe, expect, it } from 'vitest'
import { readTopo } from '../vendor/climbio-topokit/index.js'
import { cropFromKit, dropFilled, kitMarks, rectToKit, withMarks } from '../src/topo/kitEdit'
import { topoData } from '../src/topo/KitTopo'
import type { Marks } from '../src/core/topo/geometry'

const photo = { image: 'p', width: 2560, height: 1711 }

describe('TopoKit 編輯器與萬分比的換算', () => {
  it('沒動的標記換成像素再換回來，值不變', () => {
    const marks: Marks = { a: { line: [[1234, 9876], [3333, 1], [7, 5000]], bolts: { B01: [1500, 7777], A01: [3001, 9] } }, b: { line: [[9999, 4321]] } }
    const data = topoData(photo, 'x.jpg', marks, undefined, new Map(), new Map())
    expect(kitMarks(readTopo(data).routes, photo)).toEqual({ a: marks.a })
  })

  it('裁切：整張是 undefined，其他換算後值不變', () => {
    const crop = { x: 1200, y: 333, w: 7000, h: 6001 }
    expect(cropFromKit(rectToKit(crop, photo), photo)).toEqual(crop)
    expect(cropFromKit({ x: 0, y: 0, w: 2560, h: 1711 }, photo)).toBeUndefined()
  })

  it('補畫的共用點沒被動過：從草稿拿掉；動過或本來就有的留著', () => {
    const base: Marks = { a: { line: [[1, 1], [2, 2]], bolts: { A01: [500, 500] } }, b: { line: [[3, 3], [4, 4]] } }
    const filled: Marks = { ...base, b: { ...base.b, bolts: { A01: [500, 500] } } }
    expect(dropFilled(filled, base, filled)).toEqual(base)
    const moved: Marks = { ...filled, b: { ...filled.b, bolts: { A01: [600, 600] } } }
    expect(dropFilled(moved, base, filled)).toEqual(moved)
    expect(dropFilled({ a: base.a, b: { bolts: { A01: [500, 500] } } }, base, filled)).toEqual({ a: base.a })
  })

  it('同步只改寫變了的路線，其他路線的座標不經過換算', () => {
    const routes = [
      { id: 'a', kind: 'sport' as const, layer: 0, line: [[100.123, 200.456], [300, 400]] as [number, number][] },
      { id: 'b', kind: 'other' as const, layer: 0, line: [[10.5, 20.25], [30, 40]] as [number, number][] },
    ]
    const out = withMarks(routes, { a: {}, b: { bolts: { A01: [5000, 5000] } } }, new Set(['b']), photo)
    expect(out[0]).toBe(routes[0])
    expect(out[1].line).toBeUndefined()
    expect(out[1].bolts?.A01).toEqual({ at: [1280, 855.5], anchor: true })
  })
})
