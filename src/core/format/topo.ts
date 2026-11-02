import type { Camera, Layer, Mark, Node, PhotoView } from '../../../vendor/climbio-format/format'
import { isFullCrop, SCALE, type Crop, type Marks, type Point } from '../topo/geometry'

/**
 * Topo 與 Climbio 公開格式 v2（見 vendor/climbio-format/README.md）互轉：照片是照片畫面（kind: view），
 * 路線線段與 bolt 是疊在上面的圖層（kind: layer）。
 * 內部的座標是照片寬、高的萬分比，v2 是照片像素（以畫面的 w、h 為準）。
 * 萬分比換成像素不失真（整數乘整數再除以 10000）；像素換回萬分比時取最近的整數。
 * 線段的標註指向路線的全域 id；bolt、anchor 是路線底下的節點（本地 id「路線全域 id-位置」），加上一個 Point 標註。
 */

export interface TopoViewSource {
  id: string
  name?: string
  author?: string
  /** 照片的授權（SPDX）、署名與來源（self 自己的、authorized 有權利人的授權） */
  license: string
  attribution: string
  origin: 'self' | 'authorized'
  /** 最後修改時間（毫秒） */
  t: number
  source?: PhotoView['source']
  href: string
  w: number
  h: number
  mime: PhotoView['mime']
  sha256?: string
  camera?: Camera
  crop?: Crop
}

export interface TopoLayerSource {
  id: string
  /** 疊在哪個照片畫面上 */
  view: PhotoView
  /** 那個畫面在哪裡（相對路徑或網址） */
  href?: string
  author?: string
  license: string
  attribution?: string
  t: number
  source?: Layer['source']
  marks: Marks
  /** 路線 ID → 全域 id */
  globalId: (routeId: string) => string
}

type Size = { w: number; h: number }

const toPx = ([x, y]: Point, { w, h }: Size): [number, number] => [(x * w) / SCALE, (y * h) / SCALE]
const fromPx = ([x, y]: number[], { w, h }: Size): Point => [Math.round((x * SCALE) / w), Math.round((y * SCALE) / h)]

/** bolt 的位置 A01… 是 anchor，B01… 是 bolt（同路線資料的 position） */
const boltType = (position: string) => (position.startsWith('A') ? 'anchor' : 'bolt')
const boltId = (route: string, position: string) => `${route}-${position.toLowerCase()}`

/** 裁切在 props.crop（像素）；整張照片不寫 */
export function toTopoView(src: TopoViewSource): PhotoView {
  const c = src.crop
  return {
    climbio: 2,
    kind: 'view',
    surface: 'photo',
    id: src.id,
    ...(src.name ? { name: src.name } : {}),
    t: src.t,
    license: src.license,
    attribution: src.attribution,
    ...(src.author ? { author: src.author } : {}),
    origin: src.origin,
    ...(src.source ? { source: src.source } : {}),
    href: src.href,
    w: src.w,
    h: src.h,
    mime: src.mime,
    ...(src.sha256 ? { sha256: src.sha256 } : {}),
    ...(src.camera ? { camera: src.camera } : {}),
    ...(c && !isFullCrop(c) ? { props: { crop: { x: (c.x * src.w) / SCALE, y: (c.y * src.h) / SCALE, w: (c.w * src.w) / SCALE, h: (c.h * src.h) / SCALE } } } : {}),
  }
}

/** 沒有任何標記的路線、只有一點的線段不輸出（同資料庫的存法，見 topo/model.ts 的 encodeMarks） */
export function toTopoLayer(src: TopoLayerSource): Layer {
  const nodes: Node[] = []
  const marks: Mark[] = []
  for (const [routeId, m] of Object.entries(src.marks)) {
    const route = src.globalId(routeId)
    if (m.line && m.line.length >= 2) marks.push({ node: route, geometry: { type: 'LineString', coordinates: m.line.map((p) => toPx(p, src.view)) } })
    for (const [position, p] of Object.entries(m.bolts ?? {})) {
      const id = boltId(route, position)
      nodes.push({ id, type: boltType(position), parent: route, name: position })
      marks.push({ node: id, geometry: { type: 'Point', coordinates: toPx(p, src.view) } })
    }
  }
  return {
    climbio: 2,
    kind: 'layer',
    id: src.id,
    on: src.view.id,
    ...(src.href ? { href: src.href } : {}),
    t: src.t,
    license: src.license,
    ...(src.attribution ? { attribution: src.attribution } : {}),
    ...(src.author ? { author: src.author } : {}),
    ...(src.source ? { source: src.source } : {}),
    ...(nodes.length ? { nodes } : {}),
    marks,
  }
}

/** v2 的照片畫面與線段圖層換回內部的標記與裁切（兩份都先通過 validate）；routeId：全域 id → 路線 ID，不認得的路線略過 */
export function fromTopo(view: PhotoView, layer: Layer, routeId: (globalId: string) => string | undefined): { marks: Marks; crop?: Crop } {
  const nodes = new Map((layer.nodes ?? []).map((n) => [n.id, n]))
  const marks: Marks = {}
  for (const mark of layer.marks ?? []) {
    const node = mark.node === undefined ? undefined : nodes.get(mark.node)
    const route = routeId(node?.parent ?? mark.node ?? '')
    if (!route) continue
    const m = (marks[route] ??= {})
    const g = mark.geometry
    if (node && g.type === 'Point' && typeof node.name === 'string') m.bolts = { ...m.bolts, [node.name]: fromPx(g.coordinates, view) }
    else if (!node && g.type === 'LineString') m.line = g.coordinates.map((p) => fromPx(p, view))
  }
  const crop = view.props?.crop as Crop | undefined
  if (!crop) return { marks }
  const [x, y] = fromPx([crop.x, crop.y], view)
  const [w, h] = fromPx([crop.w, crop.h], view)
  return { marks, crop: { x, y, w, h } }
}
