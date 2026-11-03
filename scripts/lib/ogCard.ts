/**
 * 路線、分區、區域的分享卡片（1200×1200）：和 App 的路線卡片同一個樣子——
 * 深色卡片、上方是區域色的漸層、右上角是區域的形狀、左邊一條區域色；
 * 下半部是 Topo（灰階，路線周圍原色，路線是唯一的主角；分區是整張照片與所有路線），沒有 Topo 時是深色的地圖。
 * 底色、形狀、照片、線用 canvas 畫，文字用 SVG（與 ogImage.ts 相同的字型處理）疊在上面，最後是左下角的標誌。
 */
import { type Image, type SKRSContext2D, createCanvas, loadImage, Path2D } from '@napi-rs/canvas'
import type { Area, Route, Sector } from '../../src/data/schema'
import { quickdraws } from '../../src/format'
import { DB_URL } from '../../src/social/model'
import { readTopo, renderLines, smoothPath } from '../../vendor/climbio-topokit/index.js'
import { fillShared } from '../../src/topo/shared'
import { routeInfo } from '../../src/topo/routeInfo'
import { topoData } from '../../src/topo/topoData'
import { decodeEdit, imageUrl, type StoredEdit, type TopoPhoto } from '../../src/topo/model'
import { FULL_CROP, SCALE, type Crop, type Marks } from '../../src/core/topo/geometry'
import { routeCrop, widenCrop } from '../../src/core/topo/viewport'
import { areaMap, D, drawToccMark, fit, holdMark, loadToccImage, MARK, OG_SIZE, ogFonts, plainName, rich, splitLine, textWidth, TYPE_ZH, ZOOM, type Box, type OgMap } from './ogImage'

/** 與 App 深色版相同 */
const DARK = { surface: '#1a1a1a', text: '#f2f2f2', muted: '#a8a49c', brand: '#0395c3' }
/** 深色的地圖（沒有 Topo 時）：海、陸地 */
const MAP = { sea: '#141819', land: '#2a2a2a', areaLine: '#555555', brand: DARK.brand }
/** 線、編號牌的顏色：運攀藍色，其他紅色（與 App 相同；主角用亮一點的）；bolt 的牌子是藍色 */
const LINE = { sport: ['#1565c0', '#1e7bff'], other: ['#c8102e', '#e11d2e'] }
/** 標記（TopoKit 的 renderLines）的大小：一個「螢幕像素」是幾個卡片像素（App 的路線卡片在手機上 375 寬，卡片是 840 寬的設計） */
const MARK_UI = 2.6

/** renderLines 畫出來的 SVG 用的樣式（TopoKit 的 style.js 用 CSS 變數，這裡的轉成 SVG 渲染器看得懂的顏色） */
const markCss = () =>
  [
    '.topo-route path { fill: none; stroke-linecap: round; stroke-linejoin: round }',
    '.topo-hit { stroke: transparent }',
    '.topo-route.dim { opacity: 0.45 }',
    '.topo-badge text, .topo-bolt text { fill: #fff; font-weight: 700 }',
    '.topo-bolt rect { fill: #1ea0e6; fill-opacity: 0.6; stroke: none }',
    '.topo-bolt text.topo-note { font-weight: 500 }',
    '.topo-note { fill: #fff; stroke: none }',
    '.topo-note-halo { fill: none; stroke: rgba(0, 0, 0, 0.7); stroke-linejoin: round }',
    '.topo-badge rect { stroke: none }',
    ...(['sport', 'other'] as const).flatMap((kind) =>
      [false, true].map((on) => {
        const c = LINE[kind][on ? 1 : 0]
        const sel = `.topo-route.kind-${kind}${on ? '.on' : ':not(.on)'}`
        return `${sel} .topo-line { stroke: ${c} } ${sel} .topo-dot { fill: ${c}; stroke: none } ${sel} .topo-badge rect, ${sel} .topo-bolt.anchor rect { fill: ${c} }`
      }),
    ),
  ].join(' ')

const BAR = 10
const LEFT = 56
/** 上半部的文字之下是 Topo（或地圖），一直到底，下緣淡出、標誌疊在上面 */
const LOWER_TOP = 300

