import type { Rect, TopoRoute } from '../../vendor/climbio-topokit/index.js'
import { SCALE, type Crop, type Marks, type Point, type RouteMarks, type TopoImage } from '../core/topo/geometry'
import { sameSpot } from '../core/topo/lines'
import { px } from '../core/topo/TopoView'

/**
 * TopoKit 編輯器（照片像素）與龍洞的標記（萬分比）之間的換算。
 * 像素換回萬分比取最近的整數；沒動的點從萬分比換成像素再換回來，值不變（TopoKit 寫回圖層時座標照原樣）。
 */

const toScale = ([x, y]: Point, photo: TopoImage): Point => [Math.round((x * SCALE) / photo.width), Math.round((y * SCALE) / photo.height)]

/** 編輯器的路線 → 標記；沒有線也沒有 bolt 的路線不列（只有一個點的線照樣列，同原本的草稿） */
export function kitMarks(routes: TopoRoute[], photo: TopoImage): Marks {
  const out: Marks = {}
  for (const r of routes) {
    const line = r.line?.length ? r.line.map((p) => toScale(p, photo)) : undefined
    const entries = Object.entries(r.bolts ?? {})
    const bolts = entries.length ? Object.fromEntries(entries.map(([pos, b]) => [pos, toScale(b.at, photo)])) : undefined
    if (line || bolts) out[r.id] = { ...(line ? { line } : {}), ...(bolts ? { bolts } : {}) }
  }
  return out
}

/** 只把 changed 裡的路線換成 marks 的內容（其他路線的座標不經過換算，不會移動） */
export function withMarks(routes: TopoRoute[], marks: Marks, changed: Set<string>, photo: TopoImage): TopoRoute[] {
  return routes.map((r) => {
    if (!changed.has(r.id)) return r
    const m = marks[r.id]
    const bolts = Object.fromEntries(Object.entries(m?.bolts ?? {}).map(([pos, at]) => [pos, { ...r.bolts?.[pos], at: px(photo, at), anchor: pos.startsWith('A') }]))
    return { ...r, line: m?.line?.map((p) => px(photo, p)), bolts: Object.keys(bolts).length ? bolts : undefined }
  })
}

/**
 * 顯示用補上的共用 bolt、anchor（fillShared）沒被動過時不算修改：從草稿拿掉，資料照舊只標在一條路線。
 * base 是載入時的標記，filled 是補上共用點之後的。
 */
export function dropFilled(marks: Marks, base: Marks, filled: Marks): Marks {
  let out = marks
  for (const [id, m] of Object.entries(filled)) {
    for (const [pos, at] of Object.entries(m.bolts ?? {})) {
      const mine = out[id]?.bolts?.[pos]
      if (base[id]?.bolts?.[pos] || !mine || !sameSpot(mine, at)) continue
      const bolts = Object.fromEntries(Object.entries(out[id].bolts ?? {}).filter(([key]) => key !== pos))
      const line = out[id].line
      const next: RouteMarks = { ...(line?.length ? { line } : {}), ...(Object.keys(bolts).length ? { bolts } : {}) }
      out = next.line || next.bolts ? { ...out, [id]: next } : Object.fromEntries(Object.entries(out).filter(([key]) => key !== id))
    }
  }
  return out
}

/** 裁切：像素 → 萬分比；整張照片是 undefined */
export function cropFromKit(rect: Rect | undefined, photo: TopoImage): Crop | undefined {
  if (!rect) return undefined
  const [x, y] = toScale([rect.x, rect.y], photo)
  const [w, h] = toScale([rect.w, rect.h], photo)
  return x === 0 && y === 0 && w === SCALE && h === SCALE ? undefined : { x, y, w, h }
}

/** 萬分比的一塊 → 照片像素 */
export function rectToKit(c: Crop, photo: TopoImage): Rect {
  const [x, y] = px(photo, [c.x, c.y])
  const [w, h] = px(photo, [c.w, c.h])
  return { x, y, w, h }
}
