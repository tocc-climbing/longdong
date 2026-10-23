import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import type { AnchorHardware, Area, Bolt, Hardware, Route, Safety, Sector } from '../../src/data/schema'
import {
  cleanParagraphs,
  cleanPeople,
  cleanText,
  gradeValue,
  isAge,
  isDate,
  latestDate,
  parseDate,
  parseHeight,
  parseInt0,
  parseRouteType,
  parseStatus,
  splitName,
} from './normalize'

/*
 * 區域分頁的版面：
 *   第 0 列：「  後門\n  Back Door」, bolt 總數, "支 Bolt", 路線數, "條攀登路線"
 *   第 1 列：欄位標題（分區、路線編號、路線名稱…B01…A01…Anchor 配件…）
 *   之後每條路線佔 1 列或多列：
 *     第一列是路線資料，bolt 欄是材質代號
 *     接下來幾列只有 bolt 欄有值：安裝日期、「N 年」（公式算出的年資）、歷次拉測日期（新到舊）
 *     Anchor 配件欄則依序是：品項、數量、安裝日期、年資
 *   「分區」是合併儲存格，只有該分區第一條路線有值。
 *   分頁最下方是材質圖例和統計表，路線編號欄會出現 "304-FX"、"統計" 等值。
 */

export function readCsv(text: string): string[][] {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false })
  return result.data
}

const ROUTE_NUMBER = /^#?\s*(\d+(?:\.\d+)?)$/
const LEGEND = /^(?:\d{3}|Ti)-[A-Za-z0-9]+$|^統計$/

export interface ParsedArea extends Area {
  warnings: string[]
  /** 有「路線ID」欄時，缺 ID 或格式錯誤的路線（匯入應中止） */
  idErrors: string[]
  /** 分頁是否有「路線ID」欄 */
  hasIdColumn: boolean
}

export interface AreaSheetOptions {
  cragId: string
  areaId: string
  /** 分頁標題的中文名稱，用來確認 gid 沒有對錯 */
  expectedZh: string
  /** 列索引 → 安全評級燈號，null 為尚未評級（由 htmlview 解析，見 safety.ts） */
  safety?: Map<number, Safety | null>
}

/** Apps Script 產生的路線ID：6 碼，不含 0/o、1/l/i（見 apps-script/RouteIds.gs） */
export const ROUTE_ID = /^[2-9a-hjkmnp-z]{6}$/

/**
 * ID 規則（使用者的收藏與攀登紀錄會用到，發布後不可再改）：
 *   區域  <crag>/<area>              longdong/back-door
 *   路線  <crag>/<路線ID 欄>          longdong/7kq2mx（Sheet 的「路線ID」欄，由 Apps Script 產生）
 * Sheet 還沒有「路線ID」欄時，暫用舊規則：<crag>/<路線編號>，未編號者 <crag>/x-<區域＋名稱雜湊>
 */
