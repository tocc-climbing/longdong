/**
 * Topo 的視覺基準：同一組場景（共用線段、分岔、標籤避讓、裁切、手機縮放、電腦版）用實際的瀏覽器截圖（標記由 TopoKit 的 renderLines 畫），
 * 與 tests/fixtures/topo-shots/ 的基準圖逐像素比對。
 *   npm run test:topo-shots            比對，超出容許值就失敗（差異圖寫到 shots/topo-diff/）
 *   npm run test:topo-shots -- --update 重新產生基準（改了呈現、確認新圖正確才做）
 * 每個場景同時輸出 <名稱>.scene.json（照片尺寸、像素座標的路線、檢視參數），climbio 的 TopoKit 用同一份場景比對外觀與排版。
 * 基準圖由 TopoKit 畫（App 的樣式加上 TopoKit 的樣式，跟 App 一樣），龍洞的選項見 src/topo/look.ts。
 * 照片用程式產生的格線，不依賴任何圖檔；文字用系統字型，所以只在同一台機器上比對（不進 CI 的 npm test）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Crop, Marks } from '../src/core/topo/geometry'
import type { RouteInfo } from '../src/topo/routeInfo'
import { topoData } from '../src/topo/topoData'
import { routeCrop } from '../src/core/topo/viewport'
import { readTopo, renderLines } from '../vendor/climbio-topokit/index.js'
import { CSS as KIT_CSS } from '../vendor/climbio-topokit/index.js'
import { TOPO_LOOK } from '../src/topo/look'
import { diff, launch, TOLERANCE } from './lib/shotDiff'

interface Photo {
  width: number
  height: number
}
interface Scene {
  name: string
  photo: Photo
  marks: Marks
  /** 路線 id → 編號、種類、難度、名稱、bolt 材質 */
  routes: { id: string; label: string; kind: 'sport' | 'other'; grade?: string; name?: string; bolts?: Record<string, string> }[]
  crop?: Crop
  /** 畫面上顯示裁切範圍的寬度（CSS 像素） */
  width: number
  /** 放大倍率，focus 是放大時置中的路線 */
  zoom?: number
  focus?: string
  highlight?: string
  bolts?: boolean
  editing?: boolean
  solo?: boolean
  /** 電腦版（寬螢幕）：牌子與字放大 1.5 倍 */
  desktop?: boolean
}

const update = process.argv.includes('--update')
const dir = new URL('../tests/fixtures/topo-shots/', import.meta.url)
const diffDir = new URL('../shots/topo-diff/', import.meta.url)

const gate = JSON.parse(readFileSync(new URL('../tests/fixtures/topo-school-gate.json', import.meta.url), 'utf8')) as {
  photo: Photo
  crop: Crop
  marks: Marks
  routes: { id: string; number: string; grade: string; name: string; type: string }[]
}
const gateRoutes: Scene['routes'] = gate.routes.map((r) => ({
  id: r.id,
  label: r.number,
  kind: r.type === 'sport' ? 'sport' : 'other',
  grade: r.grade,
  name: r.name,
  bolts: Object.fromEntries(Object.keys(gate.marks[r.id]?.bolts ?? {}).map((p) => [p, '316-TW'])),
}))
const gateBase = { photo: gate.photo, marks: gate.marks, routes: gateRoutes }
const focusId = gate.routes.find((r) => r.number === '566')!.id

// 分岔：b 複製 a 的前兩點再往右；c 在旁邊，標籤擠在一起
const forkMarks: Marks = {
  a: { line: [[3000, 9000], [3100, 6500], [3000, 4000], [3050, 1500]], bolts: { B01: [3080, 7500], B02: [3050, 5200], A01: [3050, 1700] } },
  b: { line: [[3000, 9000], [3100, 6500], [4200, 4500], [4600, 1200]] },
  c: { line: [[5200, 9000], [5300, 5000], [5200, 1500]], bolts: { B01: [5280, 6000] } },
}
const forkRoutes: Scene['routes'] = [
  { id: 'a', label: '1', kind: 'sport', grade: '5.10a', name: '主線', bolts: { B01: '316-TW', B02: '316-TW', A01: 'Ti-U' } },
  { id: 'b', label: '2', kind: 'sport', grade: '5.10c', name: '右岔' },
  { id: 'c', label: '3', kind: 'other', grade: '5.9', name: '旁邊的傳統線', bolts: { B01: 'Ti' } },
]
// 標籤避讓：五條緊鄰的短線
const crowdMarks: Marks = Object.fromEntries(
  [0, 1, 2, 3, 4].map((i) => [`r${i}`, { line: [[2000 + i * 450, 8000 - i * 300], [2100 + i * 450, 5000], [2000 + i * 450, 2500 + i * 200]] }]),
)
const crowdRoutes: Scene['routes'] = [0, 1, 2, 3, 4].map((i) => ({ id: `r${i}`, label: String(10 + i), kind: i % 2 ? 'other' : 'sport', grade: `5.1${i}a`, name: `擁擠的路線 ${i}` }))