/** 一張 Topo：照片、最新版本的標記與裁切、解碼好的圖片 */
export interface OgTopo {
  photo: TopoPhoto
  marks: Marks
  crop?: Crop
  image: Image
}

/**
 * 讀所有 Topo（Realtime Database 的 REST API，沒登入也能讀）與照片；每張照片用最新的版本。
 * 讀不到（沒有網路）時回傳空的，分享卡片改用地圖。
 */
export async function loadOgTopos(): Promise<OgTopo[]> {
  const json = async <T>(path: string) => {
    const res = await fetch(`${DB_URL}/${path}.json`)
    if (!res.ok) throw new Error(`${path}：HTTP ${res.status}`)
    return (await res.json()) as T | null
  }
  const [photos, edits] = await Promise.all([json<Record<string, Omit<TopoPhoto, 'id'>>>('v2/topos'), json<Record<string, Record<string, StoredEdit>>>('v2/topoEdits')])
  const out: OgTopo[] = []
  for (const [id, p] of Object.entries(photos ?? {})) {
    const versions = Object.entries(edits?.[id] ?? {})
    if (versions.length === 0) continue
    const [editId, latest] = versions.reduce((a, b) => (b[1].createdAt > a[1].createdAt ? b : a))
    const edit = decodeEdit(editId, latest)
    const res = await fetch(imageUrl(p.image))
    if (!res.ok) throw new Error(`照片 ${p.image}：HTTP ${res.status}`)
    out.push({ photo: { id, ...p }, marks: edit.marks, crop: edit.crop, image: await loadImage(Buffer.from(await res.arrayBuffer())) })
  }
  return out
}

/** 這條路線用哪一張 Topo：有畫線的優先 */
export function topoForRoute(topos: OgTopo[], route: Route): OgTopo | undefined {
  return topos.find((t) => t.marks[route.id]?.line?.length) ?? topos.find((t) => t.marks[route.id])
}

/** 這個分區用哪一張 Topo：標了最多路線的那張 */
export function topoForSector(topos: OgTopo[], sector: Sector): OgTopo | undefined {
  const ids = new Set(sector.routes.map((r) => r.id))
  const count = (t: OgTopo) => Object.keys(t.marks).filter((id) => ids.has(id)).length
  return topos.filter((t) => count(t) > 0).sort((a, b) => count(b) - count(a))[0]
}

/** 一條路線的分享卡片 */
export async function routeCardPng(route: Route, area: Area, sector: Sector, map: OgMap, crag: { zh: string }, areaColors: Record<string, string>, topo?: OgTopo): Promise<Buffer> {
  const texts: string[] = []
  let y = title(texts, `${crag.zh} › ${area.name.zh} › ${sector.name.zh}`, plainName(route.name.zh), area.color)
  const sub = [route.number && `#${route.number}`, route.name.en && plainName(route.name.en)].filter(Boolean).join(' · ')
  if (sub) {
    y += 50
    const en = fit(sub, 28, 22, D.w - LEFT * 2)
    texts.push(`<text x="${LEFT}" y="${y}" font-size="${en.size}" font-weight="500" fill="${DARK.muted}">${rich(en.text)}</text>`)
  }
  const facts = [route.grade?.replace(/\s.*$/, ''), route.type && (quickdraws(route) ? `${quickdraws(route)}快扣` : ''), route.type && TYPE_ZH[route.type], route.heightM && `${route.heightM} m`].filter(Boolean) as string[]
  y += 60
  if (facts.length) texts.push(`<text x="${LEFT}" y="${y}" font-size="38" font-weight="700" fill="${DARK.text}">${rich(facts.join('   '))}</text>`)
  // 黃燈、紅燈：一行提醒（與路線頁相同的顏色）
  const closed = route.status === 'closed' || route.status === 'to-remove'
  const level = closed || route.safety === 'red' ? 'danger' : route.safety === 'yellow' ? 'warn' : undefined
  if (level) {
    y += 52
    const label = [level === 'danger' ? '⚠ 危險' : '⚠ 小心', closed && route.statusLabel].filter(Boolean).join(' · ')
    texts.push(`<text x="${LEFT}" y="${y}" font-size="28" font-weight="700" fill="${level === 'danger' ? '#ff6b7f' : '#ffc94d'}">${rich(label)}</text>`)
  }
  const lower = Math.max(LOWER_TOP, y + 30)
  return card(area, map, texts, lower, !!topo, (ctx, box) =>
    topo ? drawTopo(ctx, box, topo, sector, area.color, route.id) : drawMap(ctx, box, map, area, areaColors),
  )
}

