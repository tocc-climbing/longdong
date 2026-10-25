import type { Route } from '../data/schema'
import { E2E, routeKey } from '../social/model'

/**
 * Topo：岩壁照片上的路線線段與 bolt 位置。照片存在 Cloud Storage，原圖不動；標記另外存，畫面上再疊上去。
 *   /v2/topos/<照片>              { uid, sector, image, width, height, createdAt }
 *   /v2/topoEdits/<照片>/<版本>   { uid, createdAt, routes: { <routeKey>: { line?, bolts? } }, crop?: { x, y, w, h } }
 * 任何登入者都可以提交新版本（完整的標記，不是差異）；最新的版本就是目前顯示的，刪掉它就回到前一版。
 * 座標是照片寬、高的萬分比（0–10000 的整數），和照片的解析度無關。
 * 裁切（crop）只決定畫面顯示照片的哪一塊，原圖與標記的座標都不動，所以裁切前後路線不會跑掉；沒有 crop 就顯示整張。
 */

export const SCALE = 10000

export const STORAGE_BUCKET = 'project-2803619783974357321.appspot.com'

/** 上傳前把照片縮到長邊不超過這個像素 */
export const MAX_EDGE = 2560

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

export interface TopoPhoto {
  id: string
  uid: string
  /** 分區 ID */
  sector: string
  /** Cloud Storage 的路徑 */
  image: string
  width: number
  height: number
  /** 伺服器時間（毫秒） */
  createdAt: number
}

export interface TopoEdit {
  id: string
  uid: string
  createdAt: number
  marks: Marks
  /** 沒有就是整張照片 */
  crop?: Crop
}

/** 資料庫裡的格式：點寫成 "x,y"，線段是以空白分開的點 */
export type StoredRoutes = Record<string, { line?: string; bolts?: Record<string, string> }>

export interface StoredEdit {
  uid: string
  createdAt: number
  routes: StoredRoutes
  crop?: Crop
}

/** routeKey 的反向：longdong:328ac2 → longdong/328ac2 */
export function routeIdFromKey(key: string): string {
  return key.replace(/:/g, '/').replace(/,/g, '.')
}

const encodePoint = ([x, y]: Point) => `${x},${y}`
const decodePoint = (s: string): Point => s.split(',').map(Number) as Point

/** 照片上的相對位置（0–1）換成儲存用的萬分比 */
export function toPoint(fx: number, fy: number): Point {
  return [Math.round(fx * SCALE), Math.round(fy * SCALE)]
}

/** 沒有任何標記的路線不存 */
export function encodeMarks(marks: Marks): StoredRoutes {
  const routes: StoredRoutes = {}
  for (const [id, m] of Object.entries(marks)) {
    const line = m.line && m.line.length >= 2 ? m.line.map(encodePoint).join(' ') : undefined
    const bolts = m.bolts && Object.keys(m.bolts).length > 0 ? Object.fromEntries(Object.entries(m.bolts).map(([p, pt]) => [p, encodePoint(pt)])) : undefined
    if (line || bolts) routes[routeKey(id)] = { ...(line ? { line } : {}), ...(bolts ? { bolts } : {}) }
  }
  return routes
}

export function decodeEdit(id: string, stored: StoredEdit): TopoEdit {
  const marks: Marks = {}
  for (const [key, r] of Object.entries(stored.routes ?? {})) {
    marks[routeIdFromKey(key)] = {
      ...(r.line ? { line: r.line.split(' ').map(decodePoint) } : {}),
      ...(r.bolts ? { bolts: Object.fromEntries(Object.entries(r.bolts).map(([p, s]) => [p, decodePoint(s)])) } : {}),
    }
  }
  return { id, uid: stored.uid, createdAt: stored.createdAt, marks, ...(stored.crop ? { crop: stored.crop } : {}) }
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

/** 兩份標記存起來是否相同（只有一點的線段不算，見 encodeMarks） */
export function sameMarks(a: Marks, b: Marks): boolean {
  return JSON.stringify(sortKeys(encodeMarks(a))) === JSON.stringify(sortKeys(encodeMarks(b)))
}

function sortKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
  )
}

/** 路線上可以標記的位置：bolt 由下往上，接著是 anchor */
export function boltPositions(route: Route): string[] {
  return [...route.bolts, ...route.anchors].map((b) => b.position)
}

/** 公開讀取的網址（Storage 規則允許任何人讀 topos/） */
export function imageUrl(path: string): string {
  const host = E2E ? 'http://127.0.0.1:9199' : 'https://firebasestorage.googleapis.com'
  return `${host}/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`
}
