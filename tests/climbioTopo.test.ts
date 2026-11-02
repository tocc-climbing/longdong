import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validate, type Layer, type PhotoView } from '../vendor/climbio-format/format'
import { fromTopo, toTopoLayer, toTopoView, type TopoViewSource } from '../src/core/format/topo'
import type { Crop, Marks } from '../src/core/topo/geometry'

const ids: Record<string, string> = { 'longdong/jag38d': 'tdebo72up4xx11pe', 'longdong/udy37z': 'u0uuqfwa64owtim3' }
const globalId = (route: string) => ids[route]
const routeId = (id: string) => Object.keys(ids).find((r) => ids[r] === id)

const viewSource = (crop?: Crop): TopoViewSource => ({
  id: 'v0yvmgjsjo884v1g',
  name: '騙人的牆',
  license: 'CC-BY-SA-4.0',
  attribution: 'KK',
  origin: 'self',
  t: 1761620000000,
  href: 'v0yvmgjsjo884v1g.webp',
  w: 2560,
  h: 1711,
  mime: 'image/webp',
  ...(crop ? { crop } : {}),
})

const layer = (view: PhotoView, marks: Marks): Layer =>
  toTopoLayer({ id: 'g28nouxh5k6fy4k3', view, href: 'v0yvmgjsjo884v1g.json', license: 'CC-BY-SA-4.0', attribution: 'KK', t: 1761620000000, marks, globalId })

describe('Topo 轉成公開格式 v2 的照片畫面與線段圖層', () => {
  it('萬分比換成照片像素：x 乘寬、y 乘高；線段指向路線的全域 id', () => {
    const doc = layer(toTopoView(viewSource()), { 'longdong/jag38d': { line: [[5000, 2500], [5001, 9999]] } })
    expect(doc.marks).toEqual([{ node: 'tdebo72up4xx11pe', geometry: { type: 'LineString', coordinates: [[1280, 427.75], [1280.256, 1710.8289]] } }])
  })

  it('bolt、anchor 是路線底下的節點，加上 Point 標註', () => {
    const doc = layer(toTopoView(viewSource()), { 'longdong/jag38d': { bolts: { B01: [1, 3], A01: [5000, 0] } } })
    expect(doc.nodes).toEqual([
      { id: 'tdebo72up4xx11pe-b01', type: 'bolt', parent: 'tdebo72up4xx11pe', name: 'B01' },
      { id: 'tdebo72up4xx11pe-a01', type: 'anchor', parent: 'tdebo72up4xx11pe', name: 'A01' },
    ])
    expect(doc.marks).toEqual([
      { node: 'tdebo72up4xx11pe-b01', geometry: { type: 'Point', coordinates: [0.256, 0.5133] } },
      { node: 'tdebo72up4xx11pe-a01', geometry: { type: 'Point', coordinates: [1280, 0] } },
    ])
  })

  it('裁切換成像素放在 props.crop；整張照片不寫', () => {
    expect(toTopoView(viewSource({ x: 2176, y: 0, w: 5426, h: 7458 })).props).toEqual({ crop: { x: 557.056, y: 0, w: 1389.056, h: 1276.0638 } })
    expect('props' in toTopoView(viewSource({ x: 0, y: 0, w: 10000, h: 10000 }))).toBe(false)
  })

  it('只有一點的線段不輸出，畫面與圖層都通過官方驗證', () => {
    const view = toTopoView(viewSource({ x: 1000, y: 0, w: 8000, h: 9000 }))
    const doc = layer(view, {
      'longdong/jag38d': { line: [[5000, 9000], [5200, 6000], [5400, 1000]], bolts: { B01: [5100, 7000], A01: [5400, 900] } },
      'longdong/udy37z': { line: [[100, 100]] },
    })
    expect(doc.marks!.map((m) => m.node)).toEqual(['tdebo72up4xx11pe', 'tdebo72up4xx11pe-b01', 'tdebo72up4xx11pe-a01'])
    expect(validate(view)).toEqual([])
    expect(validate(doc)).toEqual([])
  })

  it('轉成 v2 再轉回來，標記與裁切不變', () => {
    const marks: Marks = {
      'longdong/jag38d': { line: [[1, 9999], [4321, 5678], [9999, 1]], bolts: { B01: [3333, 6667], A01: [7, 13] } },
      'longdong/udy37z': { bolts: { A01: [10000, 0] } },
    }
    const crop = { x: 123, y: 456, w: 7890, h: 5432 }
    const view = toTopoView(viewSource(crop))
    expect(fromTopo(view, layer(view, marks), routeId)).toEqual({ marks, crop })
  })
})

describe('公開格式 v2 的樣本（騙人的牆）', () => {
  const read = <T>(name: string) => JSON.parse(readFileSync(resolve(__dirname, `../vendor/climbio-format/examples/${name}`), 'utf8')) as T
  const view = read<PhotoView>('topo.json')
  const routes = read<Layer>('topo-routes.json')
  const sampleIds = new Set([...routes.marks!.map((m) => m.node!), ...(routes.nodes ?? []).map((n) => n.parent!)].filter((id) => !id.includes('-')))
  const same = (id: string) => (sampleIds.has(id) ? id : undefined)

  it('樣本通過官方驗證', () => {
    expect(validate(view)).toEqual([])
    expect(validate(routes)).toEqual([])
  })

  it('讀進來再輸出，座標誤差在萬分之一照片寬、高的一半以內', () => {
    const { marks, crop } = fromTopo(view, routes, same)
    const again = toTopoView({ ...viewSource(crop), w: view.w, h: view.h })
    const out = toTopoLayer({ id: routes.id, view: again, license: routes.license, t: routes.t, marks, globalId: (id) => id })
    const close = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) <= view.w / 20000 && Math.abs(a[1] - b[1]) <= view.h / 20000
    const points = (doc: Layer) =>
      new Map(doc.marks!.map((m) => [m.geometry.type === 'Point' ? `${doc.nodes!.find((n) => n.id === m.node)!.parent}/${doc.nodes!.find((n) => n.id === m.node)!.name}` : m.node!, m.geometry.coordinates as number[] | number[][]]))
    const before = points(routes)
    const after = points(out)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [key, p] of before) {
      const q = after.get(key)!
      if (typeof p[0] === 'number') expect(close(p as number[], q as number[])).toBe(true)
      else expect((p as number[][]).every((pt, i) => close(pt, (q as number[][])[i]))).toBe(true)
    }
    const c = view.props!.crop as Crop
    const d = again.props!.crop as Crop
    expect(close([c.x, c.y], [d.x, d.y]) && close([c.w, c.h], [d.w, d.h])).toBe(true)
  })
})
