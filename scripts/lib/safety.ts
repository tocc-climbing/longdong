import type { Safety } from '../../src/data/schema'

/*
 * 「安全評級」欄在 Sheet 上是三顆「●」，用字體顏色當紅綠燈：
 *   亮起：紅 #cc0000、黃 #f1c232、綠 #6aa84f
 *   未亮：淡紅 #ffe3e3、淡黃 #fff2cc、淡綠 #d9ead3
 *   三顆都是灰色（一般文字 "●●●"，沒有個別顏色）：尚未評級
 * CSV 匯出會丟掉顏色（每格都只剩 "●●●"），所以改從 htmlview 讀。
 * htmlview 每列的 <th id="{gid}R{列索引}"> 跟 CSV 的列索引（從 0 起算）一致。
 */

const LIT: Record<string, Safety> = {
  '#cc0000': 'red',
  '#f1c232': 'yellow',
  '#6aa84f': 'green',
}

export function htmlUrl(sheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview/sheet?headers=true&gid=${gid}`
}

/**
 * 回傳 列索引 → 燈號（null 表示尚未評級）。
 * 有個別上色但亮燈數不是剛好一顆的列無法判讀，停止匯入並列出這些列。
 */
export function parseSafetyHtml(html: string, gid: string, areaId: string): Map<number, Safety | null> {
  const ratings = new Map<number, Safety | null>()
  const unreadable: number[] = []
  const rowId = new RegExp(`id="${gid}R(\\d+)"`)
  for (const tr of html.split('<tr').slice(1)) {
    const row = tr.match(rowId)
    if (!row) continue
    const dots = tr.match(/(?:<span style="[^"]*">●<\/span>){3}/)
    if (!dots) {
      if (tr.includes('>●●●<')) ratings.set(Number(row[1]), null)
      continue
    }
    const colors = [...dots[0].matchAll(/color:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase())
    const lit = colors.map((c) => LIT[c]).filter(Boolean)
    if (lit.length === 1) ratings.set(Number(row[1]), lit[0])
    else unreadable.push(Number(row[1]) + 1)
  }
  if (unreadable.length) {
    throw new Error(`[${areaId}] 第 ${unreadable.join('、')} 列：安全評級燈號無法判讀（不是剛好一顆亮燈），請在 Sheet 修正燈號顏色`)
  }
  return ratings
}

/** 分頁標題列（第 1 列）的底色，例如後門 #cc0000；讀不到時回傳 undefined */
export function parseTitleColor(html: string, gid: string): string | undefined {
  const row = html.split('<tr').find((tr) => tr.includes(`id="${gid}R0"`))
  const cls = row?.match(/<td class="(s\d+)"/)?.[1]
  if (!cls) return undefined
  const css = html.match(new RegExp(String.raw`(?:^|[^\w-])\.${cls}\{([^}]*)\}`))?.[1] ?? ''
  return css.match(/background-color:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase()
}
