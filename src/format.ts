import type { Translate } from './i18n'
import type { Route, RouteStatus, RouteType } from './data/schema'

/** 狀態的顏色語意；文字見 i18n 的 status.* */
export const STATUS_TONE: Record<RouteStatus, 'ok' | 'warn' | 'danger' | 'muted'> = {
  tested: 'ok',
  rebolted: 'ok',
  'needs-test': 'warn',
  'needs-rebolt': 'warn',
  closed: 'danger',
  'to-remove': 'danger',
  unknown: 'muted',
}

export function typeLabel(type: RouteType, t: Translate): string {
  return t(`type.${type}`)
}

const NOT_A_BOLT = new Set(['無 Anchor', 'No Anchor', '天然固定點'])

/**
 * 運攀要帶的快扣數：每個 bolt 位置加上 anchor。
 * 與其他路線「共用」的 bolt 也要扣，所以不用 Sheet 的「Bolt 統計」（它不算共用的）。
 */
export function quickdraws(route: Route): number | undefined {
  if (route.type !== 'sport') return undefined
  const n = route.bolts.length + route.anchors.filter((a) => !NOT_A_BOLT.has(a.material)).length
  return n > 0 ? n : undefined
}

/** 路線種類的顯示文字，運攀前面加上快扣數，例如「18快扣 運攀」／「18 draws Sport」 */
export function typeText(route: Route, t: Translate): string {
  if (route.isFixture) return t('type.fixture')
  if (!route.type) return ''
  const qd = quickdraws(route)
  const label = typeLabel(route.type, t)
  return qd ? `${t('type.quickdraws', { n: qd })} ${label}` : label
}

/** "2025-12-04" → "2025/12/04"；部分日期照樣顯示 */
export function formatDate(d: string | undefined): string {
  return d ? d.replace(/-/g, '/') : ''
}

/** 從部分日期算到今天經過幾年（無條件捨去） */
export function yearsSince(d: string | undefined, now = new Date()): number | undefined {
  if (!d) return undefined
  const [y, m = '1', day = '1'] = d.split('-')
  const then = new Date(Number(y), Number(m) - 1, Number(day))
  let years = now.getFullYear() - then.getFullYear()
  if (now.getMonth() < then.getMonth() || (now.getMonth() === then.getMonth() && now.getDate() < then.getDate())) years--
  return Math.max(0, years)
}

export function relativeTime(iso: string, t: Translate, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000)
  if (days < 1) return t('time.today')
  if (days < 2) return t('time.yesterday')
  if (days < 31) return t('time.daysAgo', { n: days })
  if (days < 365) return t('time.monthsAgo', { n: Math.floor(days / 30) })
  return t('time.yearsAgo', { n: Math.floor(days / 365) })
}

export type GradeBand = 'easy' | 'g10' | 'g11' | 'g12' | 'g13'

/** 難度區間，用來替難度標籤上淡色底：5.9 以下、5.10、5.11、5.12、5.13 以上 */
export function gradeBand(gradeValue: number | undefined): GradeBand | undefined {
  if (gradeValue === undefined) return undefined
  if (gradeValue < 40) return 'easy'
  if (gradeValue < 44) return 'g10'
  if (gradeValue < 48) return 'g11'
  if (gradeValue < 52) return 'g12'
  return 'g13'
}

export const GRADE_BANDS: { band: GradeBand; label: string }[] = [
  { band: 'easy', label: '5.9-' },
  { band: 'g10', label: '5.10' },
  { band: 'g11', label: '5.11' },
  { band: 'g12', label: '5.12' },
  { band: 'g13', label: '5.13+' },
]

/** 各難度區間的路線數（沒有難度或無法判讀的不計） */
export function gradeDistribution(routes: { gradeValue?: number }[]): { band: GradeBand; label: string; count: number }[] {
  const counts = new Map<GradeBand, number>()
  for (const r of routes) {
    const b = gradeBand(r.gradeValue)
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1)
  }
  return GRADE_BANDS.map((b) => ({ ...b, count: counts.get(b.band) ?? 0 }))
}

/** 路線類型簡化為兩類：「運攀 10 · 傳攀/其他 5」（為 0 的不顯示） */
export function typeSummary(routes: { type?: RouteType; isFixture?: boolean }[], t: Translate): string {
  let sport = 0
  let other = 0
  for (const r of routes) {
    if (r.isFixture || !r.type) continue
    if (r.type === 'sport') sport++
    else other++
  }
  return [sport && `${t('type.sport')} ${sport}`, other && `${t('type.tradOther')} ${other}`].filter(Boolean).join(' · ')
}

/**
 * 分區的識別色：以所屬區域的顏色為基礎，依分區順序由深到淺。
 * Sheet 上沒有分區專屬的顏色，這樣既看得出屬於同一區，又能彼此區分。
 */
export function sectorColor(areaColor: string | undefined, index: number, count: number): string | undefined {
  if (!areaColor) return undefined
  if (count <= 1) return areaColor
  // t：-0.3（較深）到 +0.45（較淺）
  const t = -0.3 + (0.75 * index) / (count - 1)
  return mix(areaColor, t < 0 ? '#000000' : '#ffffff', Math.abs(t))
}

function mix(a: string, b: string, amount: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * amount).toString(16).padStart(2, '0')).join('')
}
