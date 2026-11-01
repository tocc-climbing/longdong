import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { distanceToLine, textWidth, type Pt } from '../src/core/topo/annotate'
import type { Marks } from '../src/core/topo/geometry'
import type { TopoPhoto } from '../src/topo/model'
import { TopoLines, type RouteInfo } from '../src/core/topo/TopoView'
import { isSketch } from '../src/core/topo/viewport'
import schoolGate from './fixtures/topo-school-gate.json'

/**
 * 實際的 Topo（校門口 · 騙人的牆，565–569）在各種螢幕寬度、縮放倍率、bolt 開關下排版，每一種都檢查同一組規則：
 * 每條路線都有編號、編號在自己的線上（示意線在箭頭正上方）、說明緊貼自己的編號、bolt 的種類緊貼自己的 bolt、彼此不重疊。
 */
const real = schoolGate as unknown as { photo: TopoPhoto; crop: { x: number; y: number; w: number; h: number }; marks: Marks; routes: { id: string; number: string; grade: string; name: string; type: string }[] }
const labels = new Map(real.routes.map((r) => [r.id, r.number]))
const info = new Map<string, RouteInfo>(
  real.routes.map((r) => [r.id, { kind: r.type === 'sport' ? 'sport' : 'other', grade: r.grade, name: r.name, bolts: Object.fromEntries(Object.keys(real.marks[r.id]?.bolts ?? {}).map((p) => [p, '316-TW'])) }]),
)
const cropPx = (real.crop.w / 10000) * real.photo.width
const toPx = ([x, y]: [number, number]): Pt => [(x / 10000) * real.photo.width, (y / 10000) * real.photo.height]
const lineOf = (id: string) => real.marks[id].line!.map(toPx)

interface Box {
  x: number
  y: number
  w: number
  h: number
}
const NOTE_LINE = 12.5
const RECT = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/
const rectOf = (s: string): Box => {
  const [x, y, w, h] = s.match(RECT)!.slice(1).map(Number)
  return { x, y, w, h }
}
/** 說明文字的框（由每一行的中心與估計的字寬算） */
const noteOf = (s: string | undefined, k: number): Box | undefined => {
  if (!s) return undefined
  const spans = [...s.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]+)</g)].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), w: textWidth(m[3], 10) * k }))
  const x = Math.min(...spans.map((t) => t.cx - t.w / 2))
  const y = Math.min(...spans.map((t) => t.cy)) - (NOTE_LINE * k) / 2
  return { x, y, w: Math.max(...spans.map((t) => t.cx + t.w / 2)) - x, h: spans.length * NOTE_LINE * k }
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01
/** 說明貼著牌子：正右、正左、正上、正下，距離不超過 gap */
const adjacent = (pill: Box, note: Box, gap: number) => {
  const sameRow = note.y < pill.y + pill.h && note.y + note.h > pill.y
  const sameCol = note.x < pill.x + pill.w && note.x + note.w > pill.x
  const d = Math.max(note.x - (pill.x + pill.w), pill.x - (note.x + note.w), note.y - (pill.y + pill.h), pill.y - (note.y + note.h))
  return (sameRow || sameCol) && d <= gap
}

function layout(screen: number, zoom: number, bolts: boolean) {
  const k = cropPx / (screen * zoom)
  const html = renderToStaticMarkup(
    createElement('svg', null, createElement(TopoLines, { photo: real.photo, marks: real.marks, labels, k, info, crop: real.crop, bolts: bolts ? Object.keys(real.marks) : [] })),
  )
  // 牌子那一層：每條路線一個 <g class="topo-route">，裡面依序是 bolt、編號、說明
  const groups = [...html.matchAll(/<g class="topo-route [^"]*">((?:(?!<g class="topo-route ).)*)/g)].map((m) => m[1]).filter((g) => g.includes('topo-badge'))
  const routes = groups.map((g) => {
    const badge = g.match(/<g class="topo-badge">(<rect[^>]*><\/rect><text[^>]*>([^<]+)<\/text>)<\/g>(<text class="topo-note".*?<\/text>)?/)!
    const id = real.routes.find((r) => r.number === badge[2])!.id
    const boltList = [...g.matchAll(/<g class="topo-bolt[^"]*">(<rect[^>]*><\/rect>)<text[^>]*>[^<]*<\/text>(<text class="topo-note".*?<\/text>)?<\/g>/g)].map((m) => ({ pill: rectOf(m[1]), note: noteOf(m[2], k) }))
    return { id, number: badge[2], pill: rectOf(badge[1]), note: noteOf(badge[3], k), bolts: boltList }
  })
  return { k, html, routes }
}

const cases = [340, 375].flatMap((screen) => [1, 1.25, 1.5, 2, 2.5, 3, 4, 6].flatMap((zoom) => [false, true].map((bolts) => ({ screen, zoom, bolts }))))

describe('實際 Topo 的排版：各種縮放都符合規則', () => {
  it.each(cases)('螢幕 $screen px、放大 $zoom 倍、bolt $bolts', ({ screen, zoom, bolts }) => {
    const { k, html, routes } = layout(screen, zoom, bolts)
    const where = `${screen}px ×${zoom} bolt=${bolts}`
    // 每條路線都有編號
    expect(routes.map((r) => r.number).sort(), where).toEqual(real.routes.map((r) => r.number).sort())
    const boxes: { box: Box; what: string }[] = []
    for (const r of routes) {
      const c: Pt = [r.pill.x + r.pill.w / 2, r.pill.y + r.pill.h / 2]
      if (isSketch(real.photo, real.crop, real.marks[r.id])) {
        // 示意線：終點是看得到的箭頭，編號在箭頭正上方、緊貼著
        const [ex] = lineOf(r.id).at(-1)!
        const arrow = [...html.matchAll(/<path class="topo-dot" d="M([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]).find(([x]) => Math.abs(x - ex) < 0.01)
        expect(arrow, `${where} #${r.number} 箭頭`).toBeDefined()
        const tip = arrow![1]
        expect(Math.abs(c[0] - ex), `${where} #${r.number} 在箭頭正上方`).toBeLessThan(0.5)
        expect(tip - (r.pill.y + r.pill.h), `${where} #${r.number} 緊貼箭頭`).toBeGreaterThanOrEqual(0)
        expect(tip - (r.pill.y + r.pill.h), `${where} #${r.number} 緊貼箭頭`).toBeLessThanOrEqual(4 * k + 0.5)
      } else {
        // 編號在自己的線上，而且離自己的線比離別條線近
        expect(distanceToLine(c, lineOf(r.id)), `${where} #${r.number} 在線上`).toBeLessThan(2 * k)
      }
      if (r.note) expect(adjacent(r.pill, r.note, 4 * k + 0.5), `${where} #${r.number} 說明貼著編號`).toBe(true)
      for (const b of r.bolts) if (b.note) expect(adjacent(b.pill, b.note, 4 * k + 0.5), `${where} #${r.number} bolt 種類貼著 bolt`).toBe(true)
      boxes.push({ box: r.pill, what: `#${r.number}` }, ...(r.note ? [{ box: r.note, what: `#${r.number} 說明` }] : []))
      for (const b of r.bolts) boxes.push({ box: b.pill, what: `#${r.number} bolt` }, ...(b.note ? [{ box: b.note, what: `#${r.number} bolt 種類` }] : []))
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i].box, boxes[j].box), `${where}：${boxes[i].what} 和 ${boxes[j].what} 重疊`).toBe(false)
  })
})
