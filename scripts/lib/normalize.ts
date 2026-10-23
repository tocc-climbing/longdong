import type { LocalizedName, RouteStatus, RouteType } from '../../src/data/schema'

const CJK = /[㐀-鿿豈-﫿]/

/**
 * NFKC 正規化：Sheet 有些文字是從 PDF 複製的，含有康熙部首字元
 * （例如「⽯」U+2F6F），不轉成一般漢字會搜尋不到。
 */
export function cleanText(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const lines = raw
    .normalize('NFKC')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
  // 去掉頭尾空行，中間連續空行合併成一行
  const out: string[] = []
  for (const l of lines) {
    if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(l)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.length ? out.join('\n') : undefined
}

const DASH_LINE = /^[–—-]+$/

/** 描述欄用單獨一行「–」分段，轉成空行 */
export function cleanParagraphs(raw: string | undefined): string | undefined {
  const text = cleanText(raw)
  if (!text) return undefined
  return cleanText(text.split('\n').map((l) => (DASH_LINE.test(l) ? '' : l)).join('\n'))
}

/** 首攀欄用單獨一行「—」分隔多人，直接去掉 */
export function cleanPeople(raw: string | undefined): string | undefined {
  const text = cleanText(raw)
  if (!text) return undefined
  return text.split('\n').filter((l) => l && !DASH_LINE.test(l)).join('\n') || undefined
}

/** 「中文名稱\nEnglish Name」→ { zh, en }。含漢字的行歸中文，其餘歸英文。 */
export function splitName(raw: string | undefined): LocalizedName | undefined {
  const text = cleanText(raw)
  if (!text) return undefined
  const lines = text.split('\n').filter((l) => l && !DASH_LINE.test(l))
  const zh = lines.filter((l) => CJK.test(l))
  const en = lines.filter((l) => !CJK.test(l))
  if (zh.length === 0) return { zh: en.join(' ') }
  return en.length ? { zh: zh.join(' '), en: en.join(' ') } : { zh: zh.join(' ') }
}

/** "2018 / 04 / 14 (週六)"、"1991 / 06"、"2004"、"20260712" → 部分 ISO 日期 */
export function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw.normalize('NFKC').trim()
  let m = s.match(/^(\d{4})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{1,2}))?/)
  if (m) {
    const [, y, mo, d] = m
    return d ? `${y}-${pad(mo)}-${pad(d)}` : `${y}-${pad(mo)}`
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{4})$/)
  if (m) return m[1]
  // 儲存格格式跑掉時，Google Sheet 會輸出試算表序號（1899-12-30 起算的天數）
  m = s.match(/^(\d{5})$/)
  if (m && Number(m[1]) > 20000 && Number(m[1]) < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + Number(m[1]) * 86400000).toISOString().slice(0, 10)
  }
  return undefined
}

function pad(n: string): string {
  return n.padStart(2, '0')
}

export function isDate(raw: string): boolean {
  return parseDate(raw) !== undefined
}

/** Sheet 用公式算出的「N 年」，匯入時略過，由前端自行計算 */
export function isAge(raw: string): boolean {
  return /^\d+\s*年$/.test(raw.trim())
}

/**
 * 難度轉數值，方便排序：5.9 = 36、5.10a = 40、5.10b = 41、5.10a/b = 40.5、5.10? = 41.5。
 * 無法判讀（例如 5.??）時回傳 undefined。
 */
export function gradeValue(grade: string | undefined): number | undefined {
  if (!grade) return undefined
  const m = grade.match(/^5\.(\d{1,2})([a-d])?(?:\/([a-d]))?(\?)?/)
  if (!m) return undefined
  const major = Number(m[1])
  if (major < 10) return major * 4
  const letter = (c: string) => 'abcd'.indexOf(c)
  if (m[2] && m[3]) return major * 4 + (letter(m[2]) + letter(m[3])) / 2
  if (m[2]) return major * 4 + letter(m[2])
  return major * 4 + 1.5
}

const TYPE_MAP: Record<string, RouteType> = {
  運攀: 'sport',
  傳攀: 'trad',
  上方架繩: 'toprope',
  抱石: 'boulder',
  混合: 'mixed',
}

/** 對照表沒有的種類回傳 undefined（由呼叫端停止匯入） */
export function parseRouteType(raw: string | undefined): RouteType | undefined {
  if (!raw) return undefined
  const key = raw.normalize('NFKC').split('|')[0].trim()
  return TYPE_MAP[key]
}

const STATUS_MAP: Record<string, RouteStatus> = {
  已拉測: 'tested',
  已更新: 'rebolted',
  待拉測: 'needs-test',
  待更新: 'needs-rebolt',
  路線封閉: 'closed',
  待移除: 'to-remove',
  待查: 'unknown',
  待確認: 'unknown',
}

/** 對照表沒有的狀態回傳 undefined（由呼叫端停止匯入） */
export function parseStatus(raw: string | undefined): RouteStatus | undefined {
  if (!raw) return undefined
  return STATUS_MAP[raw.trim()]
}

export function parseHeight(raw: string | undefined): number | undefined {
  const m = raw?.match(/(\d+(?:\.\d+)?)\s*m/)
  return m ? Number(m[1]) : undefined
}

export function parseInt0(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw.replace(/,/g, '').trim())
  return Number.isInteger(n) ? n : undefined
}

/** 比較部分 ISO 日期字串（字典序即可），回傳較新者 */
export function latestDate(dates: (string | undefined)[]): string | undefined {
  let best: string | undefined
  for (const d of dates) if (d && (!best || d > best)) best = d
  return best
}
