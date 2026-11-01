import type { Crop, Marks, Point, TopoImage } from '../core/topo/geometry'
import type { Shot } from '../core/topo/shot'
import type { Route } from '../data/schema'
import { E2E, routeKey } from '../social/model'

/**
 * Topo：岩壁照片上的路線線段與 bolt 位置。照片存在 Cloud Storage，原圖不動；標記另外存，畫面上再疊上去。
 *   /v2/topos/<照片>              { uid, sector, image, width, height, createdAt, shot? }（shot：回報附的照片的拍照資料，見 shot.ts）
 *   /v2/topoEdits/<照片>/<版本>   { uid, createdAt, routes: { <routeKey>: { line?, bolts? } }, crop?: { x, y, w, h } }
 * 任何登入者都可以提交新版本（完整的標記，不是差異）；最新的版本就是目前顯示的，刪掉它就回到前一版。
 * 座標與裁切見 core/topo/geometry.ts。
 */

export const STORAGE_BUCKET = 'project-2803619783974357321.appspot.com'

/** 上傳前把照片縮到長邊不超過這個像素 */
export const MAX_EDGE = 2560

/** image：Cloud Storage 的路徑 */
export interface TopoPhoto extends TopoImage {
  id: string
  uid: string
  /** 分區 ID */
  sector: string
  /** 伺服器時間（毫秒） */
  createdAt: number
  shot?: Shot
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
