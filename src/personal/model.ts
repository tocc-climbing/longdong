/**
 * 個人資料（收藏、攀登紀錄）只存在使用者裝置上。
 *
 * 每筆紀錄都有唯一 key 與 updatedAt，刪除以 deleted 標記保留（tombstone），
 * 這樣匯入備份、之後同步到雲端時，都能用「較新者為準」合併，不會把已刪除的資料救回來。
 */

export type TickStyle = 'onsight' | 'flash' | 'redpoint' | 'follow' | 'toprope' | 'attempt'

/** 攀登方式；顯示文字見 i18n 的 style.* */
export const TICK_STYLES: { value: TickStyle; sent: boolean }[] = [
  { value: 'onsight', sent: true },
  { value: 'flash', sent: true },
  { value: 'redpoint', sent: true },
  { value: 'follow', sent: true },
  { value: 'toprope', sent: true },
  { value: 'attempt', sent: false },
]


export function isSent(style: TickStyle): boolean {
  return TICK_STYLES.find((s) => s.value === style)?.sent ?? false
}

/** 路線清單（我的 → 路線清單）可以勾選的最佳攀登方式，由好到差：OS、RP、TR */
export const BEST_STYLES = ['onsight', 'redpoint', 'toprope'] as const
/** flash：早期版本可以勾選，畫面上視為 RP */
export type BestStyle = (typeof BEST_STYLES)[number] | 'flash'

/** 攀登方式在路線清單、難度金字塔上算成哪一個：Flash 算 RP、跟攀算 TR */
export function checklistStyle(style: TickStyle): (typeof BEST_STYLES)[number] | undefined {
  if (style === 'flash') return 'redpoint'
  if (style === 'follow') return 'toprope'
  return (BEST_STYLES as readonly string[]).includes(style) ? (style as (typeof BEST_STYLES)[number]) : undefined
}

/** 攀登方式的好壞（數字小的較好）：跟攀與上方確保同一級 */
const STYLE_RANK: Record<TickStyle, number> = { onsight: 0, flash: 1, redpoint: 2, toprope: 3, follow: 3, attempt: 9 }

/** 幾種攀登方式中最好的一種 */
export function bestStyle(styles: TickStyle[]): TickStyle | undefined {
  return styles.reduce<TickStyle | undefined>((best, s) => (best === undefined || STYLE_RANK[s] < STYLE_RANK[best] ? s : best), undefined)
}

interface Syncable {
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
  deleted?: boolean
}

export interface Favorite extends Syncable {
  /** 收藏的路線、區域或分區的 ID（欄位名稱沿用，雲端的資料不用改） */
  routeId: string
}

/** 攀登紀錄備註的字數上限（UTF-16 字元數，與 firebase/database.rules.json 的 ticks.note 相同） */
export const NOTE_MAX = 1000

export interface Tick extends Syncable {
  id: string
  routeId: string
  /** YYYY-MM-DD */
  date: string
  style: TickStyle
  note?: string
}

/** 一條路線的最佳攀登方式（不記日期），每條路線一筆；清除時以 deleted 標記保留 */
export interface Best extends Syncable {
  routeId: string
  style: BestStyle
}

export interface PersonalExport {
  format: 'longdong-personal'
  version: 1
  exportedAt: string
  favorites: Favorite[]
  ticks: Tick[]
  /** 路線清單勾選的最佳攀登方式（舊的匯出檔沒有） */
  best?: Best[]
}

/** 完攀過的路線：攀登紀錄裡有完攀的，加上路線清單勾選的 */
export function sentRouteIds(ticks: Tick[], best: Map<string, BestStyle>): Set<string> {
  return new Set([...ticks.filter((t) => isSent(t.style)).map((t) => t.routeId), ...best.keys()])
}

/** 以 key 合併兩組紀錄，同一 key 取 updatedAt 較新者 */
export function mergeRecords<T extends Syncable>(current: T[], incoming: T[], key: (r: T) => string): { merged: T[]; changed: T[] } {
  const byKey = new Map(current.map((r) => [key(r), r]))
  const changed: T[] = []
  for (const r of incoming) {
    const existing = byKey.get(key(r))
    if (!existing || r.updatedAt > existing.updatedAt) {
      byKey.set(key(r), r)
      changed.push(r)
    }
  }
  return { merged: [...byKey.values()], changed }
}

export function newId(): string {
  // iOS 15.4 以前沒有 randomUUID
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** n 天前的當地日期 YYYY-MM-DD（用日曆往前推，不受夏令時間影響） */
export function daysAgo(n: number, now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  return today(d)
}

/** 裝置當地日期 YYYY-MM-DD */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 收藏的排在前面，其他照原本的順序（首頁的區域、區域頁的分區） */
export function favoritesFirst<T extends { id: string }>(items: T[], favorites: Set<string>): T[] {
  return [...items.filter((x) => favorites.has(x.id)), ...items.filter((x) => !favorites.has(x.id))]
}
