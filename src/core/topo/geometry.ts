/**
 * Topo 的幾何：照片上的路線線段、bolt 位置與裁切範圍，和資料存在哪裡無關。
 * 座標是照片寬、高的萬分比（0–10000 的整數），和照片的解析度無關。
 * 裁切（crop）只決定畫面顯示照片的哪一塊，原圖與標記的座標都不動，所以裁切前後路線不會跑掉；沒有 crop 就顯示整張。
 */

export const SCALE = 10000

export type Point = [number, number]

/** 顯示照片的範圍：左上角與寬高，單位同座標（萬分比） */
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: SCALE, h: SCALE }

/** 裁切的寬、高下限（同資料庫規則） */
export const MIN_CROP = 500

export interface RouteMarks {
  /** 路線線段，第一點是起攀點 */
  line?: Point[]
  /** bolt 位置（B01…、A01…，同路線資料的 position） */
  bolts?: Record<string, Point>
}

/** 路線 ID → 標記 */
export type Marks = Record<string, RouteMarks>

/** 標記所在的照片：image 是照片的參照，由 TopoView 的 ImageUrl 換成網址 */
export interface TopoImage {
  image: string
  width: number
  height: number
}

/** 照片上的相對位置（0–1）換成儲存用的萬分比 */
export function toPoint(fx: number, fy: number): Point {
  return [Math.round(fx * SCALE), Math.round(fy * SCALE)]
}

export const isFullCrop = (c: Crop | undefined): boolean => !c || (c.x === 0 && c.y === 0 && c.w === SCALE && c.h === SCALE)

/** 兩個裁切是否相同（沒有裁切等於整張） */
export function sameCrop(a: Crop | undefined, b: Crop | undefined): boolean {
  const [p, q] = [a ?? FULL_CROP, b ?? FULL_CROP]
  return p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h
}

/** 裁切範圍內的相對位置（0–1）換成整張照片上的點 */
export function toCropPoint(crop: Crop | undefined, fx: number, fy: number): Point {
  const c = crop ?? FULL_CROP
  return toPoint((c.x + fx * c.w) / SCALE, (c.y + fy * c.h) / SCALE)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 拖曳裁切框的邊或角：dx、dy 為 -1（左／上邊）、1（右／下邊）、0（不動）。
 * 拖到照片外時停在照片邊緣，寬高不小於 MIN_CROP。
 */
export function resizeCrop(crop: Crop, dx: -1 | 0 | 1, dy: -1 | 0 | 1, [px, py]: Point): Crop {
  let { x, y, w, h } = crop
  if (dx === -1) {
    const left = clamp(px, 0, x + w - MIN_CROP)
    ;[x, w] = [left, x + w - left]
  } else if (dx === 1) w = clamp(px, x + MIN_CROP, SCALE) - x
  if (dy === -1) {
    const top = clamp(py, 0, y + h - MIN_CROP)
    ;[y, h] = [top, y + h - top]
  } else if (dy === 1) h = clamp(py, y + MIN_CROP, SCALE) - y
  return { x, y, w, h }
}

/** 整個裁切框從 from 拖到 to，停在照片邊緣 */
export function moveCrop(crop: Crop, [fx, fy]: Point, [tx, ty]: Point): Crop {
  return { ...crop, x: clamp(crop.x + tx - fx, 0, SCALE - crop.w), y: clamp(crop.y + ty - fy, 0, SCALE - crop.h) }
}
