/**
 * 端對端測試：登入 → 重開 App → 在龍洞回報位置 → 確認資料庫收到（v2/calibration）。
 * 用 Firebase 模擬器（firebase.e2e.json），不碰正式資料；模擬器載入 firebase/database.rules.json，一併驗證規則允許這次寫入。
 *
 *   npm run test:e2e
 */
import { chromium } from 'playwright-core'
import { preview } from 'vite'

const DB = 'http://127.0.0.1:9000'
const server = await preview({ build: { outDir: 'dist-e2e' }, preview: { port: 4220, strictPort: true }, logLevel: 'silent' })
const base = server.resolvedUrls!.local[0]
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
// 用字串注入：tsx 編譯函式時會加上瀏覽器裡沒有的 __name
await ctx.addInitScript(`
  localStorage.setItem('longdong.map.intro', '1')
  // 模擬在龍洞的 GPS（Playwright 的定位模擬在登入視窗之後不穩定）
  const fix = () => ({ coords: { latitude: 25.1105, longitude: 121.9228, accuracy: 8 }, timestamp: Date.now() })
  const stub = {
    getCurrentPosition: (ok) => setTimeout(() => ok(fix()), 50),
    watchPosition: (ok) => (setTimeout(() => ok(fix()), 50), 1),
    clearWatch: () => {},
  }
  Object.defineProperty(Navigator.prototype, 'geolocation', { configurable: true, get: () => stub })
  // 記下所有出現過的提示（提示幾秒後就消失）
  const seen = (window.__toasts = [])
  new MutationObserver(() => {
    const text = document.querySelector('.map-toast')?.textContent
    if (text && seen.at(-1) !== text) seen.push(text)
  }).observe(document, { subtree: true, childList: true, characterData: true })
`)
const page = await ctx.newPage()
const logs: string[] = []
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()))
page.on('pageerror', (e) => logs.push(String(e)))
let ok = true
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? '：' + detail : ''}`)
  if (!pass) ok = false
}

/** Firebase 把登入狀態寫進 IndexedDB 了沒（寫入是非同步的，太快重新載入會變成沒登入） */
const persisted = () =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open('firebaseLocalStorageDb')
        open.onsuccess = () => {
          try {
            const keys = open.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAllKeys()
            keys.onsuccess = () => resolve(keys.result.some((k) => String(k).startsWith('firebase:authUser:')))
          } catch {
            resolve(false)
          }
        }
        open.onerror = () => resolve(false)
      }),
  )

try {
  // 登入：模擬器的登入視窗，新增一個 Google 帳號
  await page.goto(base + 'me')
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('.signin-prompt .action.primary')])
  await popup.waitForLoadState()
  await popup.click('text=Add new account')
  await popup.click('text=Auto-generate user information')
  await popup.click('#sign-in')
  let saved = false
  for (let i = 0; i < 40 && !saved; i++) if (!(saved = await persisted())) await page.waitForTimeout(250)
  check('登入', saved)

  // 重開 App 直接到地圖頁回報：登入狀態還在載入時就回報，載入完應自動上傳
  await page.goto(base + 'map')
  await page.waitForSelector('.sm-me', { timeout: 20000 })
  await page.click('.sm-tool.report')
  await page.waitForSelector('.sheet[open] .chip')
  await page.click('.sheet[open] .chip >> nth=0')
  await page.click('.sheet[open] button[type=submit]')

  // 資料庫收到了嗎（以 owner 身分讀，不受規則限制）
  let uploads: Record<string, Record<string, { geojson: string }>> | null = null
  for (let i = 0; i < 20 && !uploads; i++) {
    uploads = await (await fetch(`${DB}/v2/calibration.json?ns=longdong`, { headers: { Authorization: 'Bearer owner' } })).json()
    if (!uploads) await page.waitForTimeout(500)
  }
  const features = uploads ? Object.values(uploads).flatMap((u) => Object.values(u)).flatMap((u) => JSON.parse(u.geojson).features) : []
  check('資料庫收到回報', features.length === 1, features.map((f: { properties: { note: string } }) => f.properties.note).join('、'))

  const toasts = await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)
  check('沒有誤報「登入後自動上傳」', !toasts.some((s) => s.includes('登入後')), toasts.join(' → '))
} catch (err) {
  await page.screenshot({ path: process.env.TEMP + '/e2e-fail.png' }).catch(() => {})
  check('流程', false, String(err))
} finally {
  if (logs.length) console.log('主控台錯誤：\n  ' + logs.slice(0, 10).join('\n  '))
  await browser.close()
  server.httpServer.close()
}
process.exit(ok ? 0 : 1)
