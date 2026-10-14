/**
 * 建置後替每條路線產生分享頁（dist/route/<路線ID>/index.html），見 scripts/lib/sharePages.ts。
 * 在 vite build 之後執行，所以這些頁面不會被 Service Worker 預先快取。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { indexDataset } from '../src/data/dataset'
import type { Dataset } from '../src/data/schema'
import { sharePagePath } from '../src/share'
import { sharePageHtml } from './lib/sharePages'
import { SITE_URL } from './sheet.config'

const dataset = JSON.parse(readFileSync('dist/data/longdong.json', 'utf8')) as Dataset
const { routes } = indexDataset(dataset)
for (const ref of routes) {
  const file = join('dist', sharePagePath(ref.route.id), 'index.html')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, sharePageHtml(ref, SITE_URL))
}
console.log(`分享頁：${routes.length} 條路線`)