/** 一個分區的分享卡片：整張 Topo 與所有路線（沒有 Topo 時是地圖） */
export async function sectorCardPng(area: Area, sector: Sector, map: OgMap, crag: { zh: string }, areaColors: Record<string, string>, topo?: OgTopo): Promise<Buffer> {
  const texts: string[] = []
  let y = title(texts, `${crag.zh} › ${area.name.zh}`, plainName(sector.name.zh), area.color)
  y += 56
  texts.push(`<text x="${LEFT}" y="${y}" font-size="30" font-weight="500" fill="${DARK.muted}">${rich(`${sector.routes.filter((r) => !r.isFixture).length} 條路線`)}</text>`)
  return card(area, map, texts, Math.max(LOWER_TOP - 40, y + 30), !!topo, (ctx, box) =>
    topo ? drawTopo(ctx, box, topo, sector, area.color) : drawMap(ctx, box, map, area, areaColors),
  )
}

/** 一個區域的分享卡片：只有一個分區、有 Topo 時同分區；其他是放大的地圖 */
export async function areaCardPng(area: Area, map: OgMap, crag: { zh: string }, areaColors: Record<string, string>, topo?: OgTopo): Promise<Buffer> {
  const texts: string[] = []
  let y = title(texts, crag.zh, plainName(area.name.zh), area.color)
  y += 56
  const routes = area.sectors.flatMap((s) => s.routes).filter((r) => !r.isFixture).length
  const facts = [area.sectors.length > 1 && `${area.sectors.length} 個分區`, `${routes} 條路線`].filter(Boolean).join(' · ')
  texts.push(`<text x="${LEFT}" y="${y}" font-size="30" font-weight="500" fill="${DARK.muted}">${rich(facts)}</text>`)
  const single = area.sectors.length === 1 ? area.sectors[0] : undefined
  return card(area, map, texts, Math.max(LOWER_TOP - 40, y + 30), !!(topo && single), (ctx, box) =>
    topo && single ? drawTopo(ctx, box, topo, single, area.color) : drawMap(ctx, box, map, area, areaColors),
  )
}

/** 最上面兩行：地點（區域色）、名稱（太長分兩行），回傳名稱最後一行的基線 */
function title(texts: string[], place: string, name: string, color = DARK.brand): number {
  const p = fit(place, 28, 22, D.w - LEFT * 2)
  texts.push(`<text x="${LEFT}" y="76" font-size="${p.size}" font-weight="700" fill="${color}">${rich(p.text)}</text>`)
  const single = fit(name, 76, 56, D.w - LEFT * 2)
  if (!single.text.endsWith('…')) {
    texts.push(`<text x="${LEFT}" y="158" font-size="${single.size}" font-weight="700" fill="${DARK.text}">${rich(single.text)}</text>`)
    return 158
  }
  const [first, rest] = splitLine(name, 52, D.w - LEFT * 2)
  const second = fit(rest, 52, 40, D.w - LEFT * 2)
  texts.push(`<text x="${LEFT}" y="140" font-size="52" font-weight="700" fill="${DARK.text}">${rich(first)}</text>`)
  texts.push(`<text x="${LEFT}" y="200" font-size="${second.size}" font-weight="700" fill="${DARK.text}">${rich(second.text)}</text>`)
  return 200
}

