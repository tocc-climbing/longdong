/**
 * 檢查介面文字有沒有超出元件：每種語言 × 手機與電腦寬度 × 主要頁面，用真的瀏覽器打開 production build，找出
 *   1. 頁面出現水平捲軸（內容比畫面寬）
 *   2. 不換行的文字被擠出元件（按鈕、標籤、欄位標題等；刻意用「…」截斷的不算）
 *   3. 元素超出畫面右緣（可以左右捲動的表格、地圖框裡的不算）
 *   4. 應該是單行的元件（按鈕、膠囊、欄位標題、分頁）被擠成兩行
 *
 *   npm run build && npm run check:text
 *
 * 瀏覽器：依序嘗試 BROWSER_CHANNEL、Chrome、Edge（CI 的 ubuntu-latest 已內建 Chrome）。
 * 有問題時列出語言、寬度、頁面、元素與文字，exit code 為 1。
 */
import { readFileSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'
import { preview } from 'vite'
import { LANGS, type Lang } from '../src/i18n'

const VIEWPORTS = [
  { name: '手機', width: 360, height: 740, mobile: true },
  { name: '電腦', width: 1280, height: 800, mobile: false },
]

/** 名稱最長的幾條路線，與一般的頁面 */
const PAGES: { name: string; path: string; prepare?: (page: Page, mobile: boolean) => Promise<void> }[] = [
  { name: '首頁', path: '/' },
  { name: '區域', path: '/area/longdong/golden-valley' },
  {
    name: '分區（展開篩選）',
    path: '/sector/longdong/golden-valley-s1',
    prepare: async (page, mobile) => {
      if (mobile) await page.click('.list-tools .chip')
    },
  },
  { name: '路線（長名稱）', path: '/route/longdong/u4r3sk' },
  { name: '路線（長中文名）', path: '/route/longdong/ze4rpe' },
  {
    name: '路線（分享選單）',
    path: '/route/longdong/u4r3sk',
    prepare: async (page) => {
      await page.click('.share-button')
    },
  },
  { name: '搜尋', path: '/search?q=5.10' },
  { name: '我的', path: '/me' },
  {
    name: '救援（含我的位置）',
    path: '/rescue/golden-valley',
    prepare: async (page) => {
      await page.click('.my-location .action.primary')
      await page.waitForSelector('.my-coords')
    },
  },
  {
    name: '地圖（第一次使用的說明）',
    path: '/map',
    prepare: async (page) => {
      await page.waitForSelector('.sheet[open] .action.primary')
    },
  },
  {
    name: '地圖（定位後的回報彈窗）',
    path: '/map',
    prepare: async (page) => {
      await page.evaluate(() => localStorage.setItem('longdong.map.intro', '1'))
      await page.reload()
      await page.waitForSelector('.sm-me')
      await page.click('.sm-chip.report')
      await page.waitForSelector('.sheet[open] .chip')
    },
  },
  { name: '關於', path: '/about' },
]

interface Problem {
  kind: string
  element: string
  text: string
  detail: string
}

async function launch(): Promise<Browser> {
  const channels = [process.env.BROWSER_CHANNEL, 'chrome', 'msedge'].filter(Boolean) as string[]
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch {
      /* 試下一個 */
    }
  }
  throw new Error(`找不到可用的瀏覽器（試過 ${channels.join('、')}）；可用 BROWSER_CHANNEL 指定`)
}

/** 在頁面裡執行的檢查，見 lib/find-overflow.browser.js */
const FIND_PROBLEMS = readFileSync(new URL('./lib/find-overflow.browser.js', import.meta.url), 'utf8')

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' })
const base = server.resolvedUrls!.local[0]
const browser = await launch()
const found: string[] = []

try {
  for (const lang of LANGS as readonly Lang[]) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
        serviceWorkers: 'block',
        geolocation: { latitude: 25.1069, longitude: 121.9227, accuracy: 15 },
        permissions: ['geolocation'],
      })
      await context.addInitScript((l) => localStorage.setItem('longdong.lang', l), lang)
      const page = await context.newPage()
      for (const p of PAGES) {
        await page.goto(new URL(p.path, base).href)
        await page.waitForLoadState('networkidle')
        await page.waitForSelector('main > *:not(.empty)')
        if (p.prepare) await p.prepare(page, vp.mobile)
        await page.waitForTimeout(200)
        for (const problem of (await page.evaluate(`(${FIND_PROBLEMS})()`)) as Problem[]) {
          found.push(`[${lang}・${vp.name}・${p.name}] ${problem.kind}：${problem.element}「${problem.text}」（${problem.detail}）`)
        }
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()))
}

const unique = [...new Set(found)]
if (unique.length) {
  console.log(`發現 ${unique.length} 個文字超出的問題：\n` + unique.join('\n'))
  process.exit(1)
}
console.log(`沒有文字超出：${LANGS.length} 種語言 × ${VIEWPORTS.length} 種寬度 × ${PAGES.length} 個頁面`)
