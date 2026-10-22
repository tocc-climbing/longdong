/**
 * 產生 App 圖示（public/icons/）：取臺灣戶外攀岩協會（TOCC）標誌中央的
 * 「臺灣島＋攀岩者」圖形，放在白底上，下方加上「LongDong」字樣，字後面一顆藍色小岩點當簽名
 * （Climbio 的岩點，與分享圖片相同，見 scripts/lib/ogImage.ts）。
 * 標誌外圈文字在手機桌面尺寸下無法辨識，所以不用。
 * 另外輸出頂欄、側欄用的臺灣島（icons/mark.png）：透明底，白色的部分（攀岩者、紋理）也透明，深色模式用 CSS 反白。
 *
 * 字樣使用系統字型（Segoe UI Bold），在不同電腦上重新產生可能略有差異；圖示已 commit 進 repo。
 *
 * 輸出兩種：一般圖示（滿版）與 maskable 圖示（Android 會裁成圓形等形狀，
 * 所以把整個圖案縮到中央 80% 的安全區內）。
 *   npx tsx scripts/gen-icons.ts
 *
 * 來源：assets/tocc-logo.png（1134×1134，取自 tocc-climbing.org）。
 * 輸出為滿版方形，可同時當作 maskable 圖示：圖形落在中央 80% 的安全區內。
 */
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'public/icons')
const LOGO = readFileSync(resolve(ROOT, 'assets/tocc-logo.png'))
const LOGO_SIZE = 1134

// 臺灣島在原圖中的範圍（像素）
const ISLAND = { x: 385, y: 342, width: 320, height: 525 }
// 沿著島外緣、留一點邊的多邊形（原圖座標），用來排除外圈文字
const ISLAND_OUTLINE = [
  [628, 325], [715, 375], [718, 565], [640, 710], [575, 800], [545, 885], [485, 880],
  [455, 810], [415, 730], [380, 665], [378, 575], [425, 505], [478, 455], [530, 370],
]
// 島的高度與中心在 512 畫布上的位置
const TARGET_HEIGHT = 330
const CENTER = { x: 256, y: 192 }

/** Climbio 的岩點（與 scripts/lib/ogImage.ts 相同） */
const HOLD = 'M-30,-56 C-6,-64 22,-50 26,-20 C30,10 24,46 0,56 C-24,62 -40,40 -38,6 C-36,-26 -46,-50 -30,-56 Z'

/** transparent：不加白底（Facebook 應用程式圖示要求透明背景） */
function svg(maskable: boolean, transparent = false): string {
  const scale = TARGET_HEIGHT / ISLAND.height
  const x = CENTER.x - (ISLAND.x + ISLAND.width / 2) * scale
  const y = CENTER.y - (ISLAND.y + ISLAND.height / 2) * scale
  const href = `data:image/png;base64,${LOGO.toString('base64')}`
  const points = ISLAND_OUTLINE.map((p) => p.join(',')).join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
<defs><clipPath id="island"><polygon points="${points}"/></clipPath></defs>
${transparent ? '' : '<rect width="512" height="512" fill="#ffffff"/>'}
<g transform="${maskable ? 'translate(51.2 51.2) scale(0.8)' : ''}">
<g transform="translate(${x} ${y}) scale(${scale})">
  <image clip-path="url(#island)" width="${LOGO_SIZE}" height="${LOGO_SIZE}" xlink:href="${href}"/>
</g>
<text x="236" y="452" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="84" fill="#000000">LongDong</text>
<g transform="translate(466 412) rotate(-16) scale(0.5)"><path d="${HOLD}" fill="#0395c3"/><circle cx="-3.7" cy="-23.8" r="9" fill="#ffffff"/></g>
</g>
</svg>`
}

function png(size: number, maskable = false, transparent = false): Buffer {
  return new Resvg(svg(maskable, transparent), { fitTo: { mode: 'width', value: size } }).render().asPng()
}

/** 瀏覽器分頁的小圖示：尺寸太小，只放「LD」 */
function favicon(size: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="10" fill="#000000"/>
<text x="32" y="45" text-anchor="middle" font-family="Arial Black, Arial" font-weight="900" font-size="34" letter-spacing="-1" fill="#ffffff">LD</text>
</svg>`
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

/** 頂欄、側欄的臺灣島：高 height 像素；黑色不變，白色變透明（亮度轉成透明度） */
function mark(height: number): Buffer {
  const scale = height / ISLAND.height
  const width = Math.ceil(ISLAND.width * scale)
  const href = `data:image/png;base64,${LOGO.toString('base64')}`
  const points = ISLAND_OUTLINE.map((p) => p.join(',')).join(' ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">
<defs><clipPath id="island"><polygon points="${points}"/></clipPath>
<filter id="ink" filterUnits="userSpaceOnUse" x="0" y="0" width="${LOGO_SIZE}" height="${LOGO_SIZE}"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 0 1"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>
<g transform="scale(${scale}) translate(${-ISLAND.x} ${-ISLAND.y})" filter="url(#ink)">
  <image clip-path="url(#island)" width="${LOGO_SIZE}" height="${LOGO_SIZE}" xlink:href="${href}"/>
</g>
</svg>`
  return new Resvg(svg).render().asPng()
}

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'icon-512.png'), png(512))
writeFileSync(resolve(OUT, 'icon-192.png'), png(192))
writeFileSync(resolve(OUT, 'icon-maskable-512.png'), png(512, true))
writeFileSync(resolve(OUT, 'favicon-48.png'), favicon(48))
writeFileSync(resolve(OUT, 'mark.png'), mark(96))
// Facebook 開發者後台的應用程式圖示（1024×1024、透明背景），不放進網站
writeFileSync(resolve(ROOT, 'assets/facebook-app-icon-1024.png'), png(1024, false, true))
console.log('icons written to', OUT)