export function parseAreaSheet(text: string, opts: AreaSheetOptions): ParsedArea {
  const { cragId, areaId, expectedZh, safety = new Map() } = opts
  const rows = readCsv(text)
  const warnings: string[] = []
  const idErrors: string[] = []

  const title = splitName(rows[0]?.[0])
  if (!title || title.zh !== expectedZh) {
    throw new Error(`[${areaId}] 分頁標題是「${title?.zh}」，預期「${expectedZh}」— gid 可能對錯了`)
  }

  const headerIdx = rows.findIndex((r) => r[0]?.trim() === '分區')
  if (headerIdx < 0) throw new Error(`[${areaId}] 找不到欄位標題列`)
  const header = rows[headerIdx].map((h) => h.trim())
  const col = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`[${areaId}] 缺少欄位「${name}」`)
    return i
  }
  const C = {
    sector: col('分區'),
    number: col('路線編號'),
    name: col('路線名稱'),
    grade: col('難度'),
    type: col('路線種類'),
    height: col('高度'),
    fa: col('首攀'),
    faDate: col('首攀日期'),
    description: col('路線資訊描述'),
    safety: col('安全評級'),
    hardwareStart: col('Anchor 配件'),
    boltCount: col('Bolt 統計'),
    status: col('路線狀態'),
    statusDate: col('日期'),
    notes: col('備註'),
  }
  const idCol = header.indexOf('路線ID')
  const boltCols = header.flatMap((h, i) => (/^B\d{2}$/.test(h) ? [i] : []))
  const anchorCols = header.flatMap((h, i) => (/^A\d{2}$/.test(h) ? [i] : []))
  const hardwareCols: number[] = []
  for (let i = C.hardwareStart; i < C.boltCount; i++) hardwareCols.push(i)

  // 1. 切成路線區塊
  interface Block {
    sector: string | undefined
    rows: string[][]
    line: number
  }
  const blocks: Block[] = []
  let currentSector: string | undefined
  let current: Block | undefined

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const cell = (c: number) => (r[c] ?? '').trim()
    const no = cell(C.number)

    if (LEGEND.test(no)) break
    if (cell(C.sector)) currentSector = r[C.sector]

    if (ROUTE_NUMBER.test(no)) {
      current = { sector: currentSector, rows: [r], line: i + 1 }
      blocks.push(current)
    } else if (no) {
      // 路線編號欄出現說明文字（例如第二洞的開發歷史）：只留在 Sheet，不匯入
      current = undefined
    } else if (current && r.some((c) => c.trim())) {
      current.rows.push(r)
    }
  }

  // 2. 區塊轉成路線，並依分區分組
  const sectors: Sector[] = []
  const sectorByKey = new Map<string, Sector>()
  const unreadableSafety: string[] = []

  for (const block of blocks) {
    const first = block.rows[0]
    const cell = (c: number) => (first[c] ?? '').trim()
    const columnValues = (c: number) =>
      block.rows.map((r) => (r[c] ?? '').trim()).filter((v) => v !== '')

    const numberMatch = cell(C.number).match(ROUTE_NUMBER)!
    const rawNumber = numberMatch[1]
    const number = Number(rawNumber) === 0 ? undefined : rawNumber

    const name = splitName(first[C.name])
    if (!name) {
      warnings.push(`[${areaId}] 第 ${block.line} 列：路線名稱空白，略過`)
      continue
    }

    const grade = cleanText(first[C.grade])?.replace(/\n/g, ' ')
    const type = parseRouteType(cell(C.type))

    const bolts = boltCols.flatMap((c) => parseBolt(header[c], columnValues(c)))
    const anchors = anchorCols.flatMap((c) => parseBolt(header[c], columnValues(c)))
    const anchorHardware = hardwareCols.flatMap((c) => parseHardwareColumn(columnValues(c)))

    const routeId = (): string => {
      if (idCol < 0) return number ? `${cragId}/${number}` : `${cragId}/x-${stableHash(`${areaId}|${name.zh}`)}`
      const code = cell(idCol)
      if (!ROUTE_ID.test(code)) {
        idErrors.push(`[${areaId}] 第 ${block.line} 列 #${number ?? '0'} ${name.zh}：${code ? `路線ID「${code}」格式不對` : '缺少路線ID'}`)
      }
      return `${cragId}/${code || `missing-${block.line}`}`
    }

    const statusLabel = cell(C.status) || undefined
    const route: Route = {
      id: routeId(),
      number,
      isFixture: !grade && !type,
      pitch: parsePitch(name.zh),
      name,
      grade,
      gradeValue: gradeValue(grade),
      type,
      heightM: parseHeight(cell(C.height)),
      firstAscent: cleanPeople(first[C.fa]),
      firstAscentDate: parseDate(cell(C.faDate)),
      description: cleanParagraphs(first[C.description]),
      safety: safety.get(block.line - 1) ?? undefined,
      bolts,
      anchors,
      anchorHardware,
      boltCount: parseInt0(cell(C.boltCount)),
      status: parseStatus(statusLabel),
      statusLabel,
      statusDate: parseDate(cell(C.statusDate)),
      lastTested: latestDate([...bolts, ...anchors].flatMap((b) => b.tests)),
      notes: cleanText(first[C.notes]),
    }
    if (cell(C.safety).includes('●') && !safety.has(block.line - 1)) {
      unreadableSafety.push(`第 ${block.line} 列 #${number ?? '0'} ${name.zh}`)
    }
    if (grade && route.gradeValue === undefined && !/\?\?/.test(grade)) {
      warnings.push(`[${areaId}] #${number ?? '0'} ${name.zh}：無法判讀難度「${grade}」`)
    }

    const sectorName = splitName(block.sector) ?? { zh: '其他' }
    const key = sectorName.zh
    let sector = sectorByKey.get(key)
    if (!sector) {
      sector = { id: `${cragId}/${areaId}-s${sectors.length + 1}`, name: sectorName, routes: [] }
      sectorByKey.set(key, sector)
      sectors.push(sector)
    }
    sector.routes.push(stripUndefined(route))
  }

  if (unreadableSafety.length) {
    throw new Error(`[${areaId}] 讀不到安全評級燈號，Sheet 版面可能變了：\n  ${unreadableSafety.join('\n  ')}`)
  }

  const [, bolts, , routes] = rows[0]
  return {
    id: `${cragId}/${areaId}`,
    name: title,
    summary: { bolts: parseInt0(bolts), routes: parseInt0(routes) },
    sectors,
    warnings,
    idErrors,
    hasIdColumn: idCol >= 0,
  }
}

