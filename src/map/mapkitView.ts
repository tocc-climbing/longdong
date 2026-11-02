import type { MapView, Mark, Node, Text } from '../../vendor/climbio-format/format'
import type { LoadedData } from '../data/dataset'
import type { LocalizedName } from '../data/schema'
import { unproject, type ScaleMapData } from './mapData'
import { LINE_TARGETS } from './shapes'

/**
 * 地圖（mapkit）用的 v2 地圖畫面：建置時產生的底圖（public/rescue/kitbase.json，scripts/gen-kit-base.ts）
 * 加上套了地圖編輯的區域、岩壁、頁框裡的道路與步道線（App 已經載入的 ScaleMapData）。
 * 區域、分區節點的 id 就是區域 ID、分區 ID：mapkit 的事件（點到岩壁、長按區域）直接拿來用。
 */

/** 大區域的顏色（同 src/map/map.css 的 .sm-area-*） */
export const AREA_COLORS: Record<string, { fill: string; stroke: string }> = {
  'school-gate': { fill: '#f2b4c6', stroke: '#d40441' },
  clocktower: { fill: '#dab2d2', stroke: '#820068' },
  'long-lane': { fill: '#b3c6d8', stroke: '#01417f' },
  'music-hall': { fill: '#ceedf1', stroke: '#5dc2d0' },
  'grand-auditorium': { fill: '#d0d6c2', stroke: '#627534' },
  'first-cave': { fill: '#e4eeb3', stroke: '#a6c702' },
  'second-cave': { fill: '#f9e8b2', stroke: '#edb100' },
  'golden-valley': { fill: '#fcdcb7', stroke: '#eb640a' },
  'back-door': { fill: '#e2b2b2', stroke: '#a00000' },
}

/** 頁框裡可以編輯的線（highway、tunnel、road、trail） */
const EDITABLE_LINES = new Set<string>(Object.values(LINE_TARGETS))

/** 完整的龍洞地圖畫面（scripts/lib/climbioMap.ts）→ 底圖：拿掉區域、分區與頁框裡的線（App 套上地圖編輯後再組上去）、拿掉和路線資料有關的欄位 */
export function kitBaseOf(view: MapView): MapView {
  const dropped = new Set((view.nodes ?? []).filter((n) => n.type === 'area' || n.type === 'sector').map((n) => n.id))
  const keep = (m: Mark) => (m.node ? !dropped.has(m.node) : !(EDITABLE_LINES.has(String(m.props?.kind)) && m.props?.source !== 'osm'))
  const { name: _name, t: _t, ...rest } = view
  return { ...rest, nodes: (view.nodes ?? []).filter((n) => !dropped.has(n.id)), marks: (view.marks ?? []).filter(keep) } as MapView
}

const text = (n: LocalizedName): Text => ({ 'zh-Hant': n.zh, ...(n.en ? { en: n.en } : {}) })
const lngLat = ([x, y]: [number, number]): [number, number] => {
  const [lat, lng] = unproject([x, y])
  return [lng, lat]
}
const closed = (r: [number, number][]) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]])

/** 底圖加上這份地圖資料（已套地圖編輯）的區域、岩壁、可以編輯的線 */
export function kitMapView(base: MapView, map: ScaleMapData, data: LoadedData): MapView {
  const crag = data.dataset.crag.id
  const nodes: Node[] = []
  const marks: Mark[] = []
  for (const [kind, lines] of Object.entries(map.lineLayers)) {
    if (lines.length) marks.push({ geometry: { type: 'MultiLineString', coordinates: lines.map((l) => l.map(lngLat)) }, props: { kind } })
  }
  for (const a of map.areas) {
    const area = data.areaById.get(`${crag}/${a.id}`)
    if (!area) continue
    nodes.push({ id: area.id, type: 'area', name: text(area.name), props: { code: area.id } })
    marks.push({ node: area.id, geometry: { type: 'MultiPolygon', coordinates: a.rings.map((r) => [closed(r.map(lngLat))]) }, props: { style: AREA_COLORS[a.id] } })
  }
  for (const [id, lines] of Object.entries(map.walls)) {
    const shown = lines.filter((l) => l.length >= 2)
    const found = data.sectorById.get(id)
    if (!shown.length || !found) continue
    nodes.push({ id, type: 'sector', parent: found.area.id, name: text(found.sector.name), props: { code: id } })
    marks.push({ node: id, geometry: { type: 'MultiLineString', coordinates: shown.map((l) => l.map(([lat, lng]): [number, number] => [lng, lat])) }, props: { style: { stroke: AREA_COLORS[found.area.id.split('/').pop()!]?.stroke } } })
  }
  return { ...base, nodes: [...(base.nodes ?? []), ...nodes], marks: [...(base.marks ?? []), ...marks] }
}