/** 整張卡片：底色與漸層、右上角的區域形狀（shape：下半部是 Topo 時；是地圖時不重複）、下半部（lower 以下，由 drawLower 畫）、文字、左邊的色條、左下角的標誌 */
async function card(area: Area, map: OgMap, texts: string[], lower: number, shape: boolean, drawLower: (ctx: SKRSContext2D, box: Box) => Promise<void>): Promise<Buffer> {
  const tocc = await (toccImage ??= loadToccImage())
  const color = area.color ?? DARK.brand
  const canvas = createCanvas(OG_SIZE.w, OG_SIZE.h)
  const ctx = canvas.getContext('2d')
  ctx.scale(ZOOM, ZOOM)
  // 底色：區域色從上方漸漸淡成卡片底色（同 App 的 .route-m）
  ctx.fillStyle = DARK.surface
  ctx.fillRect(0, 0, D.w, D.h)
  const glow = ctx.createLinearGradient(0, 0, 0, 340)
  glow.addColorStop(0, mix(color, DARK.surface, 0.14))
  glow.addColorStop(0.45, mix(color, DARK.surface, 0.14))
  glow.addColorStop(1, DARK.surface)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, D.w, 340)
  if (shape) drawShape(ctx, map, area, color)
  await drawLower(ctx, { x: BAR, y: lower, w: D.w - BAR, h: D.h - lower, r: 0 })
  // 文字（SVG）
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${D.w}" height="${D.h}" viewBox="0 0 ${D.w} ${D.h}" font-family="${ogFonts().latin}">` +
    texts.join('') +
    `<text x="${MARK.x + 46}" y="${MARK.y + MARK.h - 12}" font-size="28" font-weight="700" fill="${DARK.text}">LongDong</text>` +
    holdMark(MARK.x + 46 + textWidth('LongDong', 28) * 1.25 + 16, MARK.y + MARK.h - 30, 0.22, DARK.brand, DARK.surface) +
    '</svg>'
  ctx.drawImage(await loadImage(Buffer.from(svg)), 0, 0, D.w, D.h)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, BAR, D.h)
  drawToccMark(ctx, tocc, MARK)
  return canvas.toBuffer('image/png')
}
let toccImage: Promise<Image> | undefined

/** 右上角的區域形狀（同 App 標題卡的地圖）：區域色混深色底，左邊、下緣淡出 */
function drawShape(ctx: SKRSContext2D, map: OgMap, area: Area, color: string) {
  const rings = map.areas[area.id.split('/').pop()!]
  if (!rings) return
  const box = { x: D.w * 0.52, y: 0, w: D.w * 0.48, h: 300 }
  const layer = createCanvas(Math.round(box.w * ZOOM), Math.round(box.h * ZOOM))
  const g = layer.getContext('2d')
  g.scale(ZOOM, ZOOM)
  const pts = rings.flat()
  const lat0 = pts.reduce((n, p) => n + p[1], 0) / pts.length
  const kx = Math.cos((lat0 * Math.PI) / 180)
  const xs = pts.map((p) => p[0] * kx)
  const ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  // 形狀比框大一點，超出右邊、上緣（像 App 那樣只露出一部分）
  const scale = Math.max(box.w / (x1 - x0), box.h / (y1 - y0)) * 1.05
  const ox = box.w * 0.62 - ((x0 + x1) / 2) * scale
  const oy = box.h * 0.5 + ((y0 + y1) / 2) * scale
  g.beginPath()
  for (const ring of rings) ring.forEach(([lng, lat], i) => (i ? g.lineTo(lng * kx * scale + ox, oy - lat * scale) : g.moveTo(lng * kx * scale + ox, oy - lat * scale)))
  g.fillStyle = mix(color, DARK.surface, 0.45)
  g.fill('evenodd')
  fade(g, { x: 0, y: 0, w: box.w, h: box.h }, { left: 0.3, bottom: 0.6 })
  ctx.drawImage(layer, box.x, box.y, box.w, box.h)
}

