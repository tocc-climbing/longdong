import type { LoadedData } from '../data/dataset'
import type { Bolt, Route } from '../data/schema'
import { routeKey } from '../social/model'

/**
 * 拉測回報：一次出勤（日期、出勤人員）記錄好幾條路線、每顆 bolt／anchor 的結果。
 * 結果與 TOCC 拉測工作紀錄 Sheet 的五種相同：合格、不合格、未測、取消、免測。
 */
export const RESULTS = ['pass', 'fail', 'untested', 'cancelled', 'exempt'] as const
export type PullResult = (typeof RESULTS)[number]

export interface BoltEntry {
  result?: PullResult
}

export interface RouteEntry {
  routeId: string
  /** 位置（B01、A01…）→ 結果 */
  bolts: Record<string, BoltEntry>
  note?: string
  /** 這次更換的確保站配件（例如「梅隆鎖、垂降環」） */
  anchorHardware?: string
}

export interface Outing {
  id: string
  /** YYYY-MM-DD */
  date: string
  crew: string[]
  routes: RouteEntry[]
  createdAt: string
  updatedAt: string
  /** 上傳完成的時間；上傳後只有被退回才能再修改 */
  uploadedAt?: string
}

export interface OutingPhoto {
  id: string
  outingId: string
  routeId: string
  position: string
  blob: Blob
  createdAt: string
}

/** 不是要拉測的固定點：共用的由另一條路線記錄；沒有 anchor、天然固定點沒有 bolt 可拉 */
const NOT_TESTABLE = new Set(['共用', '無 Anchor', '天然固定點'])

/** 這條路線要記錄的 bolt 與 anchor（依位置順序） */
export function testable(route: Route): Bolt[] {
  return [...route.bolts, ...route.anchors].filter((b) => !NOT_TESTABLE.has(b.material))
}

/** 鈦材質（Ti-…）不拉測：固定免測，不能改 */
export const isExempt = (bolt: Bolt): boolean => bolt.material.startsWith('Ti-')

/** 不是鈦的 bolt 可以選的結果（免測只給鈦） */
export const CHOICES = ['pass', 'fail', 'untested', 'cancelled'] as const satisfies readonly PullResult[]

/** 鈦材質固定免測；其他預設空白 */
export function defaultResult(bolt: Bolt): PullResult | undefined {
  return isExempt(bolt) ? 'exempt' : undefined
}

export function newRouteEntry(route: Route): RouteEntry {
  const bolts: Record<string, BoltEntry> = {}
  for (const b of testable(route)) {
    const result = defaultResult(b)
    bolts[b.position] = result ? { result } : {}
  }
  return { routeId: route.id, bolts }
}

/** 還沒填結果的，全部設成合格 */
export function restPass(entry: RouteEntry): RouteEntry {
  return { ...entry, bolts: Object.fromEntries(Object.entries(entry.bolts).map(([p, b]) => [p, b.result ? b : { ...b, result: 'pass' as const }])) }
}

export interface Counts {
  /** 實測：合格＋不合格 */
  tested: number
  pass: number
  fail: number
  untested: number
  cancelled: number
}

export function counts(entries: RouteEntry[]): Counts {
  const c: Counts = { tested: 0, pass: 0, fail: 0, untested: 0, cancelled: 0 }
  for (const e of entries) {
    for (const b of Object.values(e.bolts)) {
      if (b.result === 'pass' || b.result === 'fail') c.tested++
      if (b.result === 'pass') c.pass++
      else if (b.result === 'fail') c.fail++
      else if (b.result === 'untested') c.untested++
      else if (b.result === 'cancelled') c.cancelled++
    }
  }
  return c
}

/** 還沒填結果的顆數 */
export function blanks(entry: RouteEntry): number {
  return Object.values(entry.bolts).filter((b) => !b.result).length
}

/* ---------- 上傳與審核（雲端的形狀，見 firebase/database.rules.json 的 v2/pullTests） ---------- */

/** 照片在 Storage 的路徑 */
export const photoPath = (uid: string, outingId: string, photoId: string, type: string) =>
  `pulltests/${uid}/${outingId}/${photoId}.${type === 'image/webp' ? 'webp' : 'jpg'}`

export interface StoredBolt {
  result: PullResult
  /** 照片 id → 副檔名 */
  photos?: Record<string, 'webp' | 'jpg'>
}

