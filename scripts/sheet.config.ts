/**
 * 臺灣戶外攀岩協會（TOCC）固定點更新計畫（Rebolting Project）維護的龍洞路線 Google Sheet。
 * 每個區域是一個分頁（gid）。新增或調整分頁時，更新這裡的對應表。
 */
export const CRAG = { id: 'longdong', name: { zh: '龍洞', en: 'Long Dong' } }

export const SHEET_ID = '1QHFNQSPgKgQrTNnYn246wfotOYqOkzHjLltZ26keBgg'

export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`

export interface AreaTab {
  id: string
  gid: string
  /** 分頁表頭上的中文名稱，用來確認 gid 沒有對錯 */
  zh: string
}

/** 與 Sheet 分頁順序相同 */
export const AREA_TABS: AreaTab[] = [
  { id: 'back-door', gid: '409537589', zh: '後門' },
  { id: 'golden-valley', gid: '1832070709', zh: '黃金谷' },
  { id: 'second-cave', gid: '889241091', zh: '第二洞' },
  { id: 'first-cave', gid: '1293712778', zh: '第一洞' },
  { id: 'grand-auditorium', gid: '762175452', zh: '大禮堂' },
  { id: 'music-hall', gid: '2062407584', zh: '音樂廳' },
  { id: 'long-lane', gid: '287870661', zh: '長巷' },
  { id: 'clocktower', gid: '56988041', zh: '鐘塔' },
  { id: 'school-gate', gid: '0', zh: '校門口' },
]

/** 「統計」分頁，內含 bolt 材質代號對照表 */
export const STATS_GID = '2004465247'

export const DATA_LICENSE = 'CC BY-SA 4.0'

export const DATA_ATTRIBUTION = '臺灣戶外攀岩協會（TOCC）固定點更新計畫'

export const PROJECT_URL = 'https://www.tocc-climbing.org/rebolting-project'

export function csvUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
}

/** 網站的正式網址（結尾有 /）：分享頁的 og:url、og:image 需要完整網址 */
export const SITE_URL = 'https://longdong.web.app/'