const scenes: Scene[] = [
  { name: 'fork-shared', photo: { width: 2000, height: 1500 }, marks: forkMarks, routes: forkRoutes, width: 375, bolts: true },
  { name: 'fork-shared-edit', photo: { width: 2000, height: 1500 }, marks: forkMarks, routes: forkRoutes, width: 375, editing: true, highlight: 'b' },
  { name: 'crowd-labels', photo: { width: 2000, height: 1500 }, marks: crowdMarks, routes: crowdRoutes, width: 340 },
  { name: 'crowd-labels-zoom3', photo: { width: 2000, height: 1500 }, marks: crowdMarks, routes: crowdRoutes, width: 340, zoom: 3, focus: 'r2' },
  { name: 'gate-crop-340', ...gateBase, crop: gate.crop, width: 340 },
  { name: 'gate-crop-375-bolts', ...gateBase, crop: gate.crop, width: 375, bolts: true },
  { name: 'gate-nocrop-375', ...gateBase, width: 375 },
  { name: 'gate-zoom2-375', ...gateBase, crop: gate.crop, width: 375, zoom: 2, focus: focusId },
  { name: 'gate-zoom3-375-bolts', ...gateBase, crop: gate.crop, width: 375, zoom: 3, focus: focusId, bolts: true },
  { name: 'gate-solo-card', ...gateBase, crop: routeCrop({ width: gate.photo.width, height: gate.photo.height }, gate.crop, gate.marks[focusId]), width: 340, highlight: focusId, solo: true, bolts: true },
  { name: 'gate-edit-375', ...gateBase, crop: gate.crop, width: 375, editing: true, highlight: focusId },
  { name: 'gate-desktop-900', ...gateBase, crop: gate.crop, width: 900, desktop: true },
]

