/**
 * 從 Google Sheet 匯入路線資料，輸出 public/data/longdong.json。
 *
 *   npm run import                  # 從線上 Sheet 下載
 *   npm run import -- --from <dir>  # 改讀本機檔案（<area-id>.csv、<area-id>.html、stats.csv）
 *   npm run import -- --check       # 只驗證，不寫檔；資料有變動時 exit code 為 2
 *
 * 內容沒有變動時不會改寫檔案，避免每次排程都產生 commit。
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Dataset, type Area } from '../src/data/schema'
import { attachLegacySectorIds, parseAreaSheet, parseHardwareSheet } from './lib/parse'
import { htmlUrl, parseSafetyHtml, parseTitleColor } from './lib/safety'
import { checkRouteIds, publishedRoutes, type IdSource, type PreviousIds } from './lib/ids'
import { RETIRED_ROUTE_IDS } from './retired-ids'
import { AREA_TABS, CRAG, DATA_ATTRIBUTION, DATA_LICENSE, PROJECT_URL, SHEET_ID, SHEET_URL, STATS_GID, csvUrl } from './sheet.config'

const OUT = resolve(import.meta.dirname, '../public/data/longdong.json')
// 舊的分區 ID（依位置編號）→ 現在的 ID，凍結在改用名稱雜湊當天的對照，之後不再重算
const LEGACY_SECTOR_IDS = resolve(import.meta.dirname, 'data/legacy-sector-ids.json')

const args = process.argv.slice(2)
const fromDir = args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined
const checkOnly = args.includes('--check')

async function load(name: string, gid: string, format: 'csv' | 'html' = 'csv'): Promise<string> {
  if (fromDir) return readFileSync(join(fromDir, `${name}.${format}`), 'utf8')
  const url = format === 'csv' ? csvUrl(gid) : htmlUrl(SHEET_ID, gid)
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (format === 'csv' && text.trimStart().startsWith('<')) {
        throw new Error('收到 HTML 而不是 CSV，Sheet 可能不是公開的')
      }
      return text
    } catch (err) {
      if (attempt >= 3) throw new Error(`下載 ${name}（gid=${gid}）失敗：${(err as Error).message}`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

async function main() {
  const [hardwareCsv, areaCsvs, areaHtmls] = await Promise.all([
    load('stats', STATS_GID),
    Promise.all(AREA_TABS.map((t) => load(t.id, t.gid))),
    // 安全評級燈號只存在於字體顏色，CSV 讀不到
    Promise.all(AREA_TABS.map((t) => load(t.id, t.gid, 'html'))),
  ])

  const hardware = parseHardwareSheet(hardwareCsv)
  const warnings: string[] = []
  const idErrors: string[] = []
  const withIdColumn: string[] = []
  const areas: Area[] = AREA_TABS.map((tab, i) => {
    const ratings = parseSafetyHtml(areaHtmls[i], tab.gid, tab.id)
    if (ratings.size === 0) throw new Error(`[${tab.id}] htmlview 裡找不到任何安全評級燈號，Sheet 版面可能變了`)
    const { warnings: w, idErrors: e, hasIdColumn, ...area } = parseAreaSheet(areaCsvs[i], {
      cragId: CRAG.id,
      areaId: tab.id,
      expectedZh: tab.zh,
      safety: ratings,
    })
    const color = parseTitleColor(areaHtmls[i], tab.gid)
    if (color) area.color = color
    else warnings.push(`[${tab.id}] 讀不到標題列的顏色`)
    warnings.push(...w)
    idErrors.push(...e)
    if (hasIdColumn) withIdColumn.push(tab.zh)
    return area
  })

  const orphans = attachLegacySectorIds(areas, JSON.parse(readFileSync(LEGACY_SECTOR_IDS, 'utf8')) as Record<string, string>)
  if (orphans.length) warnings.push(`舊的分區 ID 對不到現在的分區（分區改名或刪除），舊網址會找不到：${orphans.join(', ')}`)

  // 所有區域分頁都有「路線ID」欄才改用它；只有部分分頁有，代表 Apps Script 還沒跑完
  if (withIdColumn.length > 0 && withIdColumn.length < AREA_TABS.length) {
    throw new Error(
      `只有部分分頁有「路線ID」欄（${withIdColumn.join('、')}），請在 Sheet 執行「路線ID → 補上缺少的 ID」`,
    )
  }
  const idSource: IdSource = withIdColumn.length ? 'sheet' : 'legacy'
  if (idErrors.length) {
    throw new Error(`以下路線的路線ID有問題，請在 Sheet 執行「路線ID → 補上缺少的 ID」：\n  ${idErrors.join('\n  ')}`)
  }

  // 舊規則：路線編號在全龍洞應該唯一。多繩距路線的各段可能共用編號（例如 #242 P1、P2），
  // 以 -p<段數> 區分；其他重複則加序號並提出警告
  const seen = new Map<string, number>()
  for (const route of idSource === 'legacy' ? areas.flatMap((a) => a.sectors.flatMap((s) => s.routes)) : []) {
    const n = (seen.get(route.id) ?? 0) + 1
    seen.set(route.id, n)
    if (n === 1) continue
    if (route.pitch && route.pitch > 1 && !seen.has(`${route.id}-p${route.pitch}`)) {
      route.id = `${route.id}-p${route.pitch}`
      seen.set(route.id, 1)
    } else {
      warnings.push(`路線編號 #${route.number} 重複（${route.name.zh}），id 改為 ${route.id}-${n}`)
      route.id = `${route.id}-${n}`
    }
  }

  // version 涵蓋 version、updatedAt 以外的所有內容，metadata 變動也會重新輸出
  const content = {
    schemaVersion: 2 as const,
    crag: CRAG,
    idSource,
    source: { sheetId: SHEET_ID, url: SHEET_URL, attribution: DATA_ATTRIBUTION, projectUrl: PROJECT_URL },
    license: DATA_LICENSE,
    hardware,
    areas,
  }
  const version = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12)

  const previous = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Partial<Dataset>) : undefined
  const changed = previous?.version !== version

  const previousIds: PreviousIds | undefined = previous && {
    idSource: previous.idSource,
    routes: publishedRoutes(previous.areas ?? []),
  }
  const idCheck = checkRouteIds(idSource, publishedRoutes(areas), previousIds, RETIRED_ROUTE_IDS)
  if (idCheck.errors.length) throw new Error(`路線ID 檢查未通過：\n  ${idCheck.errors.join('\n  ')}`)
  const removedNote = idCheck.removed.map((r) => `#${r.number ?? '0'} ${r.name}（${r.id}）`)

  const dataset = Dataset.parse({
    version,
    updatedAt: changed ? new Date().toISOString() : previous!.updatedAt,
    ...content,
  })

  const routes = areas.flatMap((a) => a.sectors.flatMap((s) => s.routes))
  console.log(`區域 ${areas.length}、路線 ${routes.length}、bolt ${routes.reduce((n, r) => n + r.bolts.length + r.anchors.length, 0)}`)
  for (const a of areas) {
    // 表頭的路線數包含固定點項目
    const count = a.sectors.reduce((n, s) => n + s.routes.length, 0)
    const flag = a.summary.routes !== undefined && a.summary.routes !== count ? `（表頭寫 ${a.summary.routes}）` : ''
    console.log(`  ${a.name.zh.padEnd(4, '　')} ${String(count).padStart(3)} 條${flag}`)
  }
  if (removedNote.length) {
    console.log(`\n已從 Sheet 刪除的路線 ${removedNote.length} 條：`)
    for (const n of removedNote) console.log(`  - ${n}`)
  }
  if (warnings.length) {
    console.log(`\n警告 ${warnings.length} 則：`)
    for (const w of warnings) console.log(`  - ${w}`)
  }

  if (!changed) {
    console.log(`\n資料沒有變動（version ${version}）`)
    return
  }
  if (checkOnly) {
    console.log(`\n資料有變動：${previous?.version ?? '(無)'} → ${version}`)
    process.exitCode = 2
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(dataset) + '\n')
  // 給 GitHub Actions：刪除的路線寫進 commit 訊息與執行摘要，事後查得到
  if (removedNote.length) {
    const note = `刪除的路線：\n${removedNote.map((n) => `- ${n}`).join('\n')}\n`
    mkdirSync(resolve(import.meta.dirname, '../.cache'), { recursive: true })
    writeFileSync(resolve(import.meta.dirname, '../.cache/import-notes.txt'), note)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${note}`)
  }
  console.log(`\n已寫入 ${OUT}（version ${version}）`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
