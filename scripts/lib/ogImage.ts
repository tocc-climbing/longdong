/**
 * 路線的分享圖片（Open Graph，1200×630）：Facebook、LINE 分享路線時顯示，不再每條都是網站圖示。
 * 左邊是路線資訊（岩場／區域／分區、編號與名稱、難度、種類、高度；黃燈、紅燈時加上提醒），
 * 右邊是路線所在區域附近的放大地圖（圓角），下方是網站名稱與網址。配色與手機版相同。
 */
import { existsSync, readFileSync } from 'node:fs'
import { GlobalFonts, type Image, type SKRSContext2D, createCanvas, loadImage } from '@napi-rs/canvas'
import type { Area, Route, Sector } from '../../src/data/schema'
import { gradeBand, quickdraws } from '../../src/format'

export const OG_SIZE = { w: 1200, h: 630 }

/**
 * 字型檔：英數用西文字型（中文字型裡的 ’ 等標點是全形寬度），中文用無襯線黑體。
 * GitHub Actions 用 Noto Sans 與 Noto Sans TC（scripts/install-og-fonts.sh 安裝），Windows 本機用 Segoe UI 與微軟正黑體。
 * 不用系統字型的自動挑選：挑到的可能是書法體。
 */
const FONT_CANDIDATES = [
  {
    latin: 'Noto Sans',
    cjk: 'Noto Sans TC',
    files: [
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
      '/usr/share/fonts/opentype/noto-tc/NotoSansTC-Regular.otf',
      '/usr/share/fonts/opentype/noto-tc/NotoSansTC-Bold.otf',
    ],
  },
  {
    latin: 'Segoe UI',
    cjk: 'Microsoft JhengHei',
    files: ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/msjhbd.ttc'],
  },
]

let foundFonts: { latin: string; cjk: string; files: string[] } | undefined

/** 找得到的字型；都找不到時是 undefined（其他系統的本機建置：分享圖片用網站圖示，見 gen-share-pages.ts） */
export function findOgFonts() {
  return (foundFonts ??= FONT_CANDIDATES.find((f) => f.files.every((file) => existsSync(file))))
}

function ogFonts() {
  const found = findOgFonts()
  if (!found) throw new Error('找不到字型：Linux 請執行 scripts/install-og-fonts.sh')
  return found
}

type Ring = [number, number][]
export interface OgMap {
  /** 陸地（經緯度） */
  land: Ring[]
  /** 大區域 key → 外框（經緯度） */
  areas: Record<string, Ring[]>
}

/** 與手機版相同的配色：米白底、TOCC 藍、桃紅；難度膠囊與狀態色塊也和網站一樣 */
const LIGHT = {
  paper: '#faf8f4',
  text: '#141414',
  muted: '#6b675f',
  line: '#ebe6dc',
  brand: '#0395c3',
  land: '#ffffff',
  sea: '#dcedf3',
  areaLine: '#c9c4b8',
  band: { easy: '#dcf1e2', g10: '#fbf0c4', g11: '#fde1cb', g12: '#fbd5d5', g13: '#e7dcf6' } as Record<string, string>,
  warn: { color: '#d99a00', bg: '#fbf0d3', fg: '#7a5600' },
  danger: { color: '#d40442', bg: '#fbe1e8', fg: '#a3032f' },
}
const C = LIGHT

