/**
 * 建置後替每條路線產生分享頁（dist/route/<路線ID>.html，網址 /route/<路線ID>），見 scripts/lib/sharePages.ts：
 * 內容是 dist/index.html，換上這條路線的預覽資訊。不放進 Service Worker 的預先快取（vite.config.ts 的 globIgnores）。
 * 也替每條路線畫分享圖片（dist/og/<路線ID>.png，見 scripts/lib/ogImage.ts）。
 * 圖片要用的字型（Noto Sans、Noto Sans CJK；Windows 用 Segoe UI、微軟正黑體）找不到時：
 * CI 直接失敗；本機只印警告，分享頁改用網站圖示。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { indexDataset } from '../src/data/dataset'
import type { Dataset } from '../src/data/schema'
import { sharePagePath } from '../src/share'
import { findOgFonts, loadOgMap, ogImagePng, ogImageSvg } from './lib/ogImage'
import { ogImagePath, sharePageHtml } from './lib/sharePages'
import { SITE_URL } from './sheet.config'

const dataset = JSON.parse(readFileSync('dist/data/longdong.json', 'utf8')) as Dataset
const shell = readFileSync('dist/index.html', 'utf8')
const { routes } = indexDataset(dataset)

const withImage = Boolean(findOgFonts())
if (!withImage) {
  const message = '找不到分享圖片的字型（Linux 請安裝 fonts-noto-core 與 fonts-noto-cjk）'
  if (process.env.CI) throw new Error(message)
  console.warn(`${message}，分享頁改用網站圖示`)
}
const map = withImage ? loadOgMap('dist/rescue') : undefined
// 地圖上各大區域的顏色（Sheet 上的區域色），key 是區域 ID 的最後一段（與 areas.geojson 相同）
const areaColors = Object.fromEntries(dataset.areas.flatMap((a) => (a.color ? [[a.id.split('/').pop()!, a.color]] : [])))

const write = (file: string, content: string | Buffer) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}
for (const ref of routes) {
  if (map) write(join('dist', ogImagePath(ref.route.id)), await ogImagePng(ogImageSvg(ref.route, ref.area, ref.sector, map, dataset.crag.name, areaColors)))
  write(join('dist', `${sharePagePath(ref.route.id)}.html`), sharePageHtml(ref, SITE_URL, shell, withImage))
}
console.log(`分享頁：${routes.length} 條路線${withImage ? '（含分享圖片）' : ''}`)
