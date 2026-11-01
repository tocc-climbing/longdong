import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validate, type Photo, type Topo } from '../vendor/climbio-format/format'
import { fromTopo, toTopo, type TopoSource } from '../src/core/format/topo'
import type { Marks } from '../src/core/topo/geometry'

const photo: Photo = { href: 'photo.webp', w: 2560, h: 1711, mime: 'image/webp', license: 'CC-BY-SA-4.0', attribution: 'KK', origin: 'self' }

const source = (marks: Marks, extra: Partial<TopoSource> = {}): TopoSource => ({
  id: '-P4xMGWX39F7Iokg754u',
  name: '騙人的牆',
  license: 'CC-BY-SA-4.0',
  t: 1761620000000,
  photo,
  marks,
  routes: new Map([['longdong/jag38d', { name: 'Z字', grade: '5.11a' }]]),
  ...extra,
})

describe('Topo 轉成公開格式 v2', () => {
  it('萬分比換成照片像素：x 乘寬、y 乘高', () => {
    const doc = toTopo(source({ 'longdong/jag38d': { line: [[5000, 2500], [5001, 9999]], bolts: { B01: [1, 3] } } }))
    expect(doc.routes['longdong/jag38d']).toEqual({
      name: 'Z字',
      grade: '5.11a',
      line: [[1280, 427.75], [1280.256, 1710.8289]],
      bolts: { B01: [0.256, 0.5133] },
    })
  })

  it('裁切換成像素；整張照片不寫 crop', () => {
    const marks = { 'longdong/jag38d': { line: [[0, 0], [10000, 10000]] as [number, number][] } }
    expect(toTopo(source(marks, { crop: { x: 2176, y: 0, w: 5426, h: 7458 } })).crop).toEqual({ x: 557.056, y: 0, w: 1389.056, h: 1276.0638 })
    expect('crop' in toTopo(source(marks, { crop: { x: 0, y: 0, w: 10000, h: 10000 } }))).toBe(false)
  })

  it('沒有標記的路線、只有一點的線段不輸出，輸出通過官方驗證', () => {
    const doc = toTopo(
      source(
        {
          'longdong/jag38d': { line: [[5000, 9000], [5200, 6000], [5400, 1000]], bolts: { B01: [5100, 7000], A01: [5400, 900] } },
          'longdong/one': { line: [[100, 100]] },
          'longdong/empty': { bolts: {} },
        },
        { crop: { x: 1000, y: 0, w: 8000, h: 9000 }, sector: 'longdong/school-gate-4wnzar', source: { url: 'https://longdong.web.app/data/longdong.json', version: 'f8e35c2a05d5' } },
      ),
    )
    expect(Object.keys(doc.routes)).toEqual(['longdong/jag38d'])
    expect(validate(doc)).toEqual([])
  })

  it('轉成 v2 再轉回來，標記與裁切不變', () => {
    const marks: Marks = {
      'longdong/jag38d': { line: [[1, 9999], [4321, 5678], [9999, 1]], bolts: { B01: [3333, 6667], A01: [7, 13] } },
      'longdong/udy37z': { bolts: { A01: [10000, 0] } },
    }
    const crop = { x: 123, y: 456, w: 7890, h: 5432 }
    expect(fromTopo(toTopo(source(marks, { crop })))).toEqual({ marks, crop })
  })
})

describe('公開格式 v2 的樣本（騙人的牆）', () => {
  const sample = JSON.parse(readFileSync(resolve(__dirname, '../vendor/climbio-format/examples/topo.json'), 'utf8')) as Topo

  it('樣本通過官方驗證', () => {
    expect(validate(sample)).toEqual([])
  })

  it('讀進來再輸出，座標誤差在萬分之一照片寬、高的一半以內', () => {
    const { marks, crop } = fromTopo(sample)
    const routes = new Map(Object.entries(sample.routes).map(([id, r]) => [id, { name: r.name, grade: r.grade }]))
    const again = toTopo({ ...sample, marks, crop, routes })
    const close = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) <= sample.photo.w / 20000 && Math.abs(a[1] - b[1]) <= sample.photo.h / 20000
    for (const [id, r] of Object.entries(sample.routes)) {
      const out = again.routes[id]
      expect(out.name).toBe(r.name)
      expect(r.line!.every((p, i) => close(p, out.line![i]))).toBe(true)
      expect(Object.entries(r.bolts ?? {}).every(([pos, p]) => close(p, out.bolts![pos]))).toBe(true)
    }
    const c = sample.crop!
    expect(close([c.x, c.y], [again.crop!.x, again.crop!.y]) && close([c.w, c.h], [again.crop!.w, again.crop!.h])).toBe(true)
  })
})
