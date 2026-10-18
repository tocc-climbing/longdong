/**
 * 建置後替每條路線產生分享頁（dist/route/<路線ID>.html，網址 /route/<路線ID>），見 scripts/lib/sharePages.ts：
 * 內容是 dist/index.html，換上這條路線的預覽資訊。不放進 Service Worker 的預先快取（vite.config.ts 的 globIgnores）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { indexDataset } from '../src/data/dataset'
import type { Dataset } from '../src/data/schema'
import { sharePagePath } from '../src/share'
import { sharePageHtml } from './lib/sharePages'
import { SITE_URL } from './sheet.config'

const dataset = JSON.parse(readFileSync('dist/data/longdong.json', 'utf8')) as Dataset
const shell = readFileSync('dist/index.html', 'utf8')
const { routes } = indexDataset(dataset)
for (const ref of routes) {
  const file = join('dist', `${sharePagePath(ref.route.id)}.html`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, sharePageHtml(ref, SITE_URL, shell))
}
console.log(`分享頁：${routes.length} 條路線`)
