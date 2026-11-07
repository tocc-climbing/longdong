import { describe, expect, it } from 'vitest'
import type { Marks } from '../src/core/topo/geometry'
import type { TopoPhoto } from '../src/topo/model'
import { textWidth } from '../vendor/climbio-topokit/index.js'
import type { Route } from '../src/data/schema'
import { routeInfo } from '../src/topo/routeInfo'
import type { RouteInfo } from '../src/topo/routeInfo'
import { topoLines } from './helpers/topoLines'
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
const render = (k: number, extra: object = {}) => topoLines({ photo, marks, labels, k, info, ...extra })
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length

describe('Topo 標記的自動排版（畫面上的大小）', () => {
  it('看的時候起點、終點都是同樣大小的實心圓點；線沒有白邊；編輯時正在編的那條不畫（點都有把手）', () => {
    expect(count(render(1), /class="topo-dot"/g)).toBe(4)
    expect(render(1)).toContain('class="topo-dot" cx="600" cy="100" r="3.2"')
    expect(render(1)).toContain('class="topo-dot" cx="600" cy="900" r="3.2"')
    expect(render(1)).not.toContain('topo-halo')
    expect(count(render(1, { editing: true, highlight: 'a' }), /class="topo-dot"/g)).toBe(2)
  })

  it('實際的 Topo（校門口 · 騙人的牆，565–569）：每條的編號牌都帶難度、不顯示名稱（龍洞一張 Topo 路線多）；示意線的編號在箭頭正上方', () => {
    const real = schoolGate as unknown as { photo: TopoPhoto; crop: { x: number; y: number; w: number; h: number }; marks: Marks; routes: { id: string; number: string; grade: string; name: string; type: string }[] }
    const realLabels = new Map(real.routes.map((r) => [r.id, r.number]))
    const realInfo = new Map<string, RouteInfo>(real.routes.map((r) => [r.id, { kind: r.type === 'sport' ? 'sport' : 'other', grade: r.grade, name: r.name, bolts: {} }]))
    // 手機的分區頁約 340 個螢幕像素寬、全螢幕約 375（k = 照片像素／螢幕像素）
    const cropPx = (real.crop.w / 10000) * real.photo.width
    for (const screen of [340, 375]) {
      const fit = topoLines({ photo: real.photo, marks: real.marks, labels: realLabels, k: cropPx / screen, info: realInfo, crop: real.crop })
      expect(count(fit, /class="topo-badge"/g), `${screen}px`).toBe(real.routes.length)
      expect(fit, `${screen}px`).not.toContain('topo-note')
    }
    for (const screen of [340 * 3, 375 * 3]) {
      const k = cropPx / screen
      const html = topoLines({ photo: real.photo, marks: real.marks, labels: realLabels, k, info: realInfo, crop: real.crop })
      for (const r of real.routes) {
        const group = html.match(new RegExp(`<g class="topo-route [^"]*">(?:(?!<g class="topo-route).)*>${r.number}</text>(?:(?!<g class="topo-route).)*`))?.[0] ?? ''
        expect(group, `${screen}px #${r.number}`).toContain('class="topo-grade"')
        expect(group, `${screen}px #${r.number}`).toContain(`>${r.grade}<`)
        expect(group, `${screen}px #${r.number}`).not.toContain(r.name)
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
    const draw = (screen: number) => topoLines({ photo: real.photo, marks: real.marks, labels: realLabels, k: cropPx / screen, info: realInfo, crop: real.crop, bolts: Object.keys(real.marks) })
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

  it('編號照路線書的習慣放在起點正下方，牌子右段是難度', () => {
    const html = render(1)
    for (const id of ['a', 'b'] as const) {
      const group = html.match(new RegExp(`<g class="topo-route [^"]*">(?:(?!<g class="topo-route).)*>${labels.get(id)}</text>(?:(?!<g class="topo-route).)*`))![0]
      const [x, y, w] = group.match(/<g class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)"/)!.slice(1).map(Number)
      const [sx, sy] = marks[id].line![0].map((v, i) => (v / 10000) * (i ? photo.height : photo.width))
      expect(Math.abs(x + w / 2 - sx), id).toBeLessThan(1)
      expect(y, id).toBeGreaterThan(sy)
      expect(group, id).toContain(`>${info.get(id)!.grade}<`)
    }
  })

  it('solo（路線卡片）：選到的路線標編號與說明，其他路線只標小的編號、變淡', () => {
    const html = render(0.5, { highlight: 'a', solo: true })
    expect(html).toContain('<g class="topo-badge">')
    expect(html).toMatch(/<g class="topo-badge small">.*>11</)
    // 其他路線的編號在線的下段（起點附近），畫面中間留給主角
    const small = html.match(/<g class="topo-badge small"><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/)!
    expect(Number(small[1]) + Number(small[2]) / 2).toBeGreaterThan(photo.height * 0.7)
    expect(html).toContain('>5.10a<')
    expect(html).not.toContain('路線甲')
    expect(count(html, /topo-route kind-other dim/g)).toBeGreaterThan(0)
  })

  it('顏色依種類：運攀藍色，其他（傳攀、上方架繩、抱石、混合）紅色', () => {
    const html = render(1)
    expect(html).toContain('topo-route kind-sport')
    expect(html).toContain('topo-route kind-other')
    expect(html).not.toContain('kind-trad')
  })

  it('每條路線（不只選到的）的編號牌都帶難度，名稱不顯示', () => {
    for (const k of [0.5, 1, 3]) {
      const html = render(k, { highlight: 'a' })
      for (const [id, name] of [['a', '路線甲'], ['b', '路線乙']] as const) {
        const group = html.match(new RegExp(`<g class="topo-route [^"]*">(?:(?!<g class="topo-route).)*>${labels.get(id)}</text>(?:(?!<g class="topo-route).)*`))![0]
        expect(group, `k=${k} ${id}`).toContain(`>${info.get(id)!.grade}<`)
        expect(group, `k=${k} ${id}`).not.toContain(name)
      }
    }
  })

  it('bolt、anchor 只在 bolts 指定的路線顯示；小牌子只有 ×，旁邊夠寬才標種類；龍洞管理 bolt 編號，編輯時標位置', () => {
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
    expect(render(1, { bolts: ['a'], editing: true, boltCodes: true })).toContain('>× B01<')
  })

  it('bolt 的說明只有種類（材質），沒有年份', () => {
    const route = { id: 'r', type: 'sport', grade: '5.10a', name: { zh: '甲' }, bolts: [{ position: 'B01', material: '316-TW', installed: '2007' }], anchors: [{ position: 'A01', material: 'Ti-U', installed: '2021' }] } as unknown as Route
    expect(routeInfo([route], () => '甲').get('r')!.bolts).toEqual({ B01: '316-TW', A01: 'Ti-U' })
  })

  it('編輯時就是最後的樣子（線的粗細、編號牌帶難度），編號不蓋在選到的路線的點上，bolt 照樣顯示', () => {
    const k = 2
    const html = render(k, { highlight: 'a', bolts: ['a'], editing: true })
    expect(count(html, /class="topo-bolt/g)).toBe(2)
    const widths = (h: string) => [...h.matchAll(/class="topo-line" d="[^"]*" stroke-width="([\d.]+)"/g)].map((m) => Number(m[1])).sort()
    // 其他路線跟看的時候一樣粗；正在編的那條粗一點
    expect(Math.min(...widths(html))).toBe(Math.min(...widths(render(k, { highlight: 'a', bolts: ['a'] }))))
    expect(html).toContain('>5.10a<')
    const points = marks.a.line!.map(([x, y]) => [(x * photo.width) / 10000, (y * photo.height) / 10000])
    for (const m of html.matchAll(/class="topo-badge"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      const [x, y, w, h] = m.slice(1).map(Number)
      for (const [px, py] of points) expect(px > x - 12 * k && px < x + w + 12 * k && py > y - 12 * k && py < y + h + 12 * k).toBe(false)
    }
  })

  it('分岔的路線：主線的編號在起點下面，岔出去的標在自己的岔線上', () => {
    // 共用的前段比岔線長：整條線的正中間落在前段（x = 1000 像素）
    const fork: Marks = {
      a: { line: [[5000, 9500], [5000, 3000], [4000, 1000]] },
      b: { line: [[5000, 9500], [5000, 3000], [6000, 1000]] },
    }
    const html = topoLines({ photo, marks: fork, labels, k: 1 })
    const centers = [...html.matchAll(/class="topo-badge"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[3]) / 2)
    expect(centers).toHaveLength(2)
    expect(centers.filter((c) => Math.abs(c - 1000) < 1)).toHaveLength(1)
    expect(centers.filter((c) => c > 1000 + 1)).toHaveLength(1)
  })

  it('編號、bolt 畫在所有路線的線上面，不會被別條線蓋住', () => {
    const html = render(1, { bolts: ['a'] })
    expect(html.lastIndexOf('class="topo-line"')).toBeLessThan(html.indexOf('class="topo-badge"'))
    expect(html.lastIndexOf('class="topo-line"')).toBeLessThan(html.indexOf('class="topo-bolt'))
  })

  it('縮得很小，放不下的編號不標；路線卡片的主角仍然標', () => {
    expect(count(render(80), /class="topo-badge"/g)).toBe(0)
    expect(count(render(80, { highlight: 'a', solo: true }), /class="topo-badge"/g)).toBe(1)
  })

  it('路線擠的時候編號牌自動精簡：先縮小，再擠只留編號、不帶難度；放大回來又帶難度', () => {
    expect(render(1)).toContain('topo-grade-bg')
    const crowded = render(60)
    expect(count(crowded, /class="topo-badge"/g)).toBe(1)
    expect(crowded).not.toContain('topo-grade-bg')
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
    const html = topoLines({ photo, marks: withSketch, labels: sketchLabels, k: 1, info })
    expect(html).toContain('>9<')
    expect(html).toContain('>10<')
    expect(html).toContain('>11<')
  })

  it('同一張 Topo 的編號、bolt、bolt 材質一起排：不論縮放，彼此都不重疊', () => {
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
      const html = topoLines({ photo, marks: crowded, labels: crowdedLabels, k, info: crowdedInfo, highlight: 'r2', bolts: ids })
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
      // 每條路線的編號牌都帶難度，名稱不顯示
      if (k === 1.5) {
        expect(count(html, />5\.11c</g)).toBe(6)
        expect(html).not.toContain('一條名字非常非常長的路線')
      }
    }
  })
})