const TYPE_ZH: Record<string, string> = { sport: '運攀', trad: '傳攀', toprope: '上方架繩', boulder: '抱石', mixed: '混合' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CJK = /[　-鿿＀-￯]/

/** 文字內容：中文與英數分成片段，各自指定字型（同一段列兩套字型時，中文的備援字型不會照粗細挑） */
function rich(text: string): string {
  const fonts = ogFonts()
  const runs: { cjk: boolean; text: string }[] = []
  for (const c of text) {
    const cjk = CJK.test(c)
    const last = runs.at(-1)
    if (last && (last.cjk === cjk || c === ' ')) last.text += c
    else runs.push({ cjk, text: c })
  }
  return runs.map((r) => `<tspan font-family="${r.cjk ? fonts.cjk : fonts.latin}">${esc(r.text)}</tspan>`).join('')
}

/** 文字寬度（估計）：中日文字約 1 個字高，英數約 0.56 */
function textWidth(text: string, size: number): number {
  return [...text].reduce((w, c) => w + (CJK.test(c) ? 1 : 0.56) * size, 0)
}

/** 放得進 maxWidth 的最大字級（不小於 min），太長就截斷加「…」 */
function fit(text: string, max: number, min: number, maxWidth: number): { text: string; size: number } {
  for (let size = max; size >= min; size -= 2) if (textWidth(text, size) <= maxWidth) return { text, size }
  let cut = text
  while (cut.length > 1 && textWidth(cut + '…', min) > maxWidth) cut = cut.slice(0, -1)
  return { text: cut.trimEnd() + '…', size: min }
}

/**
 * 切成第一行放得下的部分與剩下的部分。優先在「 / 」「 | 」「 > 」這類分隔後面斷開（分隔留在第一行），
 * 其次在空白、括號前斷開，都沒有才硬切。
 */
function splitLine(text: string, size: number, maxWidth: number): [string, string] {
  let end = text.length
  while (end > 1 && textWidth(text.slice(0, end), size) > maxWidth) end--
  const head = text.slice(0, end)
  const separator = Math.max(...[' / ', ' | ', ' > ', '／'].map((c) => (head.lastIndexOf(c) > 0 ? head.lastIndexOf(c) + c.trimEnd().length : -1)))
  const space = Math.max(...[' ', '(', '（'].map((c) => head.lastIndexOf(c)))
  const cut = separator > 0 ? separator : space > 0 ? space : end
  return [text.slice(0, cut).trimEnd(), text.slice(cut).trimStart()]
}

/**
 * 垂直置中的文字基線：cy 是文字中線，基線往下約 0.35 個字高。
 * 不用 dominant-baseline="central"：Skia（@napi-rs/canvas）不支援。
 */
const mid = (cy: number, size: number) => (cy + size * 0.35).toFixed(1)

/** 一個膠囊：底色、文字 */
function pill(x: number, y: number, text: string, opts: { size: number; bg: string; fg: string; bold?: boolean; stroke?: string }) {
  const w = textWidth(text, opts.size) + opts.size * 1.1
  const h = opts.size * 1.6
  const rect = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${opts.bg}"${opts.stroke ? ` stroke="${opts.stroke}" stroke-width="3"` : ''}/>`
  const label = `<text x="${x + w / 2}" y="${mid(y + h / 2, opts.size)}" font-size="${opts.size}" font-weight="${opts.bold ? 700 : 500}" fill="${opts.fg}" text-anchor="middle">${rich(text)}</text>`
  return { svg: rect + label, w }
}

/** 右邊的圓角框 */
type Box = { x: number; y: number; w: number; h: number; r: number }
const PANEL: Box = { x: 760, y: 32, w: 408, h: OG_SIZE.h - 64, r: 28 }

/** 地圖範圍至少這麼大（度，約 400 公尺），小區域（第一洞）也看得到周圍 */
const MAP_MIN_SPAN = 0.0036

/**
 * 右邊的地圖：放大到路線所在的大區域附近（areaKey 省略時是整個龍洞）。所在區域實色（不描邊），附近的區域用各自的顏色、半透明。
 * areaColors：大區域 key → 顏色（Sheet 上的區域色）
 */
function areaMap(map: OgMap, areaKey: string | undefined, areaColors: Record<string, string>, box: Box, othersOpacity = 0.22, pad = 1.5): string {
  const rings = (areaKey && map.areas[areaKey]) || Object.values(map.areas).flat()
  const pts = rings.flat()
  const lat0 = pts.reduce((n, p) => n + p[1], 0) / pts.length
  const kx = Math.cos((lat0 * Math.PI) / 180)
  // 範圍：區域外接矩形放大 pad 倍（預設 1.5）、至少 MAP_MIN_SPAN，再配合框的長寬比（經度依緯度縮放，比例正確）
  const xs = pts.map((p) => p[0] * kx)
  const ys = pts.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  let spanX = Math.max(MAP_MIN_SPAN, (Math.max(...xs) - Math.min(...xs)) * pad)
  let spanY = Math.max(MAP_MIN_SPAN, (Math.max(...ys) - Math.min(...ys)) * pad)
  if (spanX / spanY > box.w / box.h) spanY = (spanX * box.h) / box.w
  else spanX = (spanY * box.w) / box.h
  const scale = box.w / spanX
  const xy = ([lng, lat]: [number, number]) => `${(box.x + (lng * kx - (cx - spanX / 2)) * scale).toFixed(1)},${(box.y + (cy + spanY / 2 - lat) * scale).toFixed(1)}`
  const path = (r: Ring[]) => r.map((ring) => `M${ring.map(xy).join('L')}Z`).join('')
  const others = Object.entries(map.areas)
    .filter(([k]) => k !== areaKey)
    .map(([k, r]) => `<path d="${path(r)}" fill="${areaColors[k] ?? C.areaLine}" fill-opacity="${othersOpacity}"/>`)
    .join('')
  const target = areaKey && map.areas[areaKey] ? `<path d="${path(map.areas[areaKey])}" fill="${areaColors[areaKey] ?? C.brand}"/>` : ''
  return `<clipPath id="map"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.r}"/></clipPath>
<g clip-path="url(#map)"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${C.sea}"/>
<path d="${path(map.land)}" fill="${C.land}" fill-rule="evenodd"/>${others}${target}</g>`
}

/** 地圖資料：救援地圖的陸地與 9 個大區域的範圍（scripts/gen-scale-map.ts 產生） */
export function loadOgMap(dir: string): OgMap {
  type Feature = { properties: { kind?: string; id?: string }; geometry: { coordinates: Ring[][] } }
  const read = (file: string) => (JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as { features: Feature[] }).features
  const land = read('scale-map.geojson').find((f) => f.properties.kind === 'land')
  if (!land) throw new Error('scale-map.geojson 沒有陸地')
  return { land: land.geometry.coordinates.flat(), areas: Object.fromEntries(read('areas.geojson').map((f) => [f.properties.id!, f.geometry.coordinates.flat()])) }
}

/**
 * SVG 轉成 PNG，再畫上左下角的臺灣島。用 Skia（@napi-rs/canvas）：字型只載入一次，一張約 0.06 秒；
 * resvg 每張都要重新載入中文字型（約 0.3 秒，600 多張要好幾分鐘）。
 */
export async function ogImagePng(svg: string): Promise<Buffer> {
  toccImage ??= loadToccImage()
  const canvas = createCanvas(OG_SIZE.w, OG_SIZE.h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(await loadImage(Buffer.from(svg)), 0, 0)
  drawToccMark(ctx, await toccImage)
  return canvas.toBuffer('image/png')
}

/** 第一次轉檔時：註冊字型、載入 TOCC 標誌（圖片是非同步解碼，要等載入完才畫得出來） */
async function loadToccImage(): Promise<Image> {
  const fonts = ogFonts()
  for (const file of fonts.files) GlobalFonts.registerFromPath(file)
  // 字型集合（.ttc）裡要有指定的字族，不然中文會用到別的字型
  for (const family of [fonts.latin, fonts.cjk]) if (!GlobalFonts.has(family)) throw new Error(`字型檔裡沒有「${family}」`)
  return loadImage(readFileSync(new URL('../../assets/tocc-logo.png', import.meta.url)))
}
let toccImage: Promise<Image> | undefined

/** 名稱裡括號的說明不顯示：「絕不低頭 (舊名:…)」→「絕不低頭」 */
export function plainName(name: string): string {
  return name.replace(/\s*[(（][^)）]*[)）]?\s*/g, ' ').trim() || name
}

/** Climbio 的岩點（簽名點綴）：外形與螺栓孔，中心在 (0, 0)、高約 120 */
const HOLD = 'M-30,-56 C-6,-64 22,-50 26,-20 C30,10 24,46 0,56 C-24,62 -40,40 -38,6 C-36,-26 -46,-50 -30,-56 Z'
const HOLD_HOLE = { cx: -3.7, cy: -23.8, r: 9 }

/** 岩點：中心 (x, y)、縮放 scale；孔用底色 */
function holdMark(x: number, y: number, scale: number, fill: string, hole: string): string {
  return `<g transform="translate(${x} ${y}) rotate(-16) scale(${scale})"><path d="${HOLD}" fill="${fill}"/><circle cx="${HOLD_HOLE.cx}" cy="${HOLD_HOLE.cy}" r="${HOLD_HOLE.r}" fill="${hole}"/></g>`
}

/** TOCC 標誌（assets/tocc-logo.png，1134×1134）裡臺灣島的範圍與外緣（與 scripts/gen-icons.ts 相同），用來排除外圈文字 */
const TOCC_ISLAND = { x: 385, y: 342, width: 320, height: 525 }
const TOCC_OUTLINE = [
  [628, 325], [715, 375], [718, 565], [640, 710], [575, 800], [545, 885], [485, 880],
  [455, 810], [415, 730], [380, 665], [378, 575], [425, 505], [478, 455], [530, 370],
]
/** 左下角的臺灣島（TOCC 標誌中央的臺灣島與攀岩者）：左上角與高度 */
const MARK = { x: 76, y: OG_SIZE.h - 36 - 60, h: 60 }
/** 臺灣島＋攀岩者畫在 canvas 上（Skia 的 SVG 不畫內嵌的圖片，所以不放在 SVG 裡） */
function drawToccMark(ctx: SKRSContext2D, image: Image) {
  const k = MARK.h / TOCC_ISLAND.height
  ctx.save()
  ctx.translate(MARK.x - TOCC_ISLAND.x * k, MARK.y - TOCC_ISLAND.y * k)
  ctx.scale(k, k)
  ctx.beginPath()
  TOCC_OUTLINE.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}

/** 一條路線的分享圖片（SVG） */
export function ogImageSvg(route: Route, area: Area, sector: Sector, map: OgMap, crag: { zh: string }, areaColors: Record<string, string>): string {
  const areaKey = area.id.split('/').pop()!
  const left = MARK.x
  const textW = TEXT_W
  // 左邊的內容從 y=0 排，frame() 再垂直置中
  const body = [placeLine(`${crag.zh} · ${area.name.zh} · ${sector.name.zh}`, area.color ?? C.brand)]

  // 名稱（括號裡的說明不放）；太長分兩行
  let y = 94
  const zh = plainName(route.name.zh)
  const single = fit(zh, 64, 48, textW)
  if (!single.text.endsWith('…')) {
    body.push(`<text x="${left}" y="${y}" font-size="${single.size}" font-weight="700" fill="${C.text}">${rich(single.text)}</text>`)
  } else {
    const [first, rest] = splitLine(zh, 46, textW)
    const second = fit(rest, 46, 36, textW)
    y = 76 // 兩行的字比較小，第一行往上靠近地點那行
    body.push(`<text x="${left}" y="${y}" font-size="46" font-weight="700" fill="${C.text}">${rich(first)}</text>`)
    y += 56
    body.push(`<text x="${left}" y="${y}" font-size="${second.size}" font-weight="700" fill="${C.text}">${rich(second.text)}</text>`)
  }
  // 編號 · 英文名
  const sub = [route.number && `#${route.number}`, route.name.en && plainName(route.name.en)].filter(Boolean).join(' · ')
  if (sub) {
    const en = fit(sub, 28, 22, textW)
    y += 50
    body.push(`<text x="${left}" y="${y}" font-size="${en.size}" font-weight="500" fill="${C.muted}">${rich(en.text)}</text>`)
  }

  // 難度膠囊＋種類、高度（文字，用 · 分開）
  y += 48
  const pillSize = 38
  let x = left
  if (route.grade) {
    const g = pill(x, y, route.grade.replace(/\s.*$/, ''), { size: pillSize, bg: C.band[gradeBand(route.gradeValue) ?? 'easy'], fg: C.text, bold: true })
    body.push(g.svg)
    x += g.w + 22
  }
  const facts = [
    route.type && (quickdraws(route) ? `${quickdraws(route)}快扣 ${TYPE_ZH[route.type]}` : TYPE_ZH[route.type]),
    route.heightM && `${route.heightM} m`,
  ].filter(Boolean) as string[]
  if (facts.length) body.push(`<text x="${x}" y="${mid(y + pillSize * 0.8, 28)}" font-size="28" font-weight="700" fill="${C.text}">${rich(facts.join('  ·  '))}</text>`)

  // 黃燈、紅燈：與路線頁相同的色塊（綠燈不顯示；日期太細，不放）
  const closed = route.status === 'closed' || route.status === 'to-remove'
  const level = closed || route.safety === 'red' ? 'danger' : route.safety === 'yellow' ? 'warn' : undefined
  if (level) {
    const c = C[level]
    const label = [level === 'danger' ? '危險' : '小心', closed && route.statusLabel].filter(Boolean).join(' · ')
    const by = y + pillSize * 1.6 + 30
    const bw = textWidth(label, 26) + 96
    body.push(`<rect x="${left}" y="${by}" width="${bw}" height="56" rx="16" fill="${c.bg}"/>`)
    body.push(`<circle cx="${left + 32}" cy="${by + 28}" r="15" fill="${c.color}"/>`)
    body.push(`<text x="${left + 32}" y="${mid(by + 29, 22)}" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">!</text>`)
    body.push(`<text x="${left + 60}" y="${mid(by + 29, 26)}" font-size="26" font-weight="700" fill="${c.fg}">${rich(label)}</text>`)
  }

  const bottom = level ? y + pillSize * 1.6 + 30 + 56 : y + pillSize * 1.6
  return frame(areaMap(map, areaKey, areaColors, PANEL), body, bottom)
}

const TEXT_W = 720 - MARK.x

/** 最上面一行：色點＋地點（岩場／區域／分區），文字中線在 y=0 */
function placeLine(text: string, color: string): string {
  const left = MARK.x
  const place = fit(text, 26, 22, TEXT_W - 30)
  return (
    `<circle cx="${left + 8}" cy="0" r="8" fill="${color}"/>` +
    `<text x="${left + 28}" y="${mid(0, place.size)}" font-size="${place.size}" font-weight="700" fill="${C.muted}">${rich(place.text)}</text>`
  )
}

/**
 * 整張圖：背景、右邊的圓角框（right）、左邊的內容（body，從 y=0 排到 bottom）、左下角的標誌。
 * 左邊的內容在 40～（左下角標誌上方 28）之間垂直置中；上緣是地點那行的 -20。
 * 左下角：TOCC 的臺灣島（drawToccMark 另外畫）＋LongDong，字後面一顆小岩點當簽名（Climbio 的岩點）。
 */
function frame(right: string, body: string[], bottom: number): string {
  const { w, h } = OG_SIZE
  const left = MARK.x
  const top = -20
  const space = MARK.y - 28 - 40
  const dy = 40 - top + Math.max(0, (space - (bottom - top)) / 2)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${ogFonts().latin}">` +
    `<rect width="${w}" height="${h}" fill="${C.paper}"/>${right}` +
    `<g transform="translate(0 ${dy.toFixed(0)})">${body.join('')}</g>` +
    `<text x="${left + 46}" y="${MARK.y + MARK.h - 12}" font-size="28" font-weight="700" fill="${C.text}">LongDong</text>` +
    holdMark(left + 46 + textWidth('LongDong', 28) * 1.25 + 16, MARK.y + MARK.h - 30, 0.22, C.brand, C.paper) +
    '</svg>'
  )
}

