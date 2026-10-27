import type { MessageKey, Translate } from '../i18n'

/**
 * 管理頁的「所有輸入」：把使用者在各處輸入的資料（留言、評分、Topo 照片與標記、地圖編輯、說明修改、岩壁）
 * 攤平成同一種項目，才能一起搜尋、篩選、依使用者查看。純函式，不碰網路與畫面。
 */

export type FeedType = 'comment' | 'rating' | 'topo' | 'topoEdit' | 'mapEdit' | 'textEdit' | 'wall'
export const FEED_TYPES: FeedType[] = ['comment', 'rating', 'topo', 'topoEdit', 'mapEdit', 'textEdit', 'wall']

/**
 * 分類（依管理員要做的事，互不重疊、合起來是全部）：
 * 內容＝使用者說的話（留言、評分）；修改＝使用者改動的資料（Topo、地圖、說明、岩壁）。
 * 待處理（檢舉）、使用者、地圖回報不是輸入的類型，由畫面另外列。
 */
export type FeedGroup = 'content' | 'changes'
export const FEED_GROUPS: Record<FeedGroup, FeedType[]> = {
  content: ['comment', 'rating'],
  changes: ['topo', 'topoEdit', 'mapEdit', 'textEdit', 'wall'],
}

/** 目前要看的類型：群組內的類型；使用者另外勾選時取交集（沒勾就是整個群組；沒有群組就是勾選的，沒勾是全部） */
export function effectiveTypes(group: FeedGroup | undefined, selected: ReadonlySet<FeedType>): ReadonlySet<FeedType> {
  const pool = group ? FEED_GROUPS[group] : FEED_TYPES
  const picked = pool.filter((t) => selected.has(t))
  return new Set(picked.length > 0 ? picked : group ? pool : [])
}

/** 資料庫原樣（v2 底下各節點）；管理員一次讀回來 */
export interface AdminRaw {
  comments: Record<string, Record<string, { uid: string; text: string; createdAt: number; hidden?: boolean }>>
  ratings: Record<string, Record<string, { stars: number; feel?: string; updatedAt: string }>>
  topos: Record<string, { uid: string; sector: string; image: string; width: number; height: number; createdAt: number }>
  topoEdits: Record<string, Record<string, { uid: string; createdAt: number; routes?: Record<string, unknown> }>>
  mapEdits: Record<string, Record<string, { uid: string; createdAt: number; rings?: string; lines?: string }>>
  textEdits: Record<string, Record<string, { uid: string; createdAt: number; text: string }>>
  walls: Record<string, Record<string, { sector: string; createdAt: number }>>
  /** 留言的檢舉：id → 被檢舉的留言路徑、檢舉人、原因 */
  reports: Record<string, { path: string; uid: string; reason?: string; createdAt: number }>
}

/** 一筆檢舉；留言已刪除時 comment 是 undefined */
export interface PendingReport {
  id: string
  uid: string
  who: string
  reason?: string
  createdAt: number
  comment?: FeedItem
}

export interface FeedItem {
  /** 唯一鍵（列表的 key） */
  key: string
  type: FeedType
  uid: string
  /** 顯示用的使用者名稱 */
  who: string
  createdAt: number
  /** 輸入的對象：路線、分區、區域名稱 */
  target: string
  /** 內容摘要：留言與說明的文字、評分、標記數… */
  summary: string
  /** 站內連結（路線頁、編輯模式的項目）；沒有時 undefined */
  href?: string
  /** 管理員能刪除時的資料庫路徑；空陣列表示規則不允許管理員刪除（評分、Topo 照片：照片要連 Storage 的檔案一起刪） */
  deletePaths: string[]
  /** Topo 照片（type === 'topo'）：刪除用 */
  photo?: { id: string; uid: string; sector: string; image: string; width: number; height: number; createdAt: number }
  /** 被檢舉的留言：檢舉的筆數 */
  reportCount?: number
}

