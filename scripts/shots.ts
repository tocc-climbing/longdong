/**
 * 截圖：在 Firebase 模擬器上打開 App，拍手機與電腦的畫面，檢查改版或新功能用。
 * 不碰正式資料（模擬器，專案 demo-longdong）；圖存在 shots/（不提交）。
 *
 *   npm run shots -- [選項] <路徑…>
 *
 *   路徑            要拍的頁面，例如 / /route/longdong/ww2tzc /checklist；預設拍首頁
 *   --login=信箱    先用這個信箱登入（模擬器的帳號，例如管理員 kant.kang@gmail.com）；要登入才看得到的頁面用
 *   --sim=緯度,經度 模擬位置（同 /map@緯度,經度），例如 --sim=25.1105,121.9228
 *   --mobile        只拍手機（390×844）；--desktop 只拍電腦（1366×860）；--imac 只拍 24 吋 iMac（2240×1260）
 *   --full          拍整頁（預設只拍一個畫面）
 *   --seed          先放一些測試資料：留言、檢舉、地圖回報（管理頁用）
 *
 * 需要 Java（模擬器）。腳本先建置 e2e 版（dist-e2e），再啟動模擬器、在模擬器裡跑自己一次（SHOTS_ARGS 傳參數）。
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'

if (!process.env.SHOTS_ARGS) {
  execSync('npx vite build --mode e2e --outDir dist-e2e', { stdio: 'inherit' })
  execSync('npx -y firebase-tools@15.34.1 emulators:exec --config firebase.e2e.json --only auth,database,storage --project demo-longdong "tsx scripts/shots.ts"', {
    stdio: 'inherit',
    env: { ...process.env, SHOTS_ARGS: JSON.stringify(process.argv.slice(2)) },
  })
  process.exit(0)
}

const args = JSON.parse(process.env.SHOTS_ARGS) as string[]
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
// Git Bash 會把 /reports 這類參數轉成 C:/Program Files/Git/reports，轉回來
const paths = args.filter((a) => !a.startsWith('--')).map((p) => p.replace(/^[A-Za-z]:\/.*?\/Git(?=\/)/, ''))
const login = option('login')
const sim = option('sim')
const OUT = 'shots'
const DB = 'http://127.0.0.1:9000'

const viewports = [
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1366, height: 860, mobile: false },
  { name: 'imac', width: 2240, height: 1260, mobile: false },
].filter((v) => (flag('imac') ? v.name === 'imac' : v.name !== 'imac' && !(flag('mobile') && !v.mobile) && !(flag('desktop') && v.mobile)))

/** 測試資料：兩則留言（一則被檢舉）、兩筆地圖回報（一筆有在地圖上點的位置） */
async function seed() {
  const now = Date.now()
  const iso = new Date().toISOString()
  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { note: '長巷附近', accuracy: 8, time: new Date(now - 7200000).toISOString(), picked: [121.92305, 25.11075] }, geometry: { type: 'Point', coordinates: [121.9228, 25.1105] } },
      { type: 'Feature', properties: { note: '#62 火龍 · 起攀點', accuracy: 12, time: new Date(now - 3600000).toISOString() }, geometry: { type: 'Point', coordinates: [121.92283, 25.10473] } },
    ],
  })
  const data = {
    profiles: { alice: { name: 'Alice', updatedAt: iso }, bob: { name: '小明', updatedAt: iso } },
    comments: {
      'longdong:ww2tzc': { c1: { uid: 'alice', text: '第三把 bolt 有點鬆，注意', createdAt: now - 600000 } },
      'longdong:sd75k9': { c2: { uid: 'bob', text: '這是廣告 http://spam.example', createdAt: now - 3600000 } },
    },
    reports: { r1: { path: 'v2/comments/longdong:sd75k9/c2', uid: 'alice', reason: '廣告', createdAt: now } },
    calibration: { alice: { u1: { geojson, createdAt: now } } },
  }
  const res = await fetch(`${DB}/v2.json?ns=longdong`, { method: 'PATCH', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(data) })
  if (!res.ok) throw new Error(`放測試資料失敗：${res.status}`)
}

/** 用模擬器的登入視窗登入（新增一個帳號） */
async function signIn(page: Page, base: string, email: string) {
  await page.goto(base + 'me')
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('.signin-prompt .action.primary')])
  await popup.waitForLoadState()
  await popup.click('text=Add new account')
  await popup.fill('#email-input', email)
  await popup.fill('#display-name-input', email.split('@')[0])
  await popup.click('#sign-in')
  // 「我的」換成登入後的畫面；再等一下讓登入狀態寫進 IndexedDB（太快換頁會變成沒登入）
  await page.waitForSelector('.signin-prompt', { state: 'detached', timeout: 20000 })
  await page.waitForTimeout(2000)
}

mkdirSync(OUT, { recursive: true })
if (flag('seed')) await seed()
const server = await preview({ build: { outDir: 'dist-e2e' }, preview: { port: 4220, strictPort: true }, logLevel: 'silent' })
const base = server.resolvedUrls!.local[0]
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true })
let failed = false
try {
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.name === 'imac' ? 1 : 2,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      serviceWorkers: 'block',
    })
    // 地圖頁第一次的說明不顯示
    await ctx.addInitScript(`localStorage.setItem('longdong.map.intro', '1')`)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => {
      failed = true
      console.log(`✗ ${vp.name}：${String(e)}`)
    })
    if (login) await signIn(page, base, login)
    if (sim) await page.goto(`${base}map@${sim}`)
    for (const path of paths.length ? paths : ['/']) {
      await page.goto(base + path.replace(/^\//, ''))
      await page.waitForLoadState('networkidle')
      // 登入狀態是重新載入後才恢復的：等登入提示消失（最多 15 秒）
      if (login) await page.waitForFunction(`!document.querySelector('.signin-prompt')`, undefined, { timeout: 15000 }).catch(() => console.log(`✗ ${path}：還是沒登入`))
      await page.waitForTimeout(800)
      const file = `${OUT}/${path.replace(/^\//, '').replace(/[/?=&@,]+/g, '_') || 'home'}-${vp.name}.png`
      await page.screenshot({ path: file, fullPage: flag('full') })
      console.log(file)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  server.httpServer.close()
}
if (failed) process.exit(1)