/** 程式產生的照片：漸層加格線，座標位置一眼看得出來 */
function photoUri({ width, height }: Photo): string {
  const lines = []
  for (let x = 0; x <= width; x += width / 10) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`)
  for (let y = 0; y <= height; y += height / 10) lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8d8f86"/><stop offset="1" stop-color="#4f5a4a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><g stroke="#ffffff" stroke-opacity="0.18" stroke-width="${width / 400}">${lines.join('')}</g></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const SCALE = 10000
// 跟 App 一樣：App 的樣式加上 TopoKit 掛載時放進頁面的樣式（後放的優先）
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8') + KIT_CSS

/** 同 TopoFrame 的 DOM：照片＋SVG，k 是一個螢幕像素等於幾個照片像素 */
function sceneHtml(s: Scene): string {
  const c = s.crop ?? { x: 0, y: 0, w: SCALE, h: SCALE }
  const { width: pw, height: ph } = s.photo
  const [cx, cy, cw, ch] = [(c.x * pw) / SCALE, (c.y * ph) / SCALE, (c.w * pw) / SCALE, (c.h * ph) / SCALE]
  const zoom = s.zoom ?? 1
  const k = cw / (s.width * zoom)
  const labels = new Map(s.routes.map((r) => [r.id, r.label]))
  const info = new Map<string, RouteInfo>(s.routes.map((r) => [r.id, { kind: r.kind, grade: r.grade, name: r.name, bolts: r.bolts ?? {} }]))
  const { routes } = readTopo(topoData({ image: 'x', width: pw, height: ph }, 'x', s.marks, undefined, labels, info), { lang: 'zh-Hant' })
  const lines = renderLines(routes, { ...TOPO_LOOK, boltCodes: !!s.editing, photo: { w: pw, h: ph }, crop: { x: cx, y: cy, w: cw, h: ch }, k, ui: s.desktop ? 1.5 : 1, highlight: s.highlight, editing: s.editing, solo: s.solo, bolts: s.bolts ? true : undefined, interactive: false })
  const frameW = s.width * zoom
  const frameH = frameW * (ch / cw)
  // 放大時以 focus 路線的中心為舞台中心（不超出照片邊緣）
  let [ox, oy] = [0, 0]
  if (zoom > 1) {
    const pts = s.marks[s.focus!].line!
    const [mx, my] = [(pts.reduce((a, p) => a + p[0], 0) / pts.length / SCALE * pw - cx) / cw, (pts.reduce((a, p) => a + p[1], 0) / pts.length / SCALE * ph - cy) / ch]
    const stageH = s.width * (ch / cw)
    ox = Math.min(0, Math.max(s.width - frameW, s.width / 2 - mx * frameW))
    oy = Math.min(0, Math.max(stageH - frameH, stageH / 2 - my * frameH))
  }
  const stageH = s.width * (ch / cw)
  return `<div id="scene" class="tk" style="width:${s.width}px;height:${stageH}px;overflow:hidden;position:relative;background:#222">
<div class="topo-frame ready" style="position:absolute;left:${ox}px;top:${oy}px;width:${frameW}px;height:${frameH}px;border-radius:0">
<img src="${photoUri(s.photo)}" alt="" style="width:${(SCALE / c.w) * 100}%;height:${(SCALE / c.h) * 100}%;left:${(-c.x / c.w) * 100}%;top:${(-c.y / c.h) * 100}%">
<svg viewBox="${cx} ${cy} ${cw} ${ch}">${lines}</svg></div></div>`
}

function sceneJson(s: Scene) {
  const px = ([x, y]: [number, number]) => [(x * s.photo.width) / SCALE, (y * s.photo.height) / SCALE]
  const keys = Object.keys(s.marks)
  const order = (id: string) => (keys.includes(id) ? keys.indexOf(id) : keys.length)
  const c = s.crop
  return {
    name: s.name,
    photo: { w: s.photo.width, h: s.photo.height },
    ...(c ? { crop: { x: (c.x * s.photo.width) / SCALE, y: (c.y * s.photo.height) / SCALE, w: (c.w * s.photo.width) / SCALE, h: (c.h * s.photo.height) / SCALE } } : {}),
    // 路線的順序同 marks（畫的先後、並列時的優先順序都依它）
    routes: [...s.routes].sort((a, b) => order(a.id) - order(b.id)).map((r) => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      ...(r.grade ? { grade: r.grade } : {}),
      ...(r.name ? { name: r.name } : {}),
      ...(s.marks[r.id]?.line ? { line: s.marks[r.id].line!.map(px) } : {}),
      ...(s.marks[r.id]?.bolts ? { bolts: Object.fromEntries(Object.entries(s.marks[r.id].bolts!).map(([pos, p]) => [pos, { at: px(p), ...(r.bolts?.[pos] ? { note: r.bolts[pos] } : {}) }])) } : {}),
    })),
    view: { width: s.width, zoom: s.zoom ?? 1, focus: s.focus, highlight: s.highlight, bolts: !!s.bolts, editing: !!s.editing, solo: !!s.solo, desktop: !!s.desktop, boltCodes: !!s.editing, ...TOPO_LOOK },
  }
}

mkdirSync(dir, { recursive: true })
const browser = await launch()
const failures: string[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 })
  for (const s of scenes) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><body style="margin:0;padding:10px;background:#fff;width:fit-content">${sceneHtml(s)}</body>`)
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
    const png = await page.locator('#scene').screenshot({ animations: 'disabled' })
    const file = new URL(`${s.name}.png`, dir)
    if (update) {
      writeFileSync(file, png)
      writeFileSync(new URL(`${s.name}.scene.json`, dir), JSON.stringify(sceneJson(s), null, 1) + '\n')
      console.log(`更新 ${s.name}`)
      continue
    }
    const { ratio, image } = await diff(png, readFileSync(file))
    const ok = ratio <= TOLERANCE
    console.log(`${ok ? '通過' : '失敗'} ${s.name}（差異 ${(ratio * 100).toFixed(3)}%）`)
    if (!ok) {
      failures.push(s.name)
      mkdirSync(diffDir, { recursive: true })
      writeFileSync(new URL(`${s.name}.png`, diffDir), image ?? png)
    }
  }
} finally {
  await browser.close()
}
if (failures.length) {
  console.error(`外觀與基準不同：${failures.join('、')}（差異圖在 shots/topo-diff/）`)
  process.exit(1)
}