/** 頁面的分享圖片（地圖、路線清單）：地點那行、標題、說明，回傳下一段的 y */
function pageTitle(body: string[], title: string, description: string): number {
  body.push(placeLine('龍洞', C.brand))
  body.push(`<text x="${MARK.x}" y="94" font-size="64" font-weight="700" fill="${C.text}">${rich(title)}</text>`)
  body.push(`<text x="${MARK.x}" y="144" font-size="28" font-weight="500" fill="${C.muted}">${rich(description)}</text>`)
  return 144 + 44
}

/** 地圖頁（/map）的分享圖片：右邊是整個龍洞與各大區域 */
export function mapPageSvg(map: OgMap, areaColors: Record<string, string>, stats: { areas: number; routes: number }): string {
  const body: string[] = []
  const y = pageTitle(body, '龍洞地圖', `${stats.areas} 個區域 · ${stats.routes} 條路線`)
  body.push(`<text x="${MARK.x}" y="${mid(y + 24, 28)}" font-size="28" font-weight="700" fill="${C.text}">${rich('救援點 · 急救器材 · 離線可用')}</text>`)
  return frame(areaMap(map, undefined, areaColors, PANEL, 0.9, 1.06), body, y + 48)
}

/** 完攀方式的縮寫與顏色（與網站的 --style-os 等相同） */
const STYLES = {
  onsight: { abbr: 'OS', name: 'Onsight', color: '#1f7a45' },
  redpoint: { abbr: 'RP', name: 'Redpoint', color: '#c62828' },
  toprope: { abbr: 'TR', name: 'Top-rope', color: '#1565c0' },
}

