import { readTopo, renderLines } from '../../vendor/climbio-topokit/index.js'
import { FULL_CROP, px, type Crop, type Marks, type TopoImage } from '../../src/core/topo/geometry'
import type { RouteInfo } from '../../src/topo/routeInfo'
import { topoData } from '../../src/topo/topoData'
import { TOPO_LOOK } from '../../src/topo/look'

/** 一張 Topo 的標記（TopoKit 的 renderLines）的 SVG 字串：標記、編號、說明的排版測試用（座標是照片像素，k 是一個螢幕像素等於幾個照片像素） */
export function topoLines(o: {
  photo: TopoImage
  marks: Marks
  labels: Map<string, string>
  k: number
  info?: Map<string, RouteInfo>
  crop?: Crop
  highlight?: string
  bolts?: string[]
  editing?: boolean
  boltCodes?: boolean
  solo?: boolean
  ui?: number
}): string {
  const { routes } = readTopo(topoData(o.photo, '', o.marks, undefined, o.labels, o.info ?? new Map()), { lang: 'zh-Hant' })
  const c = o.crop ?? FULL_CROP
  const [x, y] = px(o.photo, [c.x, c.y])
  const [w, h] = px(o.photo, [c.w, c.h])
  // 測試用的正則照 React 輸出的寫法：class 後面直接是 >（拿掉 data-route）、沒有自閉合的標籤
  return renderLines(routes, { ...TOPO_LOOK, photo: { w: o.photo.width, h: o.photo.height }, crop: { x, y, w, h }, k: o.k, highlight: o.highlight, bolts: o.bolts, editing: o.editing, boltCodes: o.boltCodes, solo: o.solo, ui: o.ui }).replace(/ data-route="[^"]*"/g, '').replace(/<(rect|path|circle)([^>]*?)\/>/g, '<$1$2></$1>')
}