/** 一個 bolt 欄（同一路線的多列）：材質、安裝日期、年資、拉測日期… */
export function parseBolt(position: string, values: string[]): Bolt[] {
  if (values.length === 0) return []
  const [first, ...rest] = values
  if (isDate(first) || isAge(first)) return [] // 沒有材質，只有零散日期，視為空

  const material = cleanText(first)!.replace(/\n/g, ' ')
  let installed: string | undefined
  const tests: string[] = []
  for (const v of rest) {
    if (isAge(v)) continue
    const d = parseDate(v)
    if (!d) continue
    if (installed === undefined) installed = d
    else tests.push(d)
  }
  tests.sort().reverse()
  const bolt: Bolt = { position, material, tests }
  if (installed) bolt.installed = installed
  return [bolt]
}

/** 一個 Anchor 配件欄：品項、數量 xN 或長度規格、安裝日期、年資 */
export function parseHardwareColumn(values: string[]): AnchorHardware[] {
  if (values.length === 0) return []
  const [first, ...rest] = values
  if (isDate(first) || isAge(first)) return []
  const hw: AnchorHardware = { item: cleanText(first)! }
  for (const v of rest) {
    if (isAge(v) || v === '0' || /^[?？/ ]+$/.test(v)) continue
    const qty = v.match(/數量\s*x\s*(\d+)/i)
    if (qty) {
      hw.quantity = Number(qty[1])
      continue
    }
    const d = parseDate(v)
    if (d) {
      hw.installed ??= d
      continue
    }
    hw.spec = hw.spec ? `${hw.spec}, ${v}` : v
  }
  return [hw]
}

/** 「統計」分頁的材質代號對照表 */
export function parseHardwareSheet(text: string): Hardware[] {
  const rows = readCsv(text)
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() === 'Bolt 代號'))
  if (headerIdx < 0) throw new Error('[統計] 找不到「Bolt 代號」表頭')
  const c = rows[headerIdx].findIndex((x) => x.trim() === 'Bolt 代號')
  const out: Hardware[] = []
  for (const r of rows.slice(headerIdx + 1)) {
    const code = r[c]?.trim()
    if (!code || !LEGEND.test(code) || code === '統計') {
      if (out.length) break
      continue
    }
    out.push({ code, description: cleanText(r[c + 1]) ?? code })
  }
  return out
}

/** 「大懸岩 | P2」→ 2 */
export function parsePitch(zhName: string): number | undefined {
  const m = zhName.match(/\|\s*P(\d+)/i)
  return m ? Number(m[1]) : undefined
}

function stableHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 8)
}

function stripUndefined<T extends object>(obj: T): T {
  for (const k of Object.keys(obj) as (keyof T)[]) if (obj[k] === undefined) delete obj[k]
  return obj
}
