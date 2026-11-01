/** 全螢幕 Topo 的縮放與平移。座標以舞台（可視區域）中心為原點，單位是螢幕像素 */

import { SCALE, type Crop, type RouteMarks } from './model'

export interface View {
  scale: number
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export const MAX_SCALE = 6

export const IDENTITY: View = { scale: 1, x: 0, y: 0 }

/** 照片（寬高比 aspect）在舞台裡縮到剛好放得下的大小 */
export function fitSize(stage: Size, aspect: number): Size {
  const w = Math.min(stage.w, stage.h * aspect)
  return { w, h: w / aspect }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 舞台上下被蓋住的高度（螢幕像素）：照片的上下緣可以拖到蓋住的東西外面 */
export interface Inset {
  top: number
  bottom: number
}

/**
 * 縮放限制在 1 到 MAX_SCALE；放大後照片的邊緣不能離開舞台的邊緣，沒放滿舞台的方向置中。
 * inset：照片的上緣可以往下拖到 top 下面、下緣往上拖到 bottom 上面（上下浮著按鈕時，照片邊緣也能拖出來編輯）。
 */
export function clampView(view: View, stage: Size, content: Size, inset: Inset = { top: 0, bottom: 0 }): View {
  const scale = clamp(view.scale, 1, MAX_SCALE)
  const lx = Math.max(0, (content.w * scale - stage.w) / 2)
  const half = (content.h * scale - stage.h) / 2
  return { scale, x: clamp(view.x, -lx, lx), y: clamp(view.y, Math.min(0, 0 - half - inset.bottom), Math.max(0, half + inset.top)) }
}

export interface Pt {
  x: number
  y: number
}

/**
 * 手指從 from 移到 to，兩指距離變成 ratio 倍：照片上原本在 from 的那一點跟著手指走到 to。
 * 單指拖曳就是 ratio 為 1。
 */
export function moveView(view: View, from: Pt, to: Pt, ratio: number, stage: Size, content: Size, inset?: Inset): View {
  const scale = clamp(view.scale * ratio, 1, MAX_SCALE)
  const f = scale / view.scale
  return clampView({ scale, x: to.x - (from.x - view.x) * f, y: to.y - (from.y - view.y) * f }, stage, content, inset)
}

/** 路線卡片放大到路線：路線佔的範圍外面留的邊（比例），顯示的寬高比限制，最多放大幾倍 */
const FOCUS_PAD = 0.25
const FOCUS_ASPECT: [number, number] = [0.8, 1.5]
const FOCUS_MAX_ZOOM = 2.2
/** 路線外面至少留的邊（照片裁切範圍的比例）：置中時裁掉另一邊，路線本身一定整條看得到 */
const FOCUS_MARGIN = 0.03
/** 示意的線（只畫了一小段、從照片邊緣出去，主要的路線不在照片裡）：碰到邊緣（比例）而且高度不到這個比例 */
const SKETCH_EDGE = 0.02
const SKETCH_HEIGHT = 0.35

/** 示意的線：只畫了一小段、從照片的裁切範圍邊緣出去，主要的路線不在照片裡（例如 565） */
export function isSketch(photo: { width: number; height: number }, base: Crop, marks: RouteMarks | undefined): boolean {
  const pts = [...(marks?.line ?? []), ...Object.values(marks?.bolts ?? {})]
  if (pts.length === 0) return false
  const sx = photo.width / SCALE
  const sy = photo.height / SCALE
  const xs = pts.map(([x]) => x * sx)
  const ys = pts.map(([, y]) => y * sy)
  const [bx, by, bw, bh] = [base.x * sx, base.y * sy, base.w * sx, base.h * sy]
  const nearEdge = xs.some((x, i) => Math.min(x - bx, bx + bw - x) < SKETCH_EDGE * bw || Math.min(ys[i] - by, by + bh - ys[i]) < SKETCH_EDGE * bh)
  return nearEdge && Math.max(...ys) - Math.min(...ys) < SKETCH_HEIGHT * bh
}

/**
 * 路線卡片：只顯示照片上這條路線附近的一塊（照片的裁切範圍裡），路線放大成主角、盡量在畫面中間
 * （路線靠近照片邊緣時，裁掉另一邊讓路線置中，路線本身一定整條看得到）。
 * 座標同 Crop（萬分比）；寬高比、放大倍數在照片像素上算。
 * 沒有標記、或只是示意的線（只畫了一小段、從照片邊緣出去）時就是原本的裁切範圍。
 */
export function routeCrop(photo: { width: number; height: number }, base: Crop, marks: RouteMarks | undefined): Crop {
  const pts = [...(marks?.line ?? []), ...Object.values(marks?.bolts ?? {})]
  if (pts.length === 0) return base
  const sx = photo.width / SCALE
  const sy = photo.height / SCALE
  const xs = pts.map(([x]) => x * sx)
  const ys = pts.map(([, y]) => y * sy)
  const [bx, by, bw, bh] = [base.x * sx, base.y * sy, base.w * sx, base.h * sy]
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const rw = Math.max(...xs) - minX
  const rh = Math.max(...ys) - minY
  const cx = minX + rw / 2
  const cy = minY + rh / 2
  if (isSketch(photo, base, marks)) return base
  let w = rw + 2 * Math.max(FOCUS_PAD * rw, 0.1 * bw)
  let h = rh + 2 * Math.max(FOCUS_PAD * rh, 0.1 * bh)
  // 太窄、太扁：放寬短的那一邊
  w = Math.max(w, h * FOCUS_ASPECT[0])
  h = Math.max(h, w / FOCUS_ASPECT[1])
  // 不放大太多（照片會糊）：等比例放大到夠大
  const grow = Math.max(1, bw / FOCUS_MAX_ZOOM / w, bh / FOCUS_MAX_ZOOM / h)
  w = Math.min(bw, w * grow)
  h = Math.min(bh, h * grow)
  // 置中：路線離照片邊緣比半個畫面近時，縮小畫面（裁掉另一邊），路線加上邊仍整條看得到
  const needW = Math.min(bw, rw + 2 * FOCUS_MARGIN * bw)
  const needH = Math.min(bh, rh + 2 * FOCUS_MARGIN * bh)
  w = Math.max(needW, 2 * Math.min(w / 2, cx - bx, bx + bw - cx))
  h = Math.max(needH, 2 * Math.min(h / 2, cy - by, by + bh - cy))
  // 縮小後寬高比跑掉：長的那一邊也縮（仍蓋住路線）
  h = Math.max(needH, Math.min(h, w / FOCUS_ASPECT[0]))
  w = Math.max(needW, Math.min(w, h * FOCUS_ASPECT[1]))
  // 以路線為中心，超出裁切範圍時往裡面推
  const x = clamp(cx - w / 2, bx, bx + bw - w)
  const y = clamp(cy - h / 2, by, by + bh - h)
  return { x: Math.round(x / sx), y: Math.round(y / sy), w: Math.round(w / sx), h: Math.round(h / sy) }
}

/** 路線卡片、分享卡片的 Topo：路線離畫面中間最多偏這麼多（佔寬度的比例） */
const OFF_CENTER = 0.15

/**
 * 裁切範圍放寬到 aspect（寬／高，照片像素），不超出照片的裁切範圍 base：
 * 路線（原本的中心）離畫面中間不超過 OFF_CENTER；一邊到了照片的邊緣、再放寬路線會太偏時就不再放寬（照片比框窄，兩邊是卡片底色）
 */
export function widenCrop(photo: { width: number; height: number }, crop: Crop, base: Crop, aspect: number): Crop {
  const sx = photo.width / SCALE
  const sy = photo.height / SCALE
  let w = crop.w * sx
  let h = crop.h * sy
  const room = (c: number, size: number, lo: number, len: number) => Math.min(len, Math.max(size, Math.min(c - lo, lo + len - c) / (0.5 - OFF_CENTER)))
  if (w / h < aspect) w = Math.min(room((crop.x + crop.w / 2) * sx, w, base.x * sx, base.w * sx), h * aspect)
  else h = Math.min(room((crop.y + crop.h / 2) * sy, h, base.y * sy, base.h * sy), w / aspect)
  const x = clampIn((crop.x + crop.w / 2) * sx - w / 2, base.x * sx, (base.x + base.w) * sx - w)
  const y = clampIn((crop.y + crop.h / 2) * sy - h / 2, base.y * sy, (base.y + base.h) * sy - h)
  return { x: x / sx, y: y / sy, w: w / sx, h: h / sy }
}

const clampIn = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