/**
 * 路線清單頁（/checklist）的分享圖片：左邊是 OS／RP／TR 的圖例，
 * 右邊是清單的樣子（一個分區的前幾條路線，一條一行：編號、名稱、難度、OS RP TR；完攀方式是示範的）。
 */
export function checklistPageSvg(area: Area, sector: Sector): string {
  const body: string[] = []
  const y = pageTitle(body, '路線清單', '每條路線的最佳攀登與評分')
  let x = MARK.x
  for (const style of Object.values(STYLES)) {
    const p = pill(x, y, style.abbr, { size: 22, bg: style.color, fg: '#fff', bold: true })
    body.push(p.svg, `<text x="${x + p.w + 8}" y="${mid(y + 22 * 0.8, 24)}" font-size="24" font-weight="500" fill="${C.text}">${style.name}</text>`)
    x += p.w + 8 + textWidth(style.name, 24) + 26
  }

  // 右邊：白色圓角框裡的清單
  const demo = ['onsight', 'redpoint', 'redpoint', 'toprope', undefined, 'onsight'] as const
  const routes = sector.routes.filter((r) => !r.isFixture && r.grade).slice(0, demo.length)
  const { x: px, y: py, w: pw, h: ph, r } = PANEL
  const head = 96
  const rowH = (ph - head - 16) / routes.length
  const rows = routes.map((route, i) => {
    const ry = py + head + i * rowH
    const cy = ry + rowH / 2
    const grade = route.grade!.replace(/\s.*$/, '')
    // OS RP TR 連成一組（與手機版的路線清單相同），選到的填色
    const cell = 34
    const sx = px + pw - 20 - cell * 3
    const segment =
      `<rect x="${sx}" y="${cy - 16}" width="${cell * 3}" height="32" rx="9" fill="#ffffff" stroke="${C.line}" stroke-width="1.5"/>` +
      Object.entries(STYLES)
        .map(([key, style], j) => {
          const cx = sx + cell * j
          const on = demo[i] === key
          return (
            (on ? `<rect x="${cx}" y="${cy - 16}" width="${cell}" height="32" rx="${j === 1 ? 0 : 9}" fill="${style.color}"/>` : '') +
            (j ? `<line x1="${cx}" y1="${cy - 16}" x2="${cx}" y2="${cy + 16}" stroke="${C.line}" stroke-width="1.5"/>` : '') +
            `<text x="${cx + cell / 2}" y="${mid(cy, 13)}" font-size="13" font-weight="700" fill="${on ? '#ffffff' : C.muted}" text-anchor="middle">${style.abbr}</text>`
          )
        })
        .join('')
    const gw = textWidth(grade, 18) + 18
    const gx = sx - 10 - gw
    return (
      `<line x1="${px + 20}" y1="${ry}" x2="${px + pw - 20}" y2="${ry}" stroke="${C.line}" stroke-width="2"/>` +
      `<text x="${px + 20}" y="${mid(cy, 16)}" font-size="16" font-weight="500" fill="${C.muted}">${rich(`#${route.number ?? ''}`)}</text>` +
      `<text x="${px + 72}" y="${mid(cy, 22)}" font-size="22" font-weight="700" fill="${C.text}">${rich(fit(plainName(route.name.zh), 22, 16, gx - px - 92).text)}</text>` +
      pill(gx, cy - 14, grade, { size: 18, bg: C.band[gradeBand(route.gradeValue) ?? 'easy'], fg: C.text, bold: true }).svg +
      segment
    )
  })
  const done = demo.slice(0, routes.length).filter(Boolean).length
  const right =
    `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${r}" fill="#ffffff"/>` +
    `<text x="${px + 20}" y="${py + 58}" font-size="26" font-weight="700" fill="${C.text}">${rich(`${area.name.zh} · ${sector.name.zh}`)}</text>` +
    `<text x="${px + pw - 20}" y="${py + 58}" font-size="20" font-weight="500" fill="${C.muted}" text-anchor="end">${rich(`${done} / ${routes.length}`)}</text>` +
    rows.join('')
  return frame(right, body, y + 22 * 1.6)
}
