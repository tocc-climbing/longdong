import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Marks } from '../src/core/topo/geometry'
import type { TopoPhoto } from '../src/topo/model'
import { textWidth } from '../src/core/topo/annotate'
import type { Route } from '../src/data/schema'
import { routeInfo } from '../src/topo/routeInfo'
import { TopoLines, type RouteInfo } from '../src/core/topo/TopoView'
import schoolGate from './fixtures/topo-school-gate.json'

const photo = { id: 'p', sector: 's', uid: 'u', width: 2000, height: 1000, image: 'x', createdAt: 0 } as TopoPhoto
const marks: Marks = {
  a: { line: [[3000, 9000], [3200, 5000], [3000, 1000]], bolts: { B01: [3100, 7000], A01: [3000, 1500] } },
  b: { line: [[6000, 9000], [6100, 5000], [6000, 1000]] },
}
const labels = new Map([['a', '10'], ['b', '11']])
const info = new Map<string, RouteInfo>([
  ['a', { kind: 'sport', grade: '5.10a', name: '路線甲', bolts: { B01: '316-TW', A01: 'Ti-U' } }],
  ['b', { kind: 'other', grade: '5.11b', name: '路線乙', bolts: {} }],
])
const render = (k: number, extra: object = {}) => renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo, marks, labels, k, info, ...extra })))
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length