/** 下半部沒有 Topo：深色的地圖（所在區域實色，附近的區域淡淡的），上緣淡入卡片 */
async function drawMap(ctx: SKRSContext2D, box: Box, map: OgMap, area: Area, areaColors: Record<string, string>) {
  const inner = { x: 0, y: 0, w: box.w, h: box.h, r: 0 }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(box.w * ZOOM)}" height="${Math.round(box.h * ZOOM)}" viewBox="0 0 ${box.w} ${box.h}">${areaMap(map, area.id.split('/').pop(), areaColors, inner, 0.3, 1.5, false, MAP)}</svg>`
  const layer = createCanvas(Math.round(box.w * ZOOM), Math.round(box.h * ZOOM))
  const g = layer.getContext('2d')
  g.drawImage(await loadImage(Buffer.from(svg)), 0, 0)
  g.scale(ZOOM, ZOOM)
  fade(g, { x: 0, y: 0, w: box.w, h: box.h }, { top: 0.25, left: 0.04, right: 0.04 })
  ctx.drawImage(layer, box.x, box.y, box.w, box.h)
}

/**
 * 下半部的 Topo：照片灰階、路線周圍原色；裁切同路線卡片（routeCrop，再放寬到框的寬高比：widenCrop），線、起點、終點、編號同 App。
 * highlight：路線卡片的主角（其他路線淡淡的、小編號放在線的下段）；沒有時（分區）每條路線一樣。
 */
async function drawTopo(ctx: SKRSContext2D, box: Box, topo: OgTopo, sector: Sector, color = DARK.brand, highlight?: string) {
  const { photo, image } = topo
  const marks = fillShared(topo.marks, sector.routes)
  const base = topo.crop ?? FULL_CROP
  const crop = widenCrop(photo, highlight ? routeCrop(photo, base, marks[highlight]) : base, base, box.w / box.h)
  // 照片像素 → 框裡的座標（照片置中、放得下）
  const [cx, cy, cw, ch] = [(crop.x * photo.width) / SCALE, (crop.y * photo.height) / SCALE, (crop.w * photo.width) / SCALE, (crop.h * photo.height) / SCALE]
  const s = Math.min(box.w / cw, box.h / ch)
  const dx = (box.w - cw * s) / 2
  const dy = (box.h - ch * s) / 2
  const at = ([x, y]: [number, number]): [number, number] => [dx + ((x * photo.width) / SCALE - cx) * s, dy + ((y * photo.height) / SCALE - cy) * s]
  const k = image.width / photo.width
  const W = Math.round(box.w * ZOOM)
  const H = Math.round(box.h * ZOOM)
  const layer = createCanvas(W, H)
  const g = layer.getContext('2d')
  g.scale(ZOOM, ZOOM)
  const drawPhoto = (c: SKRSContext2D) => c.drawImage(image, cx * k, cy * k, cw * k, ch * k, dx, dy, cw * s, ch * s)
  g.filter = 'grayscale(1) contrast(0.8)'
  drawPhoto(g)
  g.filter = 'none'
  // 主角周圍疊回原色（同 App 的 reveal：幾層寬窄不同的半透明帶子）
  const own = highlight && marks[highlight]?.line
  if (own && own.length >= 2) {
    const reveal = createCanvas(W, H)
    const r = reveal.getContext('2d')
    r.scale(ZOOM, ZOOM)
    const path = new Path2D(smoothPath(own.map(at)))
    r.lineCap = 'round'
    r.lineJoin = 'round'
    r.strokeStyle = 'rgba(255,255,255,0.5)'
    for (const f of [1, 0.7, 0.45]) {
      r.lineWidth = 0.14 * cw * s * f
      r.stroke(path)
    }
    r.globalCompositeOperation = 'source-in'
    drawPhoto(r)
    g.drawImage(reveal, 0, 0, box.w, box.h)
  }
  // 照片在框裡的範圍（照片比框窄時兩邊是卡片底色）：邊緣一圈淡淡的區域色、各邊淡出都照這個範圍
  const shown = { x: dx, y: dy, w: cw * s, h: ch * s }
  for (const [x0, x1] of [
    [shown.x, shown.x + 30],
    [shown.x + shown.w, shown.x + shown.w - 30],
  ]) {
    const edge = g.createLinearGradient(x0, 0, x1, 0)
    edge.addColorStop(0, withAlpha(color, 0.25))
    edge.addColorStop(1, withAlpha(color, 0))
    g.fillStyle = edge
    g.fillRect(Math.min(x0, x1), shown.y, 30, shown.h)
  }
  const labels = new Map(sector.routes.filter((r) => r.number).map((r) => [r.id, r.number!]))
  const { routes } = readTopo(topoData({ image: '', width: photo.width, height: photo.height }, '', marks, undefined, labels, routeInfo(sector.routes, (r) => plainName(r.name.zh))), { lang: 'zh-Hant' })
  // SVG 渲染器不支援 paint-order：說明文字的深色描邊另外先畫一份（在白字下面）
  // 中文與英數各自指定字型（同 ogImage 的 rich）
  const unescape = (t: string) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const fonted = (svg: string) => svg.replace(/(<tspan x="[^"]*" y="[^"]*"[^>]*>)([^<]+)(<\/tspan>)/g, (_, a: string, t: string, z: string) => a + rich(unescape(t)) + z)
  const halo = (svg: string) => svg.replace(/<text class="topo-note"[^>]*>[\s\S]*?<\/text>/g, (t) => t.replace('class="topo-note"', 'class="topo-note-halo"') + t)
  // 左下角的標誌那一塊不放編號（照片像素）
  const logo = { x: cx + (MARK.x - box.x - 10 - dx) / s, y: cy + (MARK.y - box.y - 10 - dy) / s, w: 330 / s, h: (MARK.h + 20) / s }
  const markup = halo(fonted(renderLines(routes, { photo: { w: photo.width, h: photo.height }, crop: { x: cx, y: cy, w: cw, h: ch }, k: (highlight ? MARK_UI : MARK_UI * 0.88) / s, highlight, solo: !!highlight, bolts: [], interactive: false, reserved: [logo] })))
  const fonts = ogFonts()
  const marksSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${cx - dx / s} ${cy - dy / s} ${box.w / s} ${box.h / s}" font-family="${fonts.latin}, ${fonts.cjk}">` +
    `<style>${markCss()}</style>${markup}</svg>`
  g.drawImage(await loadImage(Buffer.from(marksSvg)), 0, 0, box.w, box.h)
  fade(g, shown, { top: 0.22, bottom: 0.2, left: 0.06, right: 0.06 })
  ctx.drawImage(layer, box.x, box.y, box.w, box.h)
}

