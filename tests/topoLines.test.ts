import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Marks, TopoPhoto } from '../src/topo/model'
import { TopoLines, type RouteInfo } from '../src/topo/TopoView'

const photo = { id: 'p', sector: 's', uid: 'u', width: 2000, height: 1000, image: 'x', createdAt: 0 } as TopoPhoto
const marks: Marks = {
  a: { line: [[3000, 9000], [3200, 5000], [3000, 1000]], bolts: { B01: [3100, 7000], A01: [3000, 1500] } },
  b: { line: [[6000, 9000], [6100, 5000], [6000, 1000]] },
}
const labels = new Map([['a', '10'], ['b', '11']])
const info = new Map<string, RouteInfo>([
  ['a', { kind: 'sport', grade: '5.10a', name: '路線甲', bolts: { B01: '316-TW · 2007', A01: 'Ti-U · 2021' } }],
  ['b', { kind: 'trad', grade: '5.11b', name: '路線乙', bolts: {} }],
])
const render = (k: number, extra: object = {}) => renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo, marks, labels, k, info, ...extra })))
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length

describe('Topo 標記的自動排版（畫面上的大小）', () => {
  it('顏色依種類：運攀藍色、傳攀紅色', () => {
    const html = render(1)
    expect(html).toContain('topo-route kind-sport')
    expect(html).toContain('topo-route kind-trad')
  })

  it('選到的路線一律顯示難度與名稱；其他的要線夠長（放大）才顯示', () => {
    // 線在畫面上很長（k 小 = 放大）：兩條都顯示難度與名稱
    expect(render(0.5, { highlight: 'a' })).toContain('路線乙')
    // 縮小（線在畫面上很短）：只有選到的顯示（名稱放不下時先留難度）；其他路線只有編號
    const small = render(8, { highlight: 'a' })
    expect(small).toContain('5.10a')
    expect(small).not.toContain('5.11b')
    expect(small).not.toContain('路線乙')
  })

  it('bolt、anchor 只在 bolts 指定的路線顯示，放大才有材質與年份', () => {
    expect(count(render(1), /class="topo-bolt/g)).toBe(0)
    const html = render(1, { bolts: ['a'] })
    expect(count(html, /class="topo-bolt/g)).toBe(2)
    expect(html).toContain('316-TW · 2007')
    expect(html).toContain('××')
    expect(html).toContain('× B01')
  })

  it('縮得很小，太短的路線不標編號；選到的路線仍然標', () => {
    expect(count(render(60), /class="topo-badge"/g)).toBe(0)
    expect(count(render(60, { highlight: 'a' }), /class="topo-badge"/g)).toBe(1)
  })
})