/** 把代號換成人看得懂的名稱、連結；由畫面依語言與資料集提供 */
export interface FeedContext {
  t: Translate
  who: (uid: string) => string
  /** routeKey（longdong:abc123） */
  route: (routeKey: string) => { name: string; href?: string }
  /** 分區 ID（longdong/xxx） */
  sector: (sectorId: string) => string
  /** 大區域 key（golden-valley） */
  area: (areaKey: string) => string
  /** 地圖編輯的對象（area:… sector:… trails…） */
  mapTarget: (target: string) => string
  editHref: (kind: 'map' | 'topo' | 'text', id: string) => string
}

const count = (text: string | undefined) => (text ? text.split('|').length : 0)

/** 說明修改的對象（area:… / route:longdong:abc123）→ 名稱 */
function textTargetName(target: string, ctx: FeedContext): string {
  const [kind, ...rest] = target.split(':')
  return kind === 'route' ? ctx.route(rest.join(':')).name : ctx.area(rest.join(':'))
}

export function buildFeed(raw: AdminRaw, ctx: FeedContext): FeedItem[] {
  const { t } = ctx
  const items: FeedItem[] = []
  const add = (item: Omit<FeedItem, 'who'>) => items.push({ ...item, who: ctx.who(item.uid) })

  for (const [routeKey, list] of Object.entries(raw.comments ?? {})) {
    const route = ctx.route(routeKey)
    for (const [id, c] of Object.entries(list)) {
      add({ key: `comment:${routeKey}:${id}`, type: 'comment', uid: c.uid, createdAt: c.createdAt, target: route.name, summary: c.hidden ? `${c.text}（${t('admin.hidden')}）` : c.text, href: route.href, deletePaths: [`v2/comments/${routeKey}/${id}`] })
    }
  }
  for (const [routeKey, list] of Object.entries(raw.ratings ?? {})) {
    const route = ctx.route(routeKey)
    for (const [uid, r] of Object.entries(list)) {
      const createdAt = Date.parse(r.updatedAt)
      if (Number.isNaN(createdAt)) continue
      add({ key: `rating:${routeKey}:${uid}`, type: 'rating', uid, createdAt, target: route.name, summary: `★ ${r.stars}${r.feel ? ` · ${t(`feel.${r.feel}` as MessageKey)}` : ''}`, href: route.href, deletePaths: [] })
    }
  }
  for (const [id, p] of Object.entries(raw.topos ?? {})) {
    add({ key: `topo:${id}`, type: 'topo', uid: p.uid, createdAt: p.createdAt, target: ctx.sector(p.sector), summary: t('admin.feed.topoPhoto'), href: ctx.editHref('topo', id), deletePaths: [], photo: { id, ...p } })
  }
  for (const [photo, list] of Object.entries(raw.topoEdits ?? {})) {
    const sector = raw.topos?.[photo]?.sector
    for (const [id, e] of Object.entries(list)) {
      add({ key: `topoEdit:${photo}:${id}`, type: 'topoEdit', uid: e.uid, createdAt: e.createdAt, target: sector ? ctx.sector(sector) : photo, summary: t('admin.feed.topoMarks', { n: Object.keys(e.routes ?? {}).length }), href: ctx.editHref('topo', photo), deletePaths: [`v2/topoEdits/${photo}/${id}`] })
    }
  }
  for (const [target, list] of Object.entries(raw.mapEdits ?? {})) {
    for (const [id, e] of Object.entries(list)) {
      const n = count(e.rings ?? e.lines)
      add({ key: `mapEdit:${target}:${id}`, type: 'mapEdit', uid: e.uid, createdAt: e.createdAt, target: ctx.mapTarget(target), summary: t(e.lines !== undefined ? 'admin.feed.mapLines' : 'admin.feed.mapShapes', { n }), href: ctx.editHref('map', target), deletePaths: [`v2/mapEdits/${target}/${id}`] })
    }
  }
  for (const [target, list] of Object.entries(raw.textEdits ?? {})) {
    for (const [id, e] of Object.entries(list)) {
      add({ key: `textEdit:${target}:${id}`, type: 'textEdit', uid: e.uid, createdAt: e.createdAt, target: textTargetName(target, ctx), summary: e.text.trim() || t('admin.feed.textReverted'), href: ctx.editHref('text', target), deletePaths: [`v2/textEdits/${target}/${id}`] })
    }
  }
  for (const [uid, list] of Object.entries(raw.walls ?? {})) {
    for (const [id, w] of Object.entries(list)) {
      add({ key: `wall:${uid}:${id}`, type: 'wall', uid, createdAt: w.createdAt, target: ctx.sector(w.sector), summary: t('admin.feed.wall'), deletePaths: [`v2/walls/${uid}/${id}`] })
    }
  }
  const reported = new Map<string, number>()
  for (const r of Object.values(raw.reports ?? {})) reported.set(r.path, (reported.get(r.path) ?? 0) + 1)
  for (const i of items) if (i.type === 'comment' && reported.has(i.deletePaths[0])) i.reportCount = reported.get(i.deletePaths[0])
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

/** 待處理：留言的檢舉，新到舊；對得到留言的附上那則留言 */
export function buildPending(raw: AdminRaw, feed: FeedItem[], who: (uid: string) => string): PendingReport[] {
  const comments = new Map(feed.filter((i) => i.type === 'comment').map((i) => [i.deletePaths[0], i]))
  return Object.entries(raw.reports ?? {})
    .map(([id, r]) => ({ id, uid: r.uid, who: who(r.uid), reason: r.reason, createdAt: r.createdAt, comment: comments.get(r.path) }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export interface FeedFilter {
  /** 空集合＝全部類型 */
  types: ReadonlySet<FeedType>
  uid?: string
  query: string
  /** 時間範圍（毫秒，含頭不含尾）；沒有就不限 */
  from?: number
  to?: number
}

/** 搜尋範圍：使用者名稱、對象、內容摘要（不分大小寫、空白分隔的每個字都要出現） */
export function filterFeed(items: FeedItem[], f: FeedFilter): FeedItem[] {
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((i) => {
    if (f.types.size > 0 && !f.types.has(i.type)) return false
    if (f.uid && i.uid !== f.uid) return false
    if (f.from !== undefined && i.createdAt < f.from) return false
    if (f.to !== undefined && i.createdAt >= f.to) return false
    const haystack = `${i.who} ${i.target} ${i.summary}`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

export function countByType(items: FeedItem[]): Record<FeedType, number> {
  const out = Object.fromEntries(FEED_TYPES.map((t) => [t, 0])) as Record<FeedType, number>
  for (const i of items) out[i.type]++
  return out
}

export interface UserSummary {
  uid: string
  name: string
  counts: Record<FeedType, number>
  total: number
  /** 最近一次輸入（毫秒）；沒有任何輸入時 0 */
  last: number
}

/** 使用者目錄：每個有暱稱或有輸入的人，各類型輸入的數量與最近一次；最近有動作的在前 */
export function summarizeUsers(items: FeedItem[], profiles: Record<string, { name: string }>): UserSummary[] {
  const by = new Map<string, UserSummary>()
  const get = (uid: string, name: string) => {
    let u = by.get(uid)
    if (!u) by.set(uid, (u = { uid, name, counts: countByType([]), total: 0, last: 0 }))
    return u
  }
  for (const [uid, p] of Object.entries(profiles)) get(uid, p.name)
  for (const i of items) {
    const u = get(i.uid, i.who)
    u.counts[i.type]++
    u.total++
    u.last = Math.max(u.last, i.createdAt)
  }
  return [...by.values()].sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
}

/** 管理員能刪的資料庫路徑（規則允許的）：留言、檢舉、Topo 標記、地圖編輯、說明修改、岩壁；評分與暱稱規則不允許，Topo 照片要連 Storage 的檔案一起刪（另外處理） */
const DELETABLE = /^v2\/(comments\/[^/]+\/[^/]+|reports\/[^/]+|topoEdits\/[^/]+\/[^/]+|mapEdits\/[^/]+\/[^/]+|textEdits\/[^/]+\/[^/]+|walls\/[^/]+\/[^/]+)$/
export const isAdminDeletable = (path: string): boolean => DELETABLE.test(path)
