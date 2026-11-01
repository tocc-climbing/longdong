import type { Photo, Topo, TopoRoute } from '../../../vendor/climbio-format/format'
import { isFullCrop, SCALE, type Crop, type Marks, type Point } from '../topo/geometry'

/**
 * Topo 與 Climbio 公開格式 v2（kind: topo，見 vendor/climbio-format/README.md）互轉。
 * 內部的座標是照片寬、高的萬分比，v2 是照片像素（以 photo 的 w、h 為準）。
 * 萬分比換成像素不失真（整數乘整數再除以 10000）；像素換回萬分比時取最近的整數。
 */

export interface TopoSource {
  /** 照片的 id */
  id: string
  name: string
  author?: string
  /** 標註的授權（SPDX） */
  license: string
  /** 最後修改時間（毫秒） */
  t: number
  source?: Topo['source']
  sector?: string
  photo: Photo
  marks: Marks
  crop?: Crop
  /** 路線 id → 顯示用的名稱與難度 */
  routes: Map<string, { name?: string; grade?: string }>
}

const toPx = ([x, y]: Point, { w, h }: Photo): [number, number] => [(x * w) / SCALE, (y * h) / SCALE]
const fromPx = ([x, y]: [number, number], { w, h }: Photo): Point => [Math.round((x * SCALE) / w), Math.round((y * SCALE) / h)]

/** 沒有任何標記的路線、只有一點的線段不輸出（同資料庫的存法，見 topo/model.ts 的 encodeMarks） */
export function toTopo(src: TopoSource): Topo {
  const { photo } = src
  const routes: Record<string, TopoRoute> = {}
  for (const [id, m] of Object.entries(src.marks)) {
    const line = m.line && m.line.length >= 2 ? m.line.map((p) => toPx(p, photo)) : undefined
    const bolts = m.bolts && Object.keys(m.bolts).length > 0 ? Object.fromEntries(Object.entries(m.bolts).map(([pos, p]) => [pos, toPx(p, photo)])) : undefined
    if (!line && !bolts) continue
    const info = src.routes.get(id)
    routes[id] = { ...(info?.name ? { name: info.name } : {}), ...(info?.grade ? { grade: info.grade } : {}), ...(line ? { line } : {}), ...(bolts ? { bolts } : {}) }
  }
  const c = src.crop
  return {
    climbio: 2,
    kind: 'topo',
    id: src.id,
    name: src.name,
    ...(src.author ? { author: src.author } : {}),
    license: src.license,
    t: src.t,
    ...(src.source ? { source: src.source } : {}),
    ...(src.sector ? { sector: src.sector } : {}),
    photo,
    ...(c && !isFullCrop(c) ? { crop: { x: (c.x * photo.w) / SCALE, y: (c.y * photo.h) / SCALE, w: (c.w * photo.w) / SCALE, h: (c.h * photo.h) / SCALE } } : {}),
    routes,
  }
}

/** v2 的 Topo 換回內部的標記與裁切（doc 先通過 validate） */
export function fromTopo(doc: Topo): { marks: Marks; crop?: Crop } {
  const { photo } = doc
  const marks: Marks = Object.fromEntries(
    Object.entries(doc.routes).map(([id, r]) => [
      id,
      {
        ...(r.line ? { line: r.line.map((p) => fromPx(p, photo)) } : {}),
        ...(r.bolts ? { bolts: Object.fromEntries(Object.entries(r.bolts).map(([pos, p]) => [pos, fromPx(p, photo)])) } : {}),
      },
    ]),
  )
  if (!doc.crop) return { marks }
  const [x, y] = fromPx([doc.crop.x, doc.crop.y], photo)
  const [w, h] = fromPx([doc.crop.w, doc.crop.h], photo)
  return { marks, crop: { x, y, w, h } }
}