export interface StoredRoute {
  bolts: Record<string, StoredBolt>
  note?: string
  anchorHardware?: string
}

/** 上傳的內容（createdAt、status 由 submitPullTest 補上） */
export interface PullTestRecord {
  uid: string
  date: string
  crew?: string[]
  /** routeKey（longdong:328ac2）→ 路線的結果 */
  routes: Record<string, StoredRoute>
}

export type PullTestStatus = 'pending' | 'approved' | 'rejected'

export interface StoredPullTest extends PullTestRecord {
  createdAt: number
  status: PullTestStatus
  review?: { uid: string; at: number; note?: string }
}

/** 照片（不含檔案內容）：上傳時要知道副檔名 */
export interface PhotoRef {
  id: string
  routeId: string
  position: string
  type: string
}

/** 每條路線至少一顆有結果才能上傳；回傳還沒填的路線 id */
export function missingResults(outing: Outing): string[] {
  return outing.routes.filter((r) => !Object.values(r.bolts).some((b) => b.result)).map((r) => r.routeId)
}

/** 出勤 → 上傳的內容。沒填結果的 bolt 不送；照片掛在它的 bolt 下（沒填結果的 bolt 的照片不送） */
export function toRecord(outing: Outing, uid: string, photos: PhotoRef[]): PullTestRecord {
  const routes: Record<string, StoredRoute> = {}
  for (const r of outing.routes) {
    const bolts: Record<string, StoredBolt> = {}
    for (const [position, b] of Object.entries(r.bolts)) {
      if (!b.result) continue
      const mine = photos.filter((p) => p.routeId === r.routeId && p.position === position)
      bolts[position] = { result: b.result, ...(mine.length ? { photos: Object.fromEntries(mine.map((p) => [p.id, p.type === 'image/webp' ? 'webp' : 'jpg'])) } : {}) }
    }
    routes[routeKey(r.routeId)] = { bolts, ...(r.note?.trim() ? { note: r.note.trim() } : {}), ...(r.anchorHardware?.trim() ? { anchorHardware: r.anchorHardware.trim() } : {}) }
  }
  return { uid, date: outing.date, ...(outing.crew.length ? { crew: outing.crew } : {}), routes }
}

/** 上傳的照片（有結果的 bolt 的照片） */
export function photosToUpload(record: PullTestRecord, uid: string, outingId: string, photos: PhotoRef[]): (PhotoRef & { path: string })[] {
  return photos
    .filter((p) => record.routes[routeKey(p.routeId)]?.bolts[p.position]?.photos?.[p.id])
    .map((p) => ({ ...p, path: photoPath(uid, outingId, p.id, p.type) }))
}

/** 通過後給 Sheet 的 Apps Script 讀的摘要：不含照片，帶上寫回 Sheet 需要的區域、編號、名稱與材質 */
export interface ApprovedPullTest {
  date: string
  crew?: string[]
  routes: Record<
    string,
    {
      area: string
      number?: string
      name: string
      bolts: Record<string, { result: PullResult; material: string }>
      note?: string
      anchorHardware?: string
    }
  >
}

/** 審核通過時的摘要；路線已經不在資料裡時回傳 undefined（不能寫回 Sheet） */
export function approvedSummary(stored: StoredPullTest, data: LoadedData): ApprovedPullTest | undefined {
  const routes: ApprovedPullTest['routes'] = {}
  for (const [key, r] of Object.entries(stored.routes)) {
    const ref = data.routeById.get(key.replace(':', '/'))
    if (!ref) return undefined
    const material = new Map([...ref.route.bolts, ...ref.route.anchors].map((b) => [b.position, b.material]))
    routes[key] = {
      area: ref.area.name.zh,
      ...(ref.route.number ? { number: ref.route.number } : {}),
      name: ref.route.name.zh,
      bolts: Object.fromEntries(Object.entries(r.bolts).map(([p, b]) => [p, { result: b.result, material: material.get(p) ?? '' }])),
      ...(r.note ? { note: r.note } : {}),
      ...(r.anchorHardware ? { anchorHardware: r.anchorHardware } : {}),
    }
  }
  return { date: stored.date, ...(stored.crew?.length ? { crew: stored.crew } : {}), routes }
}
