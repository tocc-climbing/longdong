import type { Mark, Node, TopoData } from '../../vendor/climbio-topokit/index.js'
import { isFullCrop, px, type Crop, type Marks, type TopoImage } from '../core/topo/geometry'
import type { RouteInfo } from './routeInfo'

/**
 * 龍洞的標記（萬分比）→ TopoKit 的 v2 照片畫面＋圖層（照片像素）。
 * 路線節點的 id 是路線 ID（pick 事件回傳的就是它）；編號、種類、難度、名稱、bolt 材質從路線資料來。
 * minLine：線段至少幾個點才畫；編輯器的草稿可能有只點了一個點的線（給 1，接著畫得下去）。
 */
export function topoData(photo: TopoImage, href: string, marks: Marks, crop: Crop | undefined, labels: Map<string, string>, info: Map<string, RouteInfo>, minLine = 2): TopoData {
  const nodes: Node[] = []
  const out: Mark[] = []
  for (const [id, m] of Object.entries(marks)) {
    const r = info.get(id)
    nodes.push({ id, type: 'route', ...(r?.name ? { name: r.name } : {}), props: { style: r?.kind === 'sport' ? 'sport' : 'other', ...(r?.grade ? { grade: r.grade } : {}) } })
    const label = labels.get(id)
    if (m.line && m.line.length >= minLine) out.push({ node: id, geometry: { type: 'LineString', coordinates: m.line.map((p) => px(photo, p)) }, ...(label ? { props: { label } } : {}) })
    for (const [pos, at] of Object.entries(m.bolts ?? {})) {
      const bolt = `${id}-${pos}`
      const note = r?.bolts[pos]
      nodes.push({ id: bolt, type: pos.startsWith('A') ? 'anchor' : 'bolt', parent: id, name: pos })
      out.push({ node: bolt, geometry: { type: 'Point', coordinates: px(photo, at) }, ...(note ? { props: { label: note } } : {}) })
    }
  }
  const [cx, cy] = crop ? px(photo, [crop.x, crop.y]) : [0, 0]
  const [cw, ch] = crop ? px(photo, [crop.w, crop.h]) : [0, 0]
  return {
    view: { climbio: 2, kind: 'view', surface: 'photo', id: photo.image, href, w: photo.width, h: photo.height, ...(crop && !isFullCrop(crop) ? { props: { crop: { x: cx, y: cy, w: cw, h: ch } } } : {}) },
    layers: [{ climbio: 2, kind: 'layer', id: 'marks', on: photo.image, nodes, marks: out }],
  }
}