describe('Topo 標記的自動排版（畫面上的大小）', () => {
  it('看的時候起點、終點都是同樣大小的實心圓點；線沒有白邊；編輯時不畫終點', () => {
    expect(count(render(1), /class="topo-dot"/g)).toBe(4)
    expect(render(1)).toContain('class="topo-dot" cx="600" cy="100" r="3.2"')
    expect(render(1)).toContain('class="topo-dot" cx="600" cy="900" r="3.2"')
    expect(render(1)).not.toContain('topo-halo')
    expect(count(render(1, { editing: true }), /class="topo-dot"/g)).toBe(2)
  })

  it('實際的 Topo（校門口 · 騙人的牆，565–569）：分區頁、全螢幕的大小只有編號；放大三倍每條都標完整的難度名稱，緊貼在自己的編號正旁邊', () => {
    const real = schoolGate as unknown as { photo: TopoPhoto; crop: { x: number; y: number; w: number; h: number }; marks: Marks; routes: { id: string; number: string; grade: string; name: string; type: string }[] }
    const realLabels = new Map(real.routes.map((r) => [r.id, r.number]))
    const realInfo = new Map<string, RouteInfo>(real.routes.map((r) => [r.id, { kind: r.type === 'sport' ? 'sport' : 'other', grade: r.grade, name: r.name, bolts: {} }]))
    // 手機的分區頁約 340 個螢幕像素寬、全螢幕約 375（k = 照片像素／螢幕像素）
    const cropPx = (real.crop.w / 10000) * real.photo.width
    for (const screen of [340, 375]) {
      const fit = renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo: real.photo, marks: real.marks, labels: realLabels, k: cropPx / screen, info: realInfo, crop: real.crop })))
      expect(count(fit, /class="topo-badge"/g), `${screen}px`).toBe(real.routes.length)
      expect(fit, `${screen}px`).not.toContain('topo-note')
    }
    for (const screen of [340 * 3, 375 * 3]) {
      const k = cropPx / screen
      const html = renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo: real.photo, marks: real.marks, labels: realLabels, k, info: realInfo, crop: real.crop })))
      for (const r of real.routes) {
        const group = html.match(new RegExp(`<g class="topo-route [^"]*">(?:(?!<g class="topo-route).)*>${r.number}</text>(?:(?!<g class="topo-route).)*`))?.[0] ?? ''
        expect(group, `${screen}px #${r.number}`).toContain(r.name)
        expect(group, `${screen}px #${r.number}`).toContain(r.grade)
        const [x, y, w, h] = group.match(/<g class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/)!.slice(1).map(Number)
        const spans = [...group.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]+)</g)].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), w: textWidth(m[3], 10) * k }))
        const left = Math.min(...spans.map((t) => t.cx - t.w / 2))
        const right = Math.max(...spans.map((t) => t.cx + t.w / 2))
        const top = Math.min(...spans.map((t) => t.cy)) - 6.25 * k
        const bottom = Math.max(...spans.map((t) => t.cy)) + 6.25 * k
        // 正右、正左（高度重疊）或正下、正上（左右重疊），不是斜對角
        const beside = (top < y + h && bottom > y) || (left < x + w && right > x)
        const gap = Math.max(left - (x + w), x - right, top - (y + h), y - bottom)
        expect(beside && gap <= 4 * k + 0.5, `${screen}px #${r.number}：說明離編號 ${gap.toFixed(1)}`).toBe(true)
      }
      // 565 只畫了從照片下緣出去的一小段（示意線）：終點是向上的箭頭，編號在終點正上方
      const sketch = real.routes.find((r) => r.number === '565')!
      const [ex, ey] = real.marks[sketch.id].line!.at(-1)!.map((v, i) => (v / 10000) * (i ? real.photo.height : real.photo.width))
      const group = html.match(/<g class="topo-route [^"]*">(?:(?!<g class="topo-route).)*>565<\/text>/)![0]
      const arrows = [...html.matchAll(/<path class="topo-dot" d="M([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
      expect(arrows).toHaveLength(1)
      expect(Math.abs(arrows[0][0] - ex)).toBeLessThan(0.01)
      expect(html).not.toMatch(new RegExp(`<circle class="topo-dot" cx="${ex}" cy="${ey}"`))
      const [x, y, w, h] = group.match(/<g class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/)!.slice(1).map(Number)
      expect(Math.abs(x + w / 2 - ex)).toBeLessThan(1)
      expect(y + h).toBeLessThan(ey)
    }
  })

  it('實際的 Topo 開著 bolt：565 的編號在箭頭正上方；放大三倍每個 bolt 都標種類', () => {
    const real = schoolGate as unknown as { photo: TopoPhoto; crop: { x: number; y: number; w: number; h: number }; marks: Marks; routes: { id: string; number: string; grade: string; name: string; type: string }[] }
    const realLabels = new Map(real.routes.map((r) => [r.id, r.number]))
    const realInfo = new Map<string, RouteInfo>(
      real.routes.map((r) => [r.id, { kind: r.type === 'sport' ? 'sport' : 'other', grade: r.grade, name: r.name, bolts: Object.fromEntries(Object.keys(real.marks[r.id]?.bolts ?? {}).map((p) => [p, '316-TW'])) }]),
    )
    const cropPx = (real.crop.w / 10000) * real.photo.width
    const draw = (screen: number) => renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo: real.photo, marks: real.marks, labels: realLabels, k: cropPx / screen, info: realInfo, crop: real.crop, bolts: Object.keys(real.marks) })))
    const sketch = real.routes.find((r) => r.number === '565')!
    const [ex, ey] = real.marks[sketch.id].line!.at(-1)!.map((v, i) => (v / 10000) * (i ? real.photo.height : real.photo.width))
    for (const screen of [340, 375]) {
      const [x, y, w, h] = draw(screen).match(/<g class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"[^>]*><\/rect><text[^>]*>565</)!.slice(1).map(Number)
      expect(Math.abs(x + w / 2 - ex), `${screen}px`).toBeLessThan(1)
      expect(y + h, `${screen}px`).toBeLessThan(ey)
    }
    const zoomed = draw(375 * 3)
    expect(count(zoomed, />316-TW</g)).toBe(count(zoomed, /<g class="topo-bolt/g))
  })

  it('說明優先放在編號正上方（自己的線上），一看就知道是哪一條', () => {
    const html = render(1)
    for (const id of ['a', 'b']) {
      const group = html.match(new RegExp(`<g class="topo-route [^"]*">(?:(?!<g class="topo-route).)*>${labels.get(id)}</text>(?:(?!<g class="topo-route).)*`))![0]
      const [x, y, w] = group.match(/<g class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)"/)!.slice(1).map(Number)
      const spans = [...group.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
      expect(spans.length).toBeGreaterThan(0)
      for (const [sx, sy] of spans) {
        expect(Math.abs(sx - (x + w / 2))).toBeLessThan(1)
        expect(sy).toBeLessThan(y)
      }
    }
  })

  it('solo：說明不避開其他路線的線，貼在編號旁邊', () => {
    const near: Marks = {
      a: { line: [[3000, 9000], [3000, 1000]] },
      b: { line: [[3150, 9000], [3150, 1000]] },
    }
    const nums = (s: string) => s.match(/-?\d+(\.\d+)?/g)!.map(Number)
    const side = (html: string) => {
      const badge = html.match(/<g class="topo-badge"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!
      const [x, y, w, h] = nums(badge.slice(1).join(' '))
      const spans = [...html.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
      const midY = spans.reduce((s, [, sy]) => s + sy, 0) / spans.length
      // 說明貼著編號：正上方、正下方（同一條線上），或右邊、左邊（同一高度）
      const sameColumn = spans.every(([sx]) => Math.abs(sx - (x + w / 2)) < 1) && Math.abs(midY - (y + h / 2)) < 6 * 12.5
      const sameRow = Math.abs(midY - (y + h / 2)) < 1 && spans.every(([sx]) => sx > x + w || sx < x)
      return sameColumn || sameRow
    }
    const html = renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo, marks: near, labels, k: 1, info, highlight: 'a', solo: true })))
    expect(side(html)).toBe(true)
  })

  it('solo（路線卡片）：選到的路線標編號與說明，其他路線只標小的編號、變淡', () => {
    const html = render(0.5, { highlight: 'a', solo: true })
    expect(html).toContain('<g class="topo-badge">')
    expect(html).toMatch(/<g class="topo-badge small">.*>11</)
    // 其他路線的編號在線的下段（起點附近），畫面中間留給主角
    const small = html.match(/<g class="topo-badge small"><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/)!
    expect(Number(small[1]) + Number(small[2]) / 2).toBeGreaterThan(photo.height * 0.7)
    expect(html).toContain('路線甲')
    expect(html).not.toContain('路線乙')
    expect(count(html, /topo-route kind-other dim/g)).toBeGreaterThan(0)
  })

  it('顏色依種類：運攀藍色，其他（傳攀、上方架繩、抱石、混合）紅色', () => {
    const html = render(1)
    expect(html).toContain('topo-route kind-sport')
    expect(html).toContain('topo-route kind-other')
    expect(html).not.toContain('kind-trad')
  })

  it('每條路線（不只選到的）放得下就標完整的難度與名稱，說明緊貼在自己的編號旁邊', () => {
    for (const k of [0.5, 1, 3]) {
      const html = render(k, { highlight: 'a' })
      for (const [id, name] of [['a', '路線甲'], ['b', '路線乙']] as const) {
        const group = html.match(new RegExp(`<g class="topo-route [^"]*">(?:(?!<g class="topo-route).)*>${labels.get(id)}</text>(?:(?!<g class="topo-route).)*`))![0]
        expect(group, `k=${k} ${id}`).toContain(name)
        const [x, y, w, h] = group.match(/<g class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/)!.slice(1).map(Number)
        const spans = [...group.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]+)</g)].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), w: textWidth(m[3], 10) * k }))
        const left = Math.min(...spans.map((t) => t.cx - t.w / 2))
        const right = Math.max(...spans.map((t) => t.cx + t.w / 2))
        const top = Math.min(...spans.map((t) => t.cy)) - 6.25 * k
        const bottom = Math.max(...spans.map((t) => t.cy)) + 6.25 * k
        // 和編號的距離：右邊、左邊、下面或上面，間隔 4 個螢幕像素
        const gap = Math.max(left - (x + w), x - right, top - (y + h), y - bottom)
        expect(gap, `k=${k} ${id}`).toBeLessThanOrEqual(4 * k + 0.5)
      }
    }
  })

  it('bolt、anchor 只在 bolts 指定的路線顯示；看的時候是小牌子只有 ×，旁邊夠寬才標種類；編輯時標位置', () => {
    expect(count(render(1), /class="topo-bolt/g)).toBe(0)
    const html = render(1, { bolts: ['a'] })
    expect(count(html, /class="topo-bolt/g)).toBe(2)
    expect(html).toContain('>316-TW<')
    expect(html).toContain('>××<')
    expect(html).toContain('>×<')
    expect(html).not.toContain('B01')
    expect(html).toMatch(/<g class="topo-bolt"><rect [^>]*height="12"/)
    // 縮小到兩條線只隔 60 個螢幕像素：只有 ×，沒有種類
    const far = render(10, { bolts: ['a'] })
    expect(count(far, /class="topo-bolt/g)).toBe(2)
    expect(far).not.toContain('316-TW')
    expect(render(1, { bolts: ['a'], editing: true })).toContain('>× B01<')
  })

  it('bolt 的說明只有種類（材質），沒有年份', () => {
    const route = { id: 'r', type: 'sport', grade: '5.10a', name: { zh: '甲' }, bolts: [{ position: 'B01', material: '316-TW', installed: '2007' }], anchors: [{ position: 'A01', material: 'Ti-U', installed: '2021' }] } as unknown as Route
    expect(routeInfo([route], () => '甲').get('r')!.bolts).toEqual({ B01: '316-TW', A01: 'Ti-U' })
  })

  it('編輯時：線比較細、沒有難度名稱等說明，編號不蓋在選到的路線的點上，bolt 照樣顯示', () => {
    const k = 2
    const html = render(k, { highlight: 'a', bolts: ['a'], editing: true })
    expect(html).not.toContain('topo-note')
    expect(count(html, /class="topo-bolt/g)).toBe(2)
    const widths = [...html.matchAll(/class="topo-line" d="[^"]*" stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]) / k)
    expect(widths.length).toBeGreaterThan(0)
    expect(Math.max(...widths)).toBeLessThanOrEqual(2)
    const points = marks.a.line!.map(([x, y]) => [(x * photo.width) / 10000, (y * photo.height) / 10000])
    for (const m of html.matchAll(/class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      const [x, y, w, h] = m.slice(1).map(Number)
      for (const [px, py] of points) expect(px > x - 12 * k && px < x + w + 12 * k && py > y - 12 * k && py < y + h + 12 * k).toBe(false)
    }
  })

  it('分岔的路線：編號各自標在自己的岔線上，不標在共用的前段', () => {
    // 共用的前段比岔線長：整條線的正中間落在前段（x = 1000 像素）
    const fork: Marks = {
      a: { line: [[5000, 9500], [5000, 3000], [4000, 1000]] },
      b: { line: [[5000, 9500], [5000, 3000], [6000, 1000]] },
    }
    const html = renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo, marks: fork, labels, k: 1 })))
    const centers = [...html.matchAll(/class="topo-badge"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[3]) / 2)
    expect(centers).toHaveLength(2)
    expect(centers[0]).toBeLessThan(1000)
    expect(centers[1]).toBeGreaterThan(1000)
  })

  it('編號、bolt 畫在所有路線的線上面，不會被別條線蓋住', () => {
    const html = render(1, { bolts: ['a'] })
    expect(html.lastIndexOf('class="topo-line"')).toBeLessThan(html.indexOf('class="topo-badge"'))
    expect(html.lastIndexOf('class="topo-line"')).toBeLessThan(html.indexOf('class="topo-bolt'))
  })

  it('縮得很小，放不下的編號不標；路線卡片的主角仍然標', () => {
    expect(count(render(60), /class="topo-badge"/g)).toBe(0)
    expect(count(render(60, { highlight: 'a', solo: true }), /class="topo-badge"/g)).toBe(1)
  })

  it('看整張照片：換選到的路線只換顏色，牌子的位置、線的粗細都不變', () => {
    for (const k of [0.4, 1, 2]) {
      // 選到的路線畫在最上面（順序會變）：比較每個圖形的位置與大小
      const shape = (html: string) => [...html.matchAll(/<(rect|circle|path|tspan)\b[^>]*>/g)].map((m) => m[0]).sort().join('\n')
      const none = shape(render(k, { bolts: ['a', 'b'] }))
      expect(shape(render(k, { highlight: 'a', bolts: ['a', 'b'] }))).toBe(none)
      expect(shape(render(k, { highlight: 'b', bolts: ['a', 'b'] }))).toBe(none)
    }
  })

  it('很短的線（從照片下緣出去的示意線，例如 565）：其他編號放好之後，有空位照樣標', () => {
    const withSketch: Marks = { ...marks, c: { line: [[1000, 9990], [1030, 9900], [1050, 9800]] } }
    const sketchLabels = new Map([...labels, ['c', '9']])
    const html = renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo, marks: withSketch, labels: sketchLabels, k: 1, info })))
    expect(html).toContain('>9<')
    expect(html).toContain('>10<')
    expect(html).toContain('>11<')
  })

  it('同一張 Topo 的編號、bolt、難度名稱、bolt 材質一起排：不論縮放，彼此都不重疊；名稱太長時換行', () => {
    // 很擠的一面牆：六條路線靠在一起，名稱很長，每條都有 bolt
    const crowded: Marks = {}
    const crowdedInfo = new Map<string, RouteInfo>()
    const crowdedLabels = new Map<string, string>()
    for (let i = 0; i < 6; i++) {
      const x = 2000 + i * 900
      crowded[`r${i}`] = { line: [[x, 9200], [x + 150, 5000], [x, 900]], bolts: { B01: [x + 100, 7500], B02: [x + 140, 4500], A01: [x, 1200] } }
      crowdedLabels.set(`r${i}`, String(i + 1))
      crowdedInfo.set(`r${i}`, { kind: i % 2 ? 'sport' : 'other', grade: '5.11c', name: `一條名字非常非常長的路線${i}`, bolts: { B01: '316-TW', B02: 'Ti-U', A01: '316-TW' } })
    }
    const ids = Object.keys(crowded)
    for (const k of [0.4, 0.8, 1.5, 3]) {
      const html = renderToStaticMarkup(createElement('svg', null, createElement(TopoLines, { photo, marks: crowded, labels: crowdedLabels, k, info: crowdedInfo, highlight: 'r2', bolts: ids })))
      const boxes: { x: number; y: number; w: number; h: number; what: string }[] = []
      for (const m of html.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
        const [x, y, w, h] = m.slice(1).map(Number)
        boxes.push({ x, y, w, h, what: 'rect' })
      }
      for (const m of html.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]+)</g)) {
        const [cx, cy] = [Number(m[1]), Number(m[2])]
        const w = textWidth(m[3], 10) * k
        const h = 12.5 * k
        boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, what: m[3] })
      }
      expect(boxes.length).toBeGreaterThan(6)
      for (let a = 0; a < boxes.length; a++)
        for (let b = a + 1; b < boxes.length; b++) {
          const [p, q] = [boxes[a], boxes[b]]
          const hit = p.x < q.x + q.w - 0.01 && q.x < p.x + p.w - 0.01 && p.y < q.y + q.h - 0.01 && q.y < p.y + p.h - 0.01
          expect(hit, `k=${k}: ${p.what} 和 ${q.what} 重疊`).toBe(false)
        }
      // 擠的時候換方向、換行，盡量都顯示：每條路線都有難度與名稱，bolt 的材質放不下一行時分兩行
      const lines = [...html.matchAll(/<tspan[^>]*>([^<]+)</g)].map((m) => m[1])
      if (k === 1.5) {
        expect(lines.filter((t) => t === '5.11c')).toHaveLength(6)
        // 編號沿著線移動找空位：每條都標得出完整的名稱（可以換行），不只留難度
        for (let i = 0; i < 6; i++) expect(lines.join(''), `路線${i}`).toContain(`一條名字非常非常長的路線${i}`)
      }
    }
  })
})
