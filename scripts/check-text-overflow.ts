/**
 * 檢查介面文字有沒有超出元件：每種語言 × 手機與電腦寬度 × 主要頁面，用真的瀏覽器打開 production build，找出
 *   1. 頁面出現水平捲軸（內容比畫面寬）
 *   2. 不換行的文字被擠出元件（按鈕、標籤、欄位標題等；刻意用「…」截斷的不算）
 *   3. 元素超出畫面右緣（可以左右捲動的表格、地圖框裡的不算）
 *   4. 應該是單行的元件（按鈕、膠囊、欄位標題、分頁）被擠成兩行
 *   5. 手機版頂欄的救援按鈕有文字，或比標誌大（要不顯眼）
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
  {
    name: '首頁',
    path: '/',
    prepare: async (page, mobile) => {
      if (mobile) {
        await page.waitForSelector('.weather-now')
        return
      }
      // 紅案：還原 SVG 的 width: auto，或移除側欄救援入口。
      await page.waitForSelector('.area-hero.strip .hero-map path')
      const size = await page.locator('.area-hero.strip').evaluate((hero) => {
        const map = hero.querySelector('.hero-map')!.getBoundingClientRect()
        return { mapWidth: map.width, heroWidth: hero.getBoundingClientRect().width, mapHeight: map.height }
      })
      if (size.mapWidth < size.heroWidth * 0.6 || size.mapHeight < 200) {
        throw new Error('桌面首頁龍洞地圖未填滿右側空間，或高度不足')
      }
      await page.locator('.sidebar a[href="/rescue"]').click()
      await page.waitForSelector('.rescue .sos-call[href="tel:119"]')
      await page.waitForSelector('.sidebar a[href="/rescue"][aria-current="page"]')
      await page.goto(new URL('/', page.url()).href)
      await page.waitForSelector('.area-hero.strip .hero-map path')
    },
  },
  { name: '區域', path: '/area/longdong/golden-valley' },
  {
    name: '分區（展開篩選）',
    path: '/sector/longdong/golden-valley-2xxoyr',
    prepare: async (page, mobile) => {
      if (mobile) await page.click('.list-tools .chip')
    },
  },
  { name: '路線（長名稱）', path: '/route/longdong/u4r3sk' },
  { name: '路線（長中文名）', path: '/route/longdong/ze4rpe' },
  {
    name: '路線（更多選單）',
    path: '/route/longdong/u4r3sk',
    prepare: async (page) => {
      await page.click('article.route .page-tools button[aria-haspopup=menu]')
    },
  },
  {
    name: '路線（分享視窗）',
    path: '/route/longdong/u4r3sk',
    prepare: async (page) => {
      await page.click('article.route .page-tools button[aria-haspopup=menu]')
      // 選單的第一項是分享
      await page.click('article.route .page-tools [role=menuitem] >> nth=0')
      await page.waitForSelector('dialog.sheet[open] .share-item')
    },
  },
  { name: '搜尋', path: '/search?q=5.10' },
  { name: '我的', path: '/me' },
  {
    name: '救援（在岩場：通報地點與急救器材）',
    path: '/rescue',
    prepare: async (page, mobile) => {
      await page.waitForSelector('.sos-where .my-coords')
      await page.waitForSelector('.rescue-map .mk-rescue')
      if (!mobile) {
        const map = (await page.locator('.rescue-map').boundingBox())!
        const info = (await page.locator('.rescue-intro').boundingBox())!
        if (map.x < info.x + info.width) throw new Error('桌面救援地圖未放在右側')
      }
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
      await page.waitForSelector('.mk-me')
      await page.click('.sm-tool.report')
      await page.waitForSelector('.sheet[open] .chip')
    },
  },
  {
    name: 'Bolt 統計（含數字表格）',
    path: '/bolts',
    prepare: async (page) => {
      await page.click('.bolt-table-toggle summary')
    },
  },
  { name: '路線清單（未登入）', path: '/checklist' },
  { name: '關於', path: '/about' },
]

interface Problem {
  kind: string
  element: string
  text: string
  detail: string
}

/** 黃金谷聚焦後仍要看得到鄰近的鱷魚岬與南側停車場，不只看見單點。 */
async function checkRescueContext(page: Page) {
  const map = (await page.locator('.rescue-map').boundingBox())!
  for (const no of [11, 14]) {
    const marker = await page.locator('.rescue-map .mk-rescue').filter({ hasText: new RegExp(`^${no}$`) }).locator('circle').boundingBox()
    if (!marker || marker.x < map.x || marker.y < map.y || marker.x + marker.width > map.x + map.width || marker.y + marker.height > map.y + map.height) {
      throw new Error(`救援地圖放大過近，看不到附近的救援點 #${no}`)
    }
  }
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
/** 首頁天氣的回應（tests/fixtures 的實際資料） */
const WEATHER_SAMPLE = readFileSync(new URL('../tests/fixtures/open-meteo.json', import.meta.url), 'utf8')

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' })
const base = server.resolvedUrls!.local[0]
const browser = await launch()
const found: string[] = []

try {
  // 紅案：移除完整清單、取消精度門檻，或把岩場外誤判成附近，都應失敗。
  for (const lang of LANGS as readonly Lang[]) {
    for (const state of ['near', 'outside', 'inaccurate', 'denied', 'pending', 'unsupported']) {
      const context = await browser.newContext({
        viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
      })
      try {
        await context.addInitScript(`
          localStorage.setItem('longdong.lang', ${JSON.stringify(lang)})
          const state = ${JSON.stringify(state)}
          Object.defineProperty(navigator, 'geolocation', { configurable: true, value: state === 'unsupported' ? undefined : {
            watchPosition(ok, fail) {
              window.__rescueFail = fail
              if (state === 'pending') return 1
              setTimeout(() => {
                if (state === 'denied') {
                  fail({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 })
                } else {
                  ok({ coords: {
                    latitude: state === 'outside' ? 25.033 : 25.1067,
                    longitude: state === 'outside' ? 121.5654 : 121.922483,
                    accuracy: state === 'inaccurate' ? 500 : 8,
                  }, timestamp: Date.now() })
                }
              }, 20)
              return 1
            },
            clearWatch() {},
          } })
        `)
        const page = await context.newPage()
        await page.goto(new URL('/rescue', base).href)
        if (['near', 'outside', 'inaccurate'].includes(state)) {
          await page.waitForSelector('.sos-where .my-coords')
        } else if (state !== 'pending') {
          await page.waitForSelector('.sos-where [role="alert"]')
        } else {
          await page.waitForSelector('.sos-where [role="status"]')
        }
        if (state === 'near') {
          if (await page.locator('.rescue-all').count()) throw new Error('龍洞內準確定位仍顯示全部資料')
          const spot = page.locator('.sos-where .sos-spot')
          if (await spot.count() !== 2 || !(await spot.first().textContent())?.includes('#10')) {
            throw new Error('黃金谷未顯示最近的救援點與器材')
          }
        } else {
          await page.waitForSelector('.rescue-all')
          if (await page.locator('.rescue-points > li').count() !== 16 ||
              await page.locator('.rescue-equipment > li').count() !== 6 ||
              await page.locator('.sos-where .sos-spot').count() !== 0) {
            throw new Error(`[${lang}・${state}] 未顯示完整救援資料，或仍顯示不可靠的附近資料`)
          }
        }
        if (await page.locator('.sos-line a').count() !== 1) throw new Error('救援通報社群連結遺失')
        // 紅案：地圖被移除、未畫出救援點或器材，或恢復任何座標複製按鈕。
        await page.waitForSelector('.rescue-map .mk-rescue')
        if (await page.locator('.rescue-map .mk-rescue').count() !== 14 || await page.locator('.rescue-map .mk-aid').count() !== 6) {
          throw new Error('救援地圖缺少救援點或急救器材')
        }
        if (await page.locator('.rescue .my-coords button').count()) throw new Error('救援頁仍有複製按鈕')
        const mapBox = (await page.locator('.rescue-map').boundingBox())!
        if (mapBox.height < 300) throw new Error('救援地圖高度不足')
        if (state === 'near') {
          await page.waitForSelector('.rescue-map .mk-me')
          await checkRescueContext(page)
          const near = (await page.locator('.rescue-map .mk-rescue').filter({ hasText: /^10$/ }).boundingBox())!
          if (near.x < mapBox.x || near.y < mapBox.y || near.x + near.width > mapBox.x + mapBox.width || near.y + near.height > mapBox.y + mapBox.height) {
            throw new Error('附近的救援點未聚焦在地圖範圍內')
          }
          const transform = page.locator('.rescue-map svg[role=img] > g[transform]').first()
          const before = await transform.getAttribute('transform')
          await page.locator('.rescue-map svg[role=img]').dblclick({ position: { x: 100, y: 100 } })
          if (await transform.getAttribute('transform') === before) throw new Error('救援地圖無法縮放')
          // 原本有附近定位，後來權限被撤回：清單與地圖都必須回到全區。
          await page.evaluate('window.__rescueFail({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 })')
          await page.waitForSelector('.rescue-all')
          await page.waitForSelector('.rescue-map .mk-rescue')
        }
        if (await page.locator('.rescue-map .mk-me').count()) throw new Error('無可靠定位仍顯示舊的位置')
        const outsideMap = await page.locator('.rescue-map').evaluate((map) => {
          const box = map.getBoundingClientRect()
          return [...map.querySelectorAll('.mk-rescue')].some((point) => {
            const r = point.getBoundingClientRect()
            return r.x < box.x || r.y < box.y || r.right > box.right || r.bottom > box.bottom
          })
        })
        if (outsideMap) throw new Error('全區地圖未包含所有有座標的救援點')
        if (state === 'unsupported' && lang === 'zh') {
          const transform = page.locator('.rescue-map svg[role=img] > g[transform]').first()
          // 每一個救援點與器材都是實際入口；移除任一 onClick 都會使此檢查失敗。
          const choices = page.locator('.rescue-all .rescue-select')
          if (await choices.count() !== 22) throw new Error('救援點與器材未全部提供地圖定位')
          for (let i = 0; i < await choices.count(); i++) {
            const before = await transform.getAttribute('transform')
            await choices.nth(i).click()
            await page.waitForFunction((previous) => document.querySelector('.rescue-map svg[role=img] > g[transform]')?.getAttribute('transform') !== previous, before)
          }
          const point = page.locator('.rescue-points > li').filter({ hasText: '#10 ' }).locator('button')
          await page.locator('.rescue-points > li').filter({ hasText: '#9 ' }).locator('button').click()
          await page.waitForSelector('.rescue-map .mk-area.mk-dim')
          await point.click()
          await page.waitForSelector('.rescue-map .mk-area.mk-dim', { state: 'detached' })
          await page.waitForTimeout(100)
          const highlight = page.locator('.rescue-map .mk-mark.selected .mk-mark-gps')
          if (await highlight.count() !== 1) throw new Error('點選的救援位置沒有突顯')
          const style = await highlight.evaluate((circle) => {
            const style = getComputedStyle(circle)
            return { fill: style.fill, stroke: style.stroke, radius: parseFloat(style.r) }
          })
          if (style.fill !== 'none' || style.radius < 18 || ['black', 'rgb(0, 0, 0)'].includes(style.stroke)) {
            throw new Error('點選位置應用中空色暈突顯，不遮住圖示或加黑邊')
          }
          const center = await page.locator('.rescue-map .mk-rescue').filter({ hasText: /^10$/ }).locator('circle').boundingBox()
          const map = (await page.locator('.rescue-map').boundingBox())!
          if (!center || Math.abs(center.x + center.width / 2 - map.x - map.width / 2) > 3 || Math.abs(center.y + center.height / 2 - map.y - map.height / 2) > 3) {
            throw new Error('點選救援點後未以該位置置中')
          }
          await page.locator('.rescue-map svg[role=img]').dblclick({ position: { x: 100, y: 100 } })
          const zoomed = await transform.getAttribute('transform')
          await point.click()
          await page.waitForFunction((previous) => document.querySelector('.rescue-map svg[role=img] > g[transform]')?.getAttribute('transform') !== previous, zoomed)
          // 紅案：還原單點 tight 聚焦或縮小保留範圍，鄰近標示就會超出地圖。
          for (const [width, height] of [[360, 740], [390, 844], [768, 1024], [1023, 768], [1024, 600], [1280, 720], [1440, 900], [1920, 1080]]) {
            await page.setViewportSize({ width, height })
            for (const target of [point, page.locator('.rescue-equipment > li').nth(4).locator('button')]) {
              await target.click()
              await page.waitForTimeout(100)
              await checkRescueContext(page)
            }
          }
          await page.setViewportSize({ width: 360, height: 740 })
        }
        for (const problem of (await page.evaluate(`(${FIND_PROBLEMS})()`)) as Problem[]) {
          found.push(`[${lang}・救援・${state}] ${problem.kind}：${problem.element}「${problem.text}」（${problem.detail}）`)
        }
      } finally {
        await context.close()
      }
    }
  }
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
      // 首頁的天氣用固定的回應：不靠外部服務，天氣的文字一定會被檢查到
      await context.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: WEATHER_SAMPLE }))
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
        if (vp.mobile) {
          const top = await page.evaluate(() => {
            const rescue = document.querySelector('.topbar .rescue-button')
            const icon = rescue?.querySelector('svg')
            const logo = document.querySelector('.topbar .brand-mark')
            if (!rescue || !icon || !logo) return '找不到救援按鈕或標誌'
            const r = icon.getBoundingClientRect()
            const l = logo.getBoundingClientRect()
            if (rescue.textContent?.trim()) return `救援按鈕有文字「${rescue.textContent.trim()}」`
            if (r.height > l.height || r.width > l.width) return `救援按鈕 ${r.width}×${r.height} 比標誌 ${l.width}×${l.height} 大`
          })
          if (top) found.push(`[${lang}・${vp.name}・${p.name}] 頂欄：${top}`)
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