/** 圖層裡 r 這一塊的邊緣淡出（各邊淡出的範圍，佔寬或高的比例） */
function fade(g: SKRSContext2D, r: { x: number; y: number; w: number; h: number }, edges: { top?: number; bottom?: number; left?: number; right?: number }) {
  g.globalCompositeOperation = 'destination-in'
  const v = g.createLinearGradient(0, r.y, 0, r.y + r.h)
  v.addColorStop(0, `rgba(0,0,0,${edges.top ? 0 : 1})`)
  v.addColorStop(edges.top ?? 0, 'rgba(0,0,0,1)')
  v.addColorStop(1 - (edges.bottom ?? 0), 'rgba(0,0,0,1)')
  v.addColorStop(1, `rgba(0,0,0,${edges.bottom ? 0 : 1})`)
  g.fillStyle = v
  g.fillRect(r.x, r.y, r.w, r.h)
  const hz = g.createLinearGradient(r.x, 0, r.x + r.w, 0)
  hz.addColorStop(0, `rgba(0,0,0,${edges.left ? 0 : 1})`)
  hz.addColorStop(edges.left ?? 0, 'rgba(0,0,0,1)')
  hz.addColorStop(1 - (edges.right ?? 0), 'rgba(0,0,0,1)')
  hz.addColorStop(1, `rgba(0,0,0,${edges.right ? 0 : 1})`)
  g.fillStyle = hz
  g.fillRect(r.x, r.y, r.w, r.h)
  g.globalCompositeOperation = 'source-over'
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** 兩個顏色混合（同 CSS 的 color-mix：a 佔 t） */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return `rgb(${x.map((v, i) => Math.round(v * t + y[i] * (1 - t))).join(',')})`
}
const withAlpha = (hex: string, a: number) => `rgba(${rgb(hex).join(',')},${a})`
