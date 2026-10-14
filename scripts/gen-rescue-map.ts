/**
 * 由 TOCC 龍洞岩場救援資訊圖（Illustrator .ai，內含 PDF 相容層）產生 App 使用的圖片：
 *   public/rescue/map.webp            整張救援資訊圖
 *   public/rescue/<大區域>.webp        9 個大區域的局部圖
 *
 *   npm run rescue-map -- <救援資訊圖.ai 或 .pdf>
 *
 * 地圖改版時重跑即可；版面若有變動，調整下面 AREA_BOXES 的裁切範圍。
 * 圖片屬於 TOCC，不在本專案的開源授權範圍內（見 README 授權一節）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** 2026 年 7 月版的頁面大小（點）；版面不同時停下來，避免用舊的裁切範圍切出錯誤的區域 */
const PAGE_SIZE = [1836.85, 2607.87]

/**
 * 各大區域的裁切範圍 [x, y, 寬, 高]，單位為點、原點在左上角。
 * 以該區的標籤線為中心，左右含急救器材與長背板圖示、右側含區域名稱，上下保留相鄰區域作為參考。
 */
const AREA_BOXES: Record<string, [number, number, number, number]> = {
  'school-gate': [939, 626, 860, 443],
  clocktower: [1017, 821, 782, 443],
  'long-lane': [1017, 932, 782, 443],
  'music-hall': [1017, 1010, 782, 443],
  'grand-auditorium': [1017, 1082, 782, 443],
  'first-cave': [1017, 1173, 782, 443],
  'second-cave': [1017, 1330, 782, 443],
  'golden-valley': [1017, 1564, 782, 443],
  'back-door': [1017, 1851, 782, 417],
}

/** 輸出解析度：整張圖寬約 3700px（手機上放大看細節也清楚）、局部圖寬約 1170px（手機 3 倍螢幕的寬度）。WebP 比向量圖小：地圖文字都轉成外框，SVG 約 2.4MB */
const FULL_SCALE = 2
const AREA_SCALE = 1.5
const QUALITY = 80

const file = process.argv[2]
if (!file) throw new Error('用法：npm run rescue-map -- <救援資訊圖.ai 或 .pdf>')

const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
const page = await pdf.getPage(1)
const base = page.getViewport({ scale: 1 })
if (Math.abs(base.width - PAGE_SIZE[0]) > 1 || Math.abs(base.height - PAGE_SIZE[1]) > 1) {
  throw new Error(`頁面大小 ${base.width}×${base.height} 與預期 ${PAGE_SIZE.join('×')} 不同：地圖版面可能改了，請先調整 AREA_BOXES`)
}

async function render(scale: number): Promise<Canvas> {
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
  const context = canvas.getContext('2d')
  // 白底：地圖本身沒有底色的地方不要變成透明
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
  return canvas
}

mkdirSync('public/rescue', { recursive: true })

const full = await render(FULL_SCALE)
writeFileSync('public/rescue/map.webp', await full.encode('webp', QUALITY))
console.log(`map.webp ${full.width}×${full.height}`)

const big = await render(AREA_SCALE)
for (const [area, [x, y, w, h]] of Object.entries(AREA_BOXES)) {
  const s = AREA_SCALE
  const out = createCanvas(Math.round(w * s), Math.round(h * s))
  out.getContext('2d').drawImage(big, x * s, y * s, w * s, h * s, 0, 0, out.width, out.height)
  writeFileSync(`public/rescue/${area}.webp`, await out.encode('webp', QUALITY))
  console.log(`${area}.webp ${out.width}×${out.height}`)
}
