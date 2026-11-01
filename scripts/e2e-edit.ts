/**
 * 端對端測試（編輯模式）：登入 → 回報 → 去識別副本 → 編輯區域範圍時看到該區的回報 → 地圖編輯（大區域範圍、分區岩壁、刪除版本）→
 * Topo 標記（復原、重做、提交）→ 看 Topo 的 bolt 切換 → 管理頁的所有輸入、搜尋、處理檢舉（電腦版、手機版）。
 * 用 Firebase 模擬器（firebase.e2e.json），不碰正式資料；模擬器載入真正的資料庫規則，一併驗證規則允許這些寫入。
 * 每一項檢查的是「資料庫裡真的有什麼」與「畫面上真的出現什麼」，不是程式內部狀態。
 *
 *   npm run test:e2e        （先跑 scripts/e2e-report.ts，再跑這個）
 */
import { readFileSync } from 'node:fs'
import { chromium, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright-core'
import { preview } from 'vite'
import type { LatLng } from '../src/geo'
import { faceTrail } from '../src/map/aspect'
import { project } from '../src/map/mapData'

const DB = 'http://127.0.0.1:9000'
const asOwner = { headers: { Authorization: 'Bearer owner' } }
/** 模擬器的資料庫實例；以 owner 身分讀寫，不受規則限制（用來放測試資料與檢查資料庫收到了什麼） */
const url = (path: string) => `${DB}/${path}.json?ns=longdong`
const read = async <T = unknown>(path: string): Promise<T | null> => (await (await fetch(url(path), asOwner)).json()) as T | null
const put = async (path: string, body: unknown) => {
  const res = await fetch(url(path), { method: 'PUT', body: JSON.stringify(body), ...asOwner })
  if (!res.ok) throw new Error(`放測試資料失敗 ${path}：${res.status}`)
}

/** 龍洞的資料：找一個有至少三條編號路線的分區放 Topo，校門口所在的分區放岩壁 */
const data = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as {
  areas: { id: string; name: { zh: string }; sectors: { id: string; name: { zh: string }; routes: { id: string; number?: string; name: { zh: string }; bolts?: unknown[]; anchors?: unknown[] }[] }[] }[]
}
// 有至少三條編號路線、而且前三條都有 bolt／anchor 位置的分區（測試 bolt 位置的按鈕要用）
const topoSector = data.areas
  .flatMap((a) => a.sectors)
  .find((s) => {
    const numbered = s.routes.filter((r) => r.number)
    return numbered.length >= 3 && numbered.slice(0, 3).every((r) => (r.bolts?.length ?? 0) + (r.anchors?.length ?? 0) > 0)
  })!
const topoRoutes = topoSector.routes.filter((r) => r.number).slice(0, 3)
const gate = data.areas.find((a) => a.id.endsWith('/school-gate'))!
const wallSector = gate.sectors[0].id
const gateSectorName = (gate.sectors[0] as unknown as { name: { zh: string } }).name.zh
/** 岩壁的原始版：分區 → 幾條線 */
const baseWalls = new Map(
  (JSON.parse(readFileSync('public/rescue/walls.geojson', 'utf8')) as { features: { properties: { sector: string }; geometry: { coordinates: unknown[] } }[] }).features.map((f) => [
    f.properties.sector,
    f.geometry.coordinates.length,
  ]),
)
const baseWallLines = [...baseWalls.values()].reduce((a, b) => a + b, 0)
/** 校門口範圍裡的一個位置（areas.geojson 的一塊的中間） */
const AT = { lat: 25.11272, lng: 121.92216 }

// 和 Firebase Hosting 一樣（cleanUrls）：/index.html 轉址到 /
const cleanUrls = {
  name: 'clean-urls',
  configurePreviewServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: () => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const m = req.url?.match(/^\/index\.html(\?.*)?$/)
      if (!m) return next()
      res.statusCode = 301
      res.setHeader('Location', `/${m[1] ?? ''}`)
      res.end()
    })
  },
}
const server = await preview({ build: { outDir: 'dist-e2e' }, preview: { port: 4220, strictPort: true }, logLevel: 'silent', plugins: [cleanUrls] })
const base = server.resolvedUrls!.local[0]
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true })
const logs: string[] = []
let ok = true
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? '：' + detail : ''}`)
  if (!pass) ok = false
}
/** 等到條件成立（最多 15 秒）；資料庫、畫面都是非同步的 */
async function until<T>(fn: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms = 15000): Promise<T | undefined> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > end) return undefined
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function newContext(location?: { lat: number; lng: number }, device: BrowserContextOptions = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'zh-TW', serviceWorkers: 'block', ...device })
  // 用字串注入：tsx 編譯函式時會加上瀏覽器裡沒有的 __name
  await ctx.addInitScript(`
    localStorage.setItem('longdong.map.intro', '1')
    ${
      location
        ? `const fix = () => ({ coords: { latitude: ${location.lat}, longitude: ${location.lng}, accuracy: 8 }, timestamp: Date.now() })
    const stub = { getCurrentPosition: (ok) => setTimeout(() => ok(fix()), 50), watchPosition: (ok) => (setTimeout(() => ok(fix()), 50), 1), clearWatch: () => {} }
    Object.defineProperty(Navigator.prototype, 'geolocation', { configurable: true, get: () => stub })`
        : ''
    }
  `)
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && logs.push(m.text()))
  page.on('pageerror', (e) => logs.push(String(e)))
  page.on('dialog', (d) => void d.accept())
  return { ctx, page }
}

/** 用模擬器的登入視窗登入（新增一個帳號） */
async function signIn(page: Page, email: string) {
  await page.goto(base + 'me')
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('.signin-prompt .action.primary')])
  await popup.waitForLoadState()
  await popup.click('text=Add new account')
  await popup.fill('#email-input', email)
  await popup.fill('#display-name-input', email.split('@')[0])
  await popup.click('#sign-in')
  await page.waitForSelector('.signin-prompt', { state: 'detached', timeout: 20000 })
  // 登入狀態寫進 IndexedDB 要一點時間，太快換頁會變成沒登入
  await page.waitForTimeout(2000)
}

/** 在地圖頁回報目前位置（選第一個選項、送出） */
async function report(page: Page) {
  await page.goto(base + 'map')
  await page.waitForSelector('.sm-me', { timeout: 20000 })
  await page.click('.sm-tool.report')
  await page.waitForSelector('.sheet[open] .chip')
  await page.click('.sheet[open] .chip >> nth=0')
  await page.click('.sheet[open] button[type=submit]')
}

type Pin = Record<string, unknown>
const pins = async () => (await read<Record<string, Pin>>('v2/reportPins')) ?? {}

/** 在編輯畫面（地圖）上依序點幾下：位置是畫布寬高的比例 */
async function clickCanvas(page: Page, points: [number, number][]) {
  const box = (await page.locator('.edit-canvas svg[role=img]').boundingBox())!
  for (const [fx, fy] of points) await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
}
/** 手機 Topo 編輯：畫面上看得到的那一塊照片（縮放區和照片重疊的範圍；縮放區比照片大，旁邊是黑邊） */
async function shownPhoto(page: Page) {
  const pane = (await page.locator('dialog.topo-phone .topo-zoom').boundingBox())!
  const svg = (await page.locator('dialog.topo-phone .topo-frame svg').boundingBox())!
  const x = Math.max(pane.x, svg.x)
  const y = Math.max(pane.y, svg.y)
  return { x, y, width: Math.min(pane.x + pane.width, svg.x + svg.width) - x, height: Math.min(pane.y + pane.height, svg.y + svg.height) - y }
}

const rings = (page: Page) => page.locator('.sm-edit-ring').count()
/** 提交並等畫面說完成（「已儲存」提示）：資料庫收到了、畫面也更新完才繼續，不然接著畫的會被儲存完成時的更新蓋掉 */
async function submitMap(page: Page) {
  await page.waitForSelector('.edit-toast', { state: 'detached', timeout: 10000 }).catch(() => {})
  await page.click('.edit-toolbar .edit-btn.primary')
  await page.waitForSelector('.edit-toast', { timeout: 15000 })
}

try {
  // ── 0. 離線快取（Service Worker）裡沒有首頁時打開路線頁：從網路讀，不會出現「無法連上這個網站」──
  {
    const ctx = await browser.newContext({ locale: 'zh-TW' })
    const page = await ctx.newPage()
    await page.goto(base)
    await page.evaluate(async () => void (await navigator.serviceWorker.ready))
    await page.reload()
    await until(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    await page.evaluate(async () => {
      for (const k of await caches.keys()) await caches.delete(k)
    })
    const opened = await page.goto(new URL('route/longdong/e2e', base).href).then((r) => r?.status() ?? 0, (e: Error) => e.message.split('\n')[0])
    check('離線快取被清掉後打開路線頁：正常打開（不是 ERR_FAILED）', opened === 200 && (await page.locator('#root').count()) === 1, String(opened))
    await ctx.close()
  }

  // ── 1. 回報 → 去識別副本（沒登入的裝置） ─────────────────────────────
  // 前一支測試（e2e-report.ts）已經有一筆登入的回報的副本：這裡只看新增的
  const existing = await pins()
  const added = async (count: number) => {
    const all = await pins()
    const fresh = Object.fromEntries(Object.entries(all).filter(([k]) => !(k in existing)))
    return Object.keys(fresh).length >= count ? fresh : undefined
  }
  const anon = await newContext(AT)
  await report(anon.page)
  const first = await until(() => added(1))
  check('沒登入的回報：資料庫收到去識別的副本', !!first && Object.keys(first).length === 1)
  const device = await anon.page.evaluate(`localStorage.getItem('longdong.device')`)
  const onlyAllowed = (p: Pin) => Object.keys(p).every((k) => ['lat', 'lng', 'note', 'accuracy', 'picked', 'manual', 'kind', 'area', 'sector', 'route'].includes(k))
  check('副本只有位置與說明，沒有帳號、裝置代號、時間', !!first && Object.values(first).every(onlyAllowed) && !JSON.stringify(first).includes(String(device)))
  check('副本的位置是回報的位置', !!first && Object.values(first).every((p) => Math.abs(Number(p.lat) - AT.lat) < 1e-4 && Math.abs(Number(p.lng) - AT.lng) < 1e-4))
  const anonUploads = await read<Record<string, Record<string, unknown>>>('v2/anonReports')
  check('原本的回報還是照樣上傳（anonReports）', !!anonUploads && Object.keys(anonUploads).length === 1)

  // 同一個點附近再回報一次：兩筆（不同時間，代碼不同）
  await report(anon.page)
  const two = await until(() => added(2))
  check('再回報一次：副本有兩筆', !!two && Object.keys(two).length === 2)
  // 資料庫還沒有任何岩壁的修改：沒登入也畫出各分區岩壁的原始版
  const anonLines = () => anon.page.locator('.sm-line').count()
  const allBaseWalls = await until(async () => ((await anonLines()) === baseWallLines ? true : undefined), 5000)
  check('沒登入也畫出各分區岩壁的原始版', allBaseWalls === true, `${await anonLines()} 條，應為 ${baseWallLines}`)
  // 每段岩壁的顏色是所屬大區域的外框色，沒有白色外框
  const wallColors = await anon.page.evaluate(() =>
    [...document.querySelectorAll('.sm-line')].map((g) => {
      const area = [...g.classList].find((c) => c.startsWith('sm-area-'))
      const outline = area && document.querySelector(`path.sm-area.${area}`)
      return { area, strokes: [...g.querySelectorAll('path')].map((p) => getComputedStyle(p).stroke), outline: outline ? getComputedStyle(outline).stroke : undefined }
    }),
  )
  const offColor = wallColors.filter((w) => !w.outline || w.strokes.some((s) => s !== w.outline))
  check('岩壁用所屬大區域的外框色、沒有白邊', wallColors.length === baseWallLines && offColor.length === 0, JSON.stringify(offColor.slice(0, 2)))
  await anon.ctx.close()

  // ── 2. 修改區域範圍：看到該區的回報（合併、有幾筆） ──────────────────
  const editor = await newContext()
  await signIn(editor.page, 'editor@example.com')
  await editor.page.goto(base + 'edit/map/area:school-gate')
  await editor.page.waitForSelector('.edit-canvas svg[role=img]')
  const list = await editor.page.waitForSelector('.edit-pins li', { timeout: 15000 }).catch(() => undefined)
  check('編輯校門口：右側有回報清單', !!list)
  check('頁面標題是「編輯模式」', ((await editor.page.locator('.edit-title').textContent()) ?? '').trim() === '編輯模式')
  const text = (await editor.page.locator('.edit-pins').textContent()) ?? ''
  check('同一個點附近的回報合併成一處、相同的說明標出 ×2', (await editor.page.locator('.edit-pins li').count()) === 1 && text.includes('×2'), text.replace(/\s+/g, ' ').slice(0, 120))
  check('地圖上有對應的圓點', (await editor.page.locator('.sm-mark').count()) === 1)
  const panel = (await editor.page.locator('.edit-panel').textContent()) ?? ''
  check('不顯示是誰、什麼時候回報的', !panel.includes('editor') && !/\d{4}[/-]\d{1,2}[/-]\d{1,2}.*回報/.test(text))

  // ── 3. 地圖編輯：畫多邊形、提交、刪除版本後載回前一版 ─────────────────
  const n0 = await rings(editor.page)
  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.2, 0.2], [0.35, 0.2], [0.35, 0.35]])
  check('畫多邊形時，沒閉環前顯示半透明的暫時封閉區', (await editor.page.locator('.sm-line-fill').count()) === 1)
  await clickCanvas(editor.page, [[0.2, 0.35]])
  await editor.page.keyboard.press('Enter')
  check('完成多邊形：多一塊', (await rings(editor.page)) === n0 + 1)
  // 快捷鍵都是單一按鍵，上方工具列的按鈕標示按鍵；右側不再重複列一份
  await editor.page.keyboard.press('z')
  check('Z 復原：少一塊', (await rings(editor.page)) === n0)
  await editor.page.locator('.edit-toolbar .edit-tool', { hasText: '重做' }).click()
  check('工具列的「重做」按鈕：回到多一塊', (await rings(editor.page)) === n0 + 1)
  check('地圖編輯：右側快捷鍵只列沒有按鈕的（提交 S、右鍵），沒有按鈕列', (await editor.page.locator('.edit-panel .key-list button.key-row').count()) === 0 && (await editor.page.locator('.edit-panel .key-row.info').count()) === 2)
  await editor.page.waitForSelector('.edit-toast', { state: 'detached', timeout: 10000 }).catch(() => {})
  await editor.page.keyboard.press('s')
  await editor.page.waitForSelector('.edit-toast', { timeout: 15000 })
  const v1 = await until(async () => {
    const v = await read<Record<string, { rings: string; uid: string }>>('v2/mapEdits/area:school-gate')
    return v && Object.keys(v).length === 1 ? v : undefined
  })
  check('提交：資料庫有第一版，多邊形數量對', !!v1 && Object.values(v1)[0].rings.split('|').length === n0 + 1)

  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.55, 0.2], [0.7, 0.2], [0.7, 0.35], [0.55, 0.35]])
  await editor.page.keyboard.press('Enter')
  await submitMap(editor.page)
  const v2 = await until(async () => {
    const v = await read<Record<string, unknown>>('v2/mapEdits/area:school-gate')
    return v && Object.keys(v).length === 2 ? v : undefined
  })
  check('第二次提交：有兩個版本', !!v2)
  // 同一天、同一人連續的兩個版本合併成一筆（標明 2 次）；資料庫仍是兩個版本
  check('修改記錄預設收起', (await editor.page.locator('.edit-versions').count()) === 0)
  await editor.page.locator('.edit-history-toggle').click()
  check('修改記錄：同一人同一天的兩個版本合併成一筆', (await until(async () => ((await editor.page.locator('.edit-versions li').count()) === 1 ? true : undefined))) === true)
  check('合併的一筆標明 2 次修改', /2 次修改/.test((await editor.page.locator('.edit-versions li .edit-version-time').first().textContent()) ?? ''))
  // 刪除合併的一筆：只刪最新的版本（資料庫少一個、編輯的形狀回到前一版）
  await editor.page.locator('.edit-versions li').first().locator('button').click()
  const left = await until(async () => {
    const v = await read<Record<string, unknown>>('v2/mapEdits/area:school-gate')
    return v && Object.keys(v).length === 1 ? v : undefined
  })
  check('刪除最新的版本：資料庫剩第一版', !!left)
  const back = await until(async () => ((await rings(editor.page)) === n0 + 1 ? true : undefined))
  check('編輯的形狀回到前一版（不是載回舊的或停在刪掉的）', back === true, `${await rings(editor.page)} 塊，應為 ${n0 + 1}`)
  check('刪除後只剩一個版本，不再標次數', (await editor.page.locator('.edit-versions li').count()) === 1 && !/次修改/.test((await editor.page.locator('.edit-versions li .edit-version-time').first().textContent()) ?? ''))

  // ── 3b. 草稿：跨區域修改，全部一起提交（切換區域不丟修改、刪光後可以新增、提交完才解鎖） ──
  const openArea = async (id: string) => {
    await editor.page.locator(`a.edit-item[href$="area:${id}"]`).first().dispatchEvent('click')
    await editor.page.waitForFunction((x) => location.pathname.endsWith(`area:${x}`), id)
    await editor.page.waitForSelector('.edit-canvas svg[role=img]')
  }
  const laneAreaPaths = () => editor.page.locator('path.sm-area-long-lane').count()
  await openArea('long-lane')
  check('修改龍巷：地圖上有龍巷的區域', (await laneAreaPaths()) === 1)
  // Delete 刪的是選中的那一塊：沒選中時先點一塊再刪
  for (let i = 0; i < 20 && (await rings(editor.page)) > 0; i++) {
    if ((await editor.page.locator('.sm-edit-ring.selected').count()) === 0) await editor.page.locator('.sm-edit-ring').first().click()
    await editor.page.keyboard.press('Delete')
  }
  check('刪光所有的塊：編輯的形狀沒有了', (await rings(editor.page)) === 0)
  check('刪光後地圖上不會留下舊的龍巷區域', (await laneAreaPaths()) === 0)
  await openArea('clocktower')
  const clockRings = await rings(editor.page)
  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.2, 0.2], [0.35, 0.2], [0.35, 0.35]])
  await editor.page.keyboard.press('Enter')
  check('切到鐘塔：畫一塊，多一塊', (await rings(editor.page)) === clockRings + 1)
  // 大塊中間另外畫一小塊：點小塊要選到小塊，不是外面的大塊
  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.3, 0.23], [0.33, 0.23], [0.33, 0.26]])
  await editor.page.keyboard.press('Enter')
  await clickCanvas(editor.page, [[0.22, 0.21]])
  const selectedRing = () => editor.page.locator('.sm-edit-ring').evaluateAll((els) => els.findIndex((e) => e.classList.contains('selected')))
  const outer = await selectedRing()
  await clickCanvas(editor.page, [[0.325, 0.245]])
  check('大塊中間另外畫的小塊點得到', outer === clockRings && (await selectedRing()) === clockRings + 1, `大塊 ${outer}，小塊 ${await selectedRing()}`)
  check('切到鐘塔後，龍巷的區域還是刪光的狀態（沒有跑出舊的）', (await laneAreaPaths()) === 0)
  check('資料庫還沒收到任何新版本（提交前不和伺服器通訊）', !(await read('v2/mapEdits/area:clocktower')) && !(await read('v2/mapEdits/area:long-lane')))
  await openArea('long-lane')
  check('切回龍巷：草稿還在（還是 0 塊）', (await rings(editor.page)) === 0)
  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.4, 0.4], [0.55, 0.4], [0.55, 0.55], [0.4, 0.55]])
  const hint = () => editor.page.locator('.edit-toolbar .edit-status').textContent()
  check('畫新的區域：點了四個點', ((await hint()) ?? '').includes('4 點'))
  await editor.page.keyboard.press('z')
  check('畫的時候按 Z：退回上一個點（3 點），不是復原整塊', ((await hint()) ?? '').includes('3 點'))
  await editor.page.keyboard.press('Enter')
  check('刪光後按 N 可以新增：多一塊', (await rings(editor.page)) === 1)
  check('右側列出 2 個還沒提交的項目', (await editor.page.locator('.edit-pending li').count()) === 2)
  check('提交按鈕標出 2 項', /\b2\b/.test((await editor.page.locator('.edit-toolbar .edit-btn.primary').textContent()) ?? ''))
  await submitMap(editor.page)
  const gateVersions = await until(async () => {
    const v = await read<Record<string, { rings: string }>>('v2/mapEdits/area:long-lane')
    return v && Object.keys(v).length === 1 ? v : undefined
  })
  const clockVersions = await until(async () => {
    const v = await read<Record<string, { rings: string }>>('v2/mapEdits/area:clocktower')
    return v && Object.keys(v).length === 1 ? v : undefined
  })
  check('全部提交：兩個區域各多一個版本', !!gateVersions && !!clockVersions)
  check('龍巷的最新版是刪光後新畫的一塊', !!gateVersions && Object.values(gateVersions).some((v) => v.rings.split('|').length === 1))
  check('提交後草稿清空：沒有未提交的項目', (await editor.page.locator('.edit-pending').count()) === 0)
  check('提交後龍巷顯示剛提交的一塊', (await rings(editor.page)) === 1 && (await laneAreaPaths()) === 1)

  // ── 4. 岩壁：分區的「岩壁」可以畫、提交 ──────────────────────────────
  await editor.page.goto(base + `edit/map/wall:${wallSector.replace('/', ':')}`)
  await editor.page.waitForSelector('.edit-canvas svg[role=img]')
  check('分區只有岩壁：工具列沒有「範圍／岩壁」切換', (await editor.page.locator('.edit-toolbar button', { hasText: '範圍' }).count()) === 0)
  const otherWallLines = () => editor.page.locator('.edit-canvas .sm-line').count()
  await editor.page.waitForTimeout(1000)
  const linesAtStart = await otherWallLines()
  // 打開就放大到這個分區的岩壁：岩壁佔地圖的寬或高至少三成
  const canvasSize = (await editor.page.locator('.edit-canvas svg[role=img]').boundingBox())!
  const ringBox = await editor.page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.edit-canvas .sm-edit-ring')].map((p) => p.getBoundingClientRect())
    if (!boxes.length) return undefined
    const [l, t, r, b] = [Math.min(...boxes.map((x) => x.left)), Math.min(...boxes.map((x) => x.top)), Math.max(...boxes.map((x) => x.right)), Math.max(...boxes.map((x) => x.bottom))]
    return { w: r - l, h: b - t }
  })
  const fill = ringBox ? Math.max(ringBox.w / canvasSize.width, ringBox.h / canvasSize.height) : 0
  check('岩壁編輯：打開就放大到這個分區的岩壁', fill >= 0.3, `岩壁佔 ${Math.round(fill * 100)}%`)
  const faceSize = await editor.page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.edit-canvas .sm-edit-face')].map((p) => { const b = p.getBoundingClientRect(); return Math.max(b.width, b.height) })))
  check('岩壁編輯：標出岩壁面朝哪一側，箭頭夠大', faceSize >= 14, `箭頭 ${faceSize.toFixed(1)}px`)
  const sectorLink = editor.page.locator('.edit-catalog a', { hasText: gateSectorName }).first()
  check('目錄裡的分區連到岩壁的編輯', ((await sectorLink.getAttribute('href')) ?? '').endsWith(`edit/map/wall:${wallSector.replace('/', ':')}`), (await sectorLink.getAttribute('href')) ?? '')
  const topoTiles = () => editor.page.locator('.sm-topo image').evaluateAll((list) => list.map((i) => i.getAttribute('href') ?? ''))
  // 地形圖只留等高線與海岸線：畫上去的圖裡只有這兩種顏色，沒有黑色的高程點、注記（等圖磚處理到兩種都出現）
  const tileColors = (hrefs: string[]) => editor.page.evaluate(async (hrefs) => {
    const seen = new Set<string>()
    for (const href of hrefs) {
      const img = new Image()
      img.src = href
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    }
    return [...seen]
  }, hrefs)
  // 打開時放大到岩壁，畫面裡不一定有等高線與海岸線：先縮小再看
  const canvasMid = (await editor.page.locator('.edit-canvas svg[role=img]').boundingBox())!
  await editor.page.mouse.move(canvasMid.x + canvasMid.width / 2, canvasMid.y + canvasMid.height / 2)
  for (let i = 0; i < 4; i++) await editor.page.mouse.wheel(0, 400)
  let topo: string[] = []
  const colors =
    (await until(async () => {
      topo = await topoTiles()
      const seen = await tileColors(topo)
      return seen.length >= 2 ? seen : undefined
    })) ?? []
  check('編輯器疊上 1/5000 地形圖，只有等高線與海岸線', topo.length > 0 && colors.length === 2 && colors.every((c) => c === '255,150,40' || c === '60,170,255'), `${topo.length} 張，顏色 ${colors.join(' ')}`)
  await editor.page.keyboard.press('t')
  check('按 T 關掉地形圖', (await until(async () => (await topoTiles()).length === 0, 3000)) === true)
  await editor.page.keyboard.press('t')
  const contourOpacity = await until(async () => {
    const o = await editor.page.locator('.sm-topo').evaluate((g) => Number(getComputedStyle(g).opacity)).catch(() => undefined)
    return o === undefined ? undefined : o
  }, 5000)
  check('等高線畫淡一點（半透明）', contourOpacity !== undefined && contourOpacity < 0.6, String(contourOpacity))
  check('不畫 OpenStreetMap 的岩壁', (await editor.page.locator('.sm-cliff').count()) === 0)
  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.3, 0.4], [0.45, 0.5], [0.6, 0.45]])
  await editor.page.keyboard.press('Enter')
  // 換朝向：剛畫好的線（選中的）點的順序反過來；再翻一次回到預設（朝向步道）
  const selectedPoints = () => editor.page.locator('.edit-canvas .sm-edit-ring.selected').getAttribute('d').then((d) => (d ?? '').slice(1).split('L'))
  const drawn = await selectedPoints()
  await editor.page.keyboard.press('f')
  const flipped = await selectedPoints()
  check('岩壁按 F 換朝向：線反過來', drawn.length === 3 && JSON.stringify(flipped) === JSON.stringify([...drawn].reverse()), `${drawn.join(' ')} → ${flipped.join(' ')}`)
  await editor.page.keyboard.press('f')
  await submitMap(editor.page)
  const wallKey = `wall:${wallSector.replace('/', ':')}`
  const wall = await until(async () => {
    const v = await read<Record<string, { lines: string }>>(`v2/mapEdits/${wallKey}`)
    return v && Object.keys(v).length === 1 ? v : undefined
  })
  const submittedLines = wall ? Object.values(wall)[0].lines.split('|') : []
  check(
    '提交岩壁：資料庫有一版，原始版的線加上新畫的一條三點的線',
    submittedLines.length === (baseWalls.get(wallSector) ?? 0) + 1 && submittedLines.at(-1)!.split(' ').length === 3,
    `${submittedLines.length} 條`,
  )
  // 新畫的岩壁預設朝向最近的步道（岩壁面在線的右手邊，見 aspect.ts）
  const trails = (JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')) as { features: { properties: { kind?: string }; geometry: { coordinates: [number, number][][] } }[] }).features
    .filter((f) => f.properties.kind === 'trail')
    .flatMap((f) => f.geometry.coordinates.map((l) => l.map(([lng, lat]) => project([lat, lng]))))
  const newLine = (submittedLines.at(-1) ?? '').split(' ').map((p) => p.split(',').map(Number) as LatLng)
  check('新畫的岩壁朝向最近的步道', newLine.length === 3 && faceTrail(newLine, trails) === newLine, submittedLines.at(-1))
  // 換到別的分區畫岩壁：地圖停在原處，剛畫的岩壁（別的分區）也畫出來
  const mapTransform = () => editor.page.locator('.edit-canvas svg[role=img] > g[transform]').first().getAttribute('transform')
  const canvasBox = (await editor.page.locator('.edit-canvas svg[role=img]').boundingBox())!
  await editor.page.mouse.move(canvasBox.x + canvasBox.width * 0.8, canvasBox.y + canvasBox.height * 0.8)
  await editor.page.mouse.wheel(0, -300)
  await editor.page.waitForTimeout(300)
  const viewBefore = await mapTransform()
  const otherWallLink = editor.page.locator(`.edit-catalog a[href*="edit/map/wall:"]:not([href$="${wallKey}"])`).first()
  const otherHref = (await otherWallLink.getAttribute('href')) ?? ''
  await otherWallLink.dispatchEvent('click')
  await editor.page.waitForFunction((h) => location.pathname.endsWith(h.slice(h.lastIndexOf('/'))), otherHref)
  await editor.page.waitForTimeout(500)
  check('換到別的分區畫岩壁：放大到那個分區的岩壁', !!viewBefore && (await mapTransform()) !== viewBefore, `${viewBefore} → ${await mapTransform()}`)
  const shownWall = await until(async () => ((await editor.page.locator('.edit-canvas .sm-line').count()) > 0 && (await editor.page.locator('.edit-canvas .sm-sector-label', { hasText: gateSectorName }).count()) > 0 ? true : undefined), 5000)
  check('畫岩壁時，其他分區已有的岩壁也畫出來', shownWall === true)
  const labelOnTop = await editor.page.evaluate(() => {
    const label = document.querySelector('.edit-canvas .sm-sector-label')
    const lines = [...document.querySelectorAll('.edit-canvas .sm-line, .edit-canvas .sm-edit-ring')]
    return !!label && lines.length > 0 && lines.every((l) => l.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  check('分區名稱畫在岩壁線條上面', labelOnTop)
  // 在這個分區畫一段（不提交），換回原來的分區：還沒提交的也畫出來
  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.5, 0.6], [0.6, 0.65]])
  await editor.page.keyboard.press('Enter')
  await editor.page.locator(`.edit-catalog a[href$="${wallKey}"]`).first().dispatchEvent('click')
  await editor.page.waitForFunction((k) => location.pathname.endsWith(k), wallKey)
  const draftShown = await until(async () => ((await otherWallLines()) === linesAtStart + 1 ? true : undefined), 5000)
  check('其他分區還沒提交的岩壁也畫出來', draftShown === true, `${linesAtStart} → ${await otherWallLines()}`)
  // 回到那個分區復原，草稿清掉
  await editor.page.locator(`.edit-catalog a[href$="${otherHref.slice(otherHref.lastIndexOf('/') + 1)}"]`).first().dispatchEvent('click')
  await editor.page.waitForFunction((h) => location.pathname.endsWith(h.slice(h.lastIndexOf('/'))), otherHref)
  await editor.page.keyboard.press('z')
  check('復原後沒有未提交的項目', (await until(async () => ((await editor.page.locator('.edit-pending li').count()) === 0 ? true : undefined), 3000)) === true)
  // 地圖上點別的分區的岩壁：直接換到那個分區編輯，不用先在目錄選
  const canvasNow = (await editor.page.locator('.edit-canvas svg[role=img]').boundingBox())!
  const otherWallAt = await editor.page.evaluate(({ x, y, width, height }) => {
    const canvas = { left: x, top: y, right: x + width, bottom: y + height }
    for (const p of document.querySelectorAll<SVGPathElement>('.edit-canvas .sm-line .sm-line-stroke')) {
      const m = p.getPointAtLength(p.getTotalLength() / 2)
      const s = new DOMPoint(m.x, m.y).matrixTransform(p.getScreenCTM()!)
      if (s.x > canvas.left + 20 && s.x < canvas.right - 20 && s.y > canvas.top + 20 && s.y < canvas.bottom - 20) return { x: s.x, y: s.y }
    }
    return undefined
  }, canvasNow)
  const pathBeforeTap = await editor.page.evaluate(() => location.pathname)
  if (otherWallAt) await editor.page.mouse.click(otherWallAt.x, otherWallAt.y)
  const tapped = await until(async () => {
    const p = await editor.page.evaluate(() => location.pathname)
    return p !== pathBeforeTap && /\/edit\/map\/wall:[^/]+$/.test(p) && (await editor.page.locator('.edit-canvas .sm-edit-ring').count()) > 0 ? p : undefined
  }, 5000)
  check('岩壁編輯：點地圖上別的分區的岩壁，換到那個分區編輯', !!tapped, `${pathBeforeTap} → ${tapped ?? '沒換'}`)
  // 地圖頁：放大到校門口（急救器材 #1 在校門口），分區名稱標在岩壁中間
  await editor.page.goto(base + 'map')
  const gateLabel = await editor.page.waitForSelector('.sm-ems:has(title:text-is("急救器材 #1")) rect', { timeout: 20000 })
  const gateBox = (await gateLabel.boundingBox())!
  await editor.page.mouse.move(gateBox.x + gateBox.width / 2, gateBox.y + gateBox.height / 2)
  for (let i = 0; i < 8; i++) {
    await editor.page.mouse.wheel(0, -300)
    await editor.page.waitForTimeout(150)
  }
  const sectorLabel = await until(async () => ((await editor.page.locator('.sm-sector-label', { hasText: gateSectorName }).count()) > 0 ? true : undefined), 5000)
  check('地圖放大後，分區名稱標在岩壁上', sectorLabel === true)

  // 分區頁的標題卡：和區域頁同一個樣式，右側是放大到這個分區岩壁的地圖
  // 區域頁的標題卡：區域形狀裡畫出所有分區的岩壁（看得出相對位置）
  await editor.page.goto(base + `area/${gate.id}`)
  await editor.page.waitForSelector('.area-hero')
  const wallPaths = () => editor.page.locator('.area-hero svg.area-hero-shape path[stroke-width="3"]').count()
  check('區域頁：標題卡畫出每個分區的岩壁', (await until(async () => ((await wallPaths()) === gate.sectors.length ? true : undefined), 5000)) === true, `${await wallPaths()} / ${gate.sectors.length}`)
  type Box = { x: number; y: number; width: number; height: number }
  const inside = (a: Box, b: Box) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1
  // 線在畫面上的範圍：沿著線取點換成螢幕座標（地圖轉過方向時，getBoundingClientRect 是轉過的外框，比線大）
  const boxes = (selector: string) =>
    editor.page.locator(selector).evaluateAll((els) =>
      (els as SVGPathElement[]).flatMap((el) => {
        const length = el.getTotalLength()
        const m = el.getScreenCTM()
        if (!length || !m) return []
        const pts = Array.from({ length: 201 }, (_, i) => el.getPointAtLength((length * i) / 200).matrixTransform(m))
        const xs = pts.map((p) => p.x)
        const ys = pts.map((p) => p.y)
        return [{ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }]
      }),
    )
  const toolsBottom = async () => {
    const b = (await editor.page.locator('.area-hero-wrap > .page-tools').boundingBox())!
    return b.y + b.height
  }
  // 卡片的大小在載入後還會變（字型、說明），地圖跟著重新擺：等擺好
  const wallsPlaced = async () => {
    const card = (await editor.page.locator('.area-hero').boundingBox())!
    const walls = await boxes('.area-hero svg.area-hero-shape path[stroke-width="3"]')
    const top = await toolsBottom()
    const ok = walls.length > 0 && walls.every((r) => inside(r, card)) && Math.min(...walls.map((r) => r.y)) >= top - 1
    return { ok, detail: JSON.stringify({ card, tools: top, walls: walls.map((r) => [r.x, r.y, r.width, r.height].map(Math.round)) }) }
  }
  const placed = (await until(async () => ((await wallsPlaced()).ok ? true : undefined), 5000)) === true
  check('區域頁：岩壁整個在卡片裡、不在右上的圖示底下', placed, placed ? '' : (await wallsPlaced()).detail)
  const heroCard = (await editor.page.locator('.area-hero').boundingBox())!
  const heroSvg = (await editor.page.locator('.area-hero svg.area-hero-shape').boundingBox())!
  check('區域頁：地圖佔滿卡片的高度（區域的形狀跨到上下緣）', Math.abs(heroSvg.height - heroCard.height) < 2, `${heroSvg.height} / ${heroCard.height}`)
  await editor.page.goto(base + `sector/${wallSector}`)
  await editor.page.waitForSelector('.area-hero')
  check('分區頁：標題卡有分區名稱', ((await editor.page.locator('.area-hero h1').textContent()) ?? '').includes(gateSectorName))
  check('分區頁：地圖放大畫出這個分區的岩壁（粗線）', (await until(async () => ((await editor.page.locator('.area-hero svg.area-hero-shape path[stroke-width="5"]').count()) > 0 ? true : undefined), 5000)) === true)
  // 這個分區的岩壁整個看得到、不在圖示底下；範圍大一點，看得到附近其他的牆
  const [ownBox] = await boxes('.area-hero svg.area-hero-shape path[stroke-width="5"]')
  const sectorCard = (await editor.page.locator('.area-hero').boundingBox())!
  check('分區頁：這個分區的岩壁整個在卡片裡、不在圖示底下', inside(ownBox, sectorCard) && ownBox.y >= (await toolsBottom()) - 1)
  const nearbyWalls = await boxes('.area-hero svg.area-hero-shape path[stroke-width="2"]')
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  check('分區頁：看得到附近其他分區的岩壁', nearbyWalls.some((r) => overlaps(r, sectorCard)))

  // ── 5. Topo 標記：復原、重做、移除最後一點、提交 ─────────────────────
  const photo = 'e2ephoto'
  await put(`v2/topos/${photo}`, { sector: topoSector.id, width: 2000, height: 1200, image: `topos/seed/${photo}.jpg`, uid: 'seed', createdAt: Date.now() })
  await editor.page.goto(base + `edit/topo/${photo}`)
  await editor.page.waitForSelector('.topo-route-row')
  const handles = () => editor.page.locator('.topo-handles circle').count()
  const click = (label: string) => editor.page.locator('.topo-tool', { hasText: label }).click()
  const disabled = (label: string) => editor.page.locator('.topo-tool', { hasText: label }).isDisabled()
  check('沒有修改時：復原、重做都不能按', (await disabled('復原')) && (await disabled('重做')))
  check('預設選了第一條有編號的路線；沒有提示列、第一次使用說明', (await editor.page.locator('.topo-route-row.on').count()) === 1 && (await editor.page.locator('.topo-edit-hint, .topo-help').count()) === 0)
  const row = (number: string) => editor.page.locator('.topo-route-row', { has: editor.page.locator('.topo-route-no', { hasText: new RegExp(`^${number}$`) }) })
  await row(topoRoutes[0].number!).click()
  const frame = (await editor.page.locator('.topo-frame svg').boundingBox())!
  for (const [fx, fy] of [[0.3, 0.8], [0.32, 0.5], [0.3, 0.2]]) await editor.page.mouse.click(frame.x + frame.width * fx, frame.y + frame.height * fy)
  check('點三下：三個點', (await handles()) === 3)
  check('有修改：復原可以按、重做不能', !(await disabled('復原')) && (await disabled('重做')))
  await click('復原')
  check('復原：兩個點', (await handles()) === 2)
  await click('重做')
  check('重做：回到三個點', (await handles()) === 3)
  await editor.page.keyboard.press('Backspace')
  check('Backspace 不再移除最後一點（用復原）：還是三個點', (await handles()) === 3)
  await editor.page.keyboard.press('z')
  check('Z 復原：兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('y')
  check('Y 重做：三個點', (await handles()) === 3)
  await editor.page.keyboard.press('y')
  check('Y 沒有可重做的了：還是三個點', (await handles()) === 3)
  await editor.page.keyboard.press('Control+z')
  check('Ctrl+Z 不是快捷鍵（留給瀏覽器）：還是三個點', (await handles()) === 3)
  // 平移：長按再拖曳、空白鍵拖曳；放開時不會多一個點，普通的拖曳也不會
  await editor.page.keyboard.press('+')
  await editor.page.keyboard.press('+')
  const panBox = (await editor.page.locator('.topo-zoom').boundingBox())!
  const panAt = { x: panBox.x + panBox.width / 2, y: panBox.y + panBox.height / 2 }
  const innerStyle = () => editor.page.locator('.topo-zoom-inner').getAttribute('style')
  const drag = async (hold = 0) => {
    await editor.page.mouse.move(panAt.x, panAt.y)
    await editor.page.mouse.down()
    if (hold) await editor.page.waitForTimeout(hold)
    await editor.page.mouse.move(panAt.x + 40, panAt.y + 20, { steps: 4 })
    await editor.page.mouse.up()
    await editor.page.waitForTimeout(150)
  }
  const style0 = await innerStyle()
  await drag(450)
  check('長按再拖曳：照片平移，放開時不多出一個點', (await innerStyle()) !== style0 && (await handles()) === 3)
  const style1 = await innerStyle()
  await editor.page.mouse.move(panAt.x, panAt.y)
  await editor.page.keyboard.down(' ')
  await drag()
  await editor.page.keyboard.up(' ')
  check('按住空白鍵拖曳：照片平移，放開時不多出一個點', (await innerStyle()) !== style1 && (await handles()) === 3)
  const style2 = await innerStyle()
  await drag()
  check('普通的拖曳（沒按空白、沒長按）：照片不動，也不多出一個點', (await innerStyle()) === style2 && (await handles()) === 3)
  await editor.page.mouse.click(panAt.x, panAt.y)
  check('平移之後，普通的點一下照樣加一個點', (await handles()) === 4)
  await editor.page.keyboard.press('z')
  await editor.page.keyboard.press('0')
  check('復原剛加的點：回到三個點', (await handles()) === 3)
  // 點在線段中間：插進那一段（第二個把手落在點的位置），不是接在線尾
  const midBox = (await editor.page.locator('.topo-frame svg').boundingBox())!
  await editor.page.mouse.click(midBox.x + midBox.width * 0.31, midBox.y + midBox.height * 0.65)
  const inserted = (await editor.page.locator('.topo-handles circle').nth(1).boundingBox())!
  check('點在線段中間：插進那一段（四個點，新的點排第二個）', (await handles()) === 4 && Math.abs(inserted.y + inserted.height / 2 - (midBox.y + midBox.height * 0.65)) < 4, `${await handles()} 個點`)
  await editor.page.keyboard.press('z')
  check('復原插入的點：回到三個點', (await handles()) === 3)

  // ── 手機（觸控）：單指點、拖、刪除點，雙指捏合縮放，放大後單指平移 ──
  const phone = await newContext(undefined, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await signIn(phone.page, 'phone@example.com')
  // 從主畫面開啟的 App（display-mode: standalone）：登入整頁跳轉、不開視窗，回到「我的」直接是已登入（不用重新整理）
  // 模擬器的登入頁在手機寬度排不下輸入框；是不是主畫面 App 和寬度無關，用預設的寬度
  const homeApp = await newContext()
  await homeApp.ctx.addInitScript(`
    const mm = window.matchMedia.bind(window)
    window.matchMedia = (q) => {
      const list = mm(q)
      if (q.includes('display-mode: standalone')) Object.defineProperty(list, 'matches', { value: true })
      return list
    }
  `)
  let homeAppPopups = 0
  homeApp.page.on('popup', () => homeAppPopups++)
  await homeApp.page.goto(base + 'me')
  await homeApp.page.click('.signin-prompt .action.primary')
  await homeApp.page.waitForURL(/emulator\/auth/, { timeout: 20000 })
  await homeApp.page.waitForLoadState()
  await homeApp.page.click('text=Add new account')
  await homeApp.page.fill('#email-input', 'homeapp@example.com')
  await homeApp.page.fill('#display-name-input', 'homeapp')
  await homeApp.page.click('#sign-in')
  const homeAppSignedIn = await homeApp.page.waitForSelector('.me-m .profile-head', { timeout: 20000 }).then(() => true, () => false)
  check('主畫面 App 登入：整頁跳轉（不開視窗），回到「我的」直接是已登入', homeAppSignedIn && homeAppPopups === 0 && new URL(homeApp.page.url()).pathname.endsWith('/me'), homeApp.page.url())
  await homeApp.ctx.close()
  await put('v2/topos/e2ephone', { sector: topoSector.id, width: 2000, height: 1200, image: 'topos/seed/e2ephone.jpg', uid: 'seed', createdAt: Date.now() })
  await phone.page.goto(base + 'edit/topo/e2ephone')
  await phone.page.waitForSelector('dialog.topo-phone[open] .topo-phone-title')
  check('手機寬度也能編輯 Topo（不是「請用電腦」）', (await phone.page.locator('.topo-zoom').count()) === 1 && (await phone.page.locator('.edit-message').count()) === 0)
  check('手機：Topo 編輯器是整個畫面：上面一排是關閉、目前的路線、底色、提交，沒有電腦版的工具列', (await phone.page.locator('.topo-phone-top .topo-phone-close').count()) === 1 && (await phone.page.locator('.topo-phone-top .topo-phone-title').count()) === 1 && (await phone.page.locator('.topo-phone-top .topo-gray-btn').count()) === 1 && (await phone.page.locator('.topo-phone-top .topo-phone-submit').count()) === 1 && (await phone.page.locator('.topo-edit-toolbar').count()) === 0)
  const covered = await phone.page.evaluate(`document.elementFromPoint(195, 830)?.closest('dialog.topo-phone') !== null`)
  check('手機：編輯畫面蓋住底部導覽（整個畫面給這個項目）', covered === true)
  check('手機：沒有快捷鍵提示', (await phone.page.locator('.topo-phone kbd').count()) === 0)
  // 照片固定滿版（和 Climbio 的定線一樣）：沒有下面的路線清單、分隔線、全畫面按鈕
  const viewH = phone.page.viewportSize()!.height
  const phonePhoto = (await phone.page.locator('.topo-phone-photo').boundingBox())!
  const fullPane = (await phone.page.locator('.topo-zoom').boundingBox())!
  check('手機：照片固定佔滿整個畫面（沒有下面的路線清單）', phonePhoto.y <= 1 && phonePhoto.height >= viewH - 2 && fullPane.height >= viewH - 2 && (await phone.page.locator('.topo-phone-list, .topo-split').count()) === 0, `${phonePhoto.y} ${phonePhoto.height}/${viewH}`)
  const floatBox = (await phone.page.locator('.topo-float').boundingBox())!
  check('手機：工具浮在照片右下角', floatBox.x + floatBox.width >= phonePhoto.x + phonePhoto.width - 20 && floatBox.y + floatBox.height >= phonePhoto.y + phonePhoto.height - 60, `${floatBox.x},${floatBox.y}`)
  // 上面一排：和 Climbio 定線一樣的圓鈕（一樣大、離上緣 12），右上是提交（✓）
  const topSizes = await phone.page.locator('.topo-phone-top .topo-round').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)}` }))
  const submitBox = (await phone.page.locator('.topo-phone-submit').boundingBox())!
  check('手機：上面一排是一樣大的圓鈕（46 像素、離上緣 12），提交在最右邊', topSizes.length === 3 && topSizes.every((v) => v === '46x46@12') && submitBox.x + submitBox.width >= phonePhoto.x + phonePhoto.width - 14, topSizes.join(' '))
  // 下面只有一層、只放手機修改要用的：左邊選工具（畫線、Bolt），右邊復原；沒有「更多」、裁切、修改記錄
  const modeNames = await phone.page.locator('.topo-modes button').allTextContents()
  check('手機：左下選工具（畫線、Bolt），右下復原；沒有「更多」、裁切、修改記錄', modeNames.join(',') === '畫線,Bolt' && (await phone.page.locator('.topo-float').getByRole('button', { name: '復原' }).count()) === 1 && (await phone.page.getByRole('button', { name: '更多' }).count()) === 0 && (await phone.page.locator('.topo-phone .edit-history-toggle, .topo-phone .topo-crop').count()) === 0, modeNames.join(','))
  const toolSizes = await phone.page.locator('.topo-float .topo-float-btn, .topo-modes').evaluateAll((els) => els.map((e) => Math.round(Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height))))
  check('手機：下面的按鈕都夠大（至少 44 像素）', toolSizes.length >= 2 && toolSizes.every((v) => v >= 44), toolSizes.join(','))
  const modesBox = (await phone.page.locator('.topo-modes').boundingBox())!
  check('手機：下面的工具只有一排（選工具和復原在同一高度）', Math.abs(modesBox.y + modesBox.height - (floatBox.y + floatBox.height)) < 2, `${modesBox.y + modesBox.height} / ${floatBox.y + floatBox.height}`)
  // 工作區是整個畫面：放大後照片蓋滿整個畫面（不是只有照片比例的一條）
  await phone.page.locator('.topo-zoom-fit').dispatchEvent('click')
  await phone.page.waitForTimeout(400)
  const fitFrame = (await phone.page.locator('.topo-frame svg').boundingBox())!
  const fullCdp = await phone.ctx.newCDPSession(phone.page)
  const fc = { x: fullPane.x + fullPane.width / 2, y: fullPane.y + fullPane.height / 2 }
  await fullCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fc.x - 10, y: fc.y, id: 1 }, { x: fc.x + 10, y: fc.y, id: 2 }] })
  for (let step = 1; step <= 10; step++) await fullCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fc.x - 10 - 12 * step, y: fc.y, id: 1 }, { x: fc.x + 10 + 12 * step, y: fc.y, id: 2 }] })
  await fullCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await phone.page.waitForTimeout(200)
  const covered4 = await shownPhoto(phone.page)
  check('手機：工作區（縮放區）佔滿整個畫面，放大後照片蓋滿整個畫面', fitFrame.height < fullPane.height - 100 && covered4.height >= fullPane.height - 2 && covered4.width >= fullPane.width - 2, `縮放區 ${fullPane.height}，照片 ${fitFrame.height} → 看得到 ${covered4.width}×${covered4.height}`)
  await phone.page.locator('.topo-zoom-fit').dispatchEvent('click')
  // 換路線：點上面的路線名稱，從下方打開路線清單；選了就收起來
  await phone.page.locator('.topo-phone-title').click()
  check('手機：點上面的路線名稱，從下方打開路線清單（只有面板一層捲動）', (await phone.page.locator('.topo-sheet .topo-phone-list .topo-route-row').count()) > 1 && (await phone.page.locator('.topo-sheet .topo-route-list').evaluate((el) => getComputedStyle(el).overflowY)) === 'visible')
  await phone.page.locator('.topo-sheet .topo-route-row', { has: phone.page.locator('.topo-route-no', { hasText: new RegExp(`^${topoRoutes[0].number}$`) }) }).click()
  check('手機：在清單選路線，清單收起來，上面顯示選到的路線', (await phone.page.locator('.topo-sheet').count()) === 0 && (await phone.page.locator('.topo-phone-title b').textContent()) === topoRoutes[0].number)
  // 底色：預設灰階（線比較清楚），可以切回原色
  const imgFilter = () => phone.page.locator('.topo-phone-photo .topo-frame > img').evaluate((el) => getComputedStyle(el).filter)
  check('手機：照片預設是灰階底色', (await phone.page.locator('.topo-gray-btn').getAttribute('aria-pressed')) === 'true' && (await imgFilter()).includes('grayscale'), await imgFilter())
  await phone.page.locator('.topo-gray-btn').click()
  check('手機：按底色切換回到原色', (await phone.page.locator('.topo-gray-btn').getAttribute('aria-pressed')) === 'false' && (await imgFilter()) === 'none', await imgFilter())
  await phone.page.locator('.topo-gray-btn').click()
  const cdp = await phone.ctx.newCDPSession(phone.page)
  type Finger = { x: number; y: number; id: number }
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Finger[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : fingers })
  const phoneHandles = () => phone.page.locator('.topo-handles circle')
  const phoneFrame = async () => (await phone.page.locator('.topo-frame svg').boundingBox())!
  const centerOf = async (i: number) => {
    const b = (await phoneHandles().nth(i).boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  let pb = await phoneFrame()
  // 還沒按「畫線」：點照片不加點（看照片、縮放時不會誤加）
  await phone.page.touchscreen.tap(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5)
  await phone.page.waitForTimeout(300)
  check('手機：還沒按「畫線」，點照片不會加點', (await phoneHandles().count()) === 0)
  await phone.page.getByRole('button', { name: '畫線' }).click()
  await phone.page.waitForTimeout(300)
  pb = await phoneFrame()
  for (const [fx, fy] of [[0.3, 0.8], [0.35, 0.5], [0.3, 0.2]]) await phone.page.touchscreen.tap(pb.x + pb.width * fx, pb.y + pb.height * fy)
  check('手機：用手指點三下，標了三個點', (await phoneHandles().count()) === 3)
  const revealed = await phone.page.locator('.topo-reveal image').count()
  await phone.page.locator('.topo-gray-btn').click()
  const revealedPlain = await phone.page.locator('.topo-reveal').count()
  await phone.page.locator('.topo-gray-btn').click()
  check('手機：灰階底上，選到的路線周圍疊回原色的照片；原色底時不疊', revealed === 1 && revealedPlain === 0, `${revealed} / ${revealedPlain}`)
  const lineColor = await phone.page.locator('.topo-route.on .topo-line').first().evaluate((el) => getComputedStyle(el).stroke)
  const handleStyles = await phoneHandles().evaluateAll((els) => els.map((el) => `${getComputedStyle(el).fill}|${getComputedStyle(el).stroke}`))
  check('手機：點是小小的實心點、和線同色（起點也一樣、沒有白框），手指按得到的範圍比較大', ((await phoneHandles().first().boundingBox())!.width) <= 12 && ((await phone.page.locator('.topo-hits circle').first().boundingBox())!.width) >= 40 && handleStyles.every((v) => v === `${lineColor}|none`), `${lineColor} / ${handleStyles.join(' ')}`)
  const whiteFrames = await phone.page.locator('.topo-badge rect, .topo-bolt rect, .topo-dot, .topo-handles circle').evaluateAll((els) => els.filter((el) => /255, 255, 255|#fff/.test(getComputedStyle(el).stroke)).length)
  check('手機：所有的標記（編號、bolt、起點、點）都沒有白框', whiteFrames === 0, `${whiteFrames}`)
  check('手機：編輯時線上不顯示難度、名稱（不和點疊在一起）', (await phone.page.locator('.topo-phone .topo-note').count()) === 0)
  // 按住不動：出現放大鏡，滑動對準，放開才放點（只放一個）
  pb = await phoneFrame()
  const aimFrom = { x: pb.x + pb.width * 0.6, y: pb.y + pb.height * 0.6 }
  const aimTo = { x: aimFrom.x + 24, y: aimFrom.y + 12 }
  await touch('touchStart', [{ ...aimFrom, id: 1 }])
  await phone.page.waitForTimeout(400)
  const loupeShown = await phone.page.locator('.topo-loupe').isVisible()
  for (let step = 1; step <= 4; step++) await touch('touchMove', [{ x: aimFrom.x + 6 * step, y: aimFrom.y + 3 * step, id: 1 }])
  await phone.page.waitForTimeout(100)
  const loupeBox = (await phone.page.locator('.topo-loupe').boundingBox())!
  await touch('touchEnd', [])
  await phone.page.waitForTimeout(400)
  const aimedAt = await phoneHandles().evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
  const loupeGap = aimTo.y - (loupeBox.y + loupeBox.height)
  check('手機：按住照片出現放大鏡（在手指正上方、不被手指擋住），滑動後放開，點放在放開的位置，只多一個點', loupeShown && Math.abs(loupeBox.x + loupeBox.width / 2 - aimTo.x) < 10 && loupeGap >= 24 && loupeGap <= 60 && aimedAt.length === 4 && aimedAt.some((c) => Math.hypot(c.x - aimTo.x, c.y - aimTo.y) < 4) && (await phone.page.locator('.topo-loupe').count()) === 0, `${aimedAt.length} 個點，放大鏡離手指 ${loupeGap}，水平差 ${loupeBox.x + loupeBox.width / 2 - aimTo.x}`)
  await phone.page.keyboard.press('z')
  // 單指拖曳把手：移動把手，不是捲動頁面、平移照片
  const before = await centerOf(1)
  await touch('touchStart', [{ ...before, id: 1 }])
  for (let step = 1; step <= 5; step++) await touch('touchMove', [{ x: before.x + 6 * step, y: before.y + 4 * step, id: 1 }])
  const dragLoupe = await phone.page.locator('.topo-loupe').isVisible()
  await touch('touchEnd', [])
  check('手機：拖曳點的時候有放大鏡，放開就收起來', dragLoupe && (await phone.page.locator('.topo-loupe').count()) === 0)
  // 緊接著的下一次點擊，Chrome 的手勢辨識（雙擊的時間窗）不會產生 click：真人的兩次操作之間不會這麼快
  await phone.page.waitForTimeout(400)
  const after = await centerOf(1)
  check('手機：單指拖曳把手，點跟著手指移動', Math.abs(after.x - before.x - 30) < 3 && Math.abs(after.y - before.y - 20) < 3 && (await phoneHandles().count()) === 3, `${after.x - before.x},${after.y - before.y}`)
  // 按住的點可以刪除（手指沒有右鍵）
  const deleteTool = phone.page.getByRole('button', { name: '刪除這個點' })
  pb = await phoneFrame()
  await phone.page.touchscreen.tap(pb.x + pb.width * 0.75, pb.y + pb.height * 0.35)
  check('手機：點了照片的空白處，原本按住的點取消選取，沒有刪除鈕', (await deleteTool.count()) === 0 && (await phoneHandles().count()) === 4, `${await deleteTool.count()} ${await phoneHandles().count()}`)
  await phone.page.keyboard.press('z')
  const target = await centerOf(1)
  await phone.page.touchscreen.tap(target.x, target.y)
  check('手機：點一下把手就選取它（不會多一個點）', (await phone.page.locator('.topo-handles circle.picked').count()) === 1 && (await phoneHandles().count()) === 3 && (await deleteTool.count()) === 1)
  await phone.page.waitForTimeout(500)
  const pickZoom = Number.parseInt((await phone.page.locator('.topo-zoom-fit').textContent()) ?? '100')
  const pickedNow = (await phone.page.locator('.topo-handles circle.picked').boundingBox())!
  const paneNow = (await phone.page.locator('.topo-zoom').boundingBox())!
  check('手機：選了點自動放大到點附近（方便調整），點在畫面裡', pickZoom >= 250 && pickedNow.x > paneNow.x && pickedNow.x < paneNow.x + paneNow.width && pickedNow.y > paneNow.y && pickedNow.y < paneNow.y + paneNow.height, `${pickZoom}%`)
  await deleteTool.click()
  check('手機：「刪除這個點」刪掉選取的點，刪除鈕收起來', (await phoneHandles().count()) === 2 && (await deleteTool.count()) === 0)
  await phone.page.locator('.topo-zoom-fit').dispatchEvent('click')
  await phone.page.waitForTimeout(400)
  // 按在點旁邊（看得到的點之外、觸控範圍之內）也算按到它：選取，不多出一個點
  const near = await centerOf(0)
  await phone.page.touchscreen.tap(near.x + 30, near.y)
  await phone.page.waitForTimeout(400)
  check('手機：按在點旁邊 30 像素（看得到的點之外；瀏覽器自己就會多算十幾像素）也選到這個點，不多一個點', (await phone.page.locator('.topo-handles circle.picked').count()) === 1 && (await phoneHandles().count()) === 2, `${await phoneHandles().count()} 個點`)
  // 雙指捏合：縮放，不多出一個點（先回到整張：選點時自動放大過）
  await phone.page.locator('.topo-zoom-fit').dispatchEvent('click')
  await phone.page.waitForTimeout(400)
  const zoomText = () => phone.page.locator('.topo-zoom-fit').textContent()
  pb = await phoneFrame()
  const mid = { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 }
  await touch('touchStart', [{ x: mid.x - 20, y: mid.y, id: 1 }, { x: mid.x + 20, y: mid.y, id: 2 }])
  for (let step = 1; step <= 6; step++) await touch('touchMove', [{ x: mid.x - 20 - 8 * step, y: mid.y, id: 1 }, { x: mid.x + 20 + 8 * step, y: mid.y, id: 2 }])
  await touch('touchEnd', [])
  await phone.page.waitForTimeout(200)
  const zoomedTo = Number.parseInt((await zoomText()) ?? '100')
  check('手機：雙指張開，照片放大；放開時不多出一個點', zoomedTo > 150 && (await phoneHandles().count()) === 2, `${zoomedTo}%`)
  // 放大後單指在空白處拖曳：平移照片，不多出一個點
  const innerNow = () => phone.page.locator('.topo-zoom-inner').getAttribute('style')
  const panBefore = await innerNow()
  const pa = { x: mid.x, y: mid.y }
  await touch('touchStart', [{ ...pa, id: 1 }])
  for (let step = 1; step <= 5; step++) await touch('touchMove', [{ x: pa.x + 8 * step, y: pa.y + 4 * step, id: 1 }])
  await touch('touchEnd', [])
  await phone.page.waitForTimeout(200)
  check('手機：放大後單指拖曳空白處，照片平移，不多出一個點', (await innerNow()) !== panBefore && (await phoneHandles().count()) === 2)
  // 平移之後遲到的 click（不論多晚）都不當作點了一下；下一次真的點一下照樣加一個點
  await phone.page.waitForTimeout(400)
  await phone.page.evaluate(`(() => {
    const r = document.querySelector('.topo-frame svg').getBoundingClientRect()
    document.querySelector('.topo-frame svg').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: r.left + r.width * 0.7, clientY: r.top + r.height * 0.3 }))
  })()`)
  check('手機：平移之後很晚才來的 click 不會多出一個點', (await phoneHandles().count()) === 2, `${await phoneHandles().count()} 個點`)
  const paneBox = await shownPhoto(phone.page)
  const emptySpot = { x: paneBox.x + paneBox.width * 0.6, y: paneBox.y + paneBox.height * 0.4 }
  // 兩下隔開一點（不是點兩下）
  await phone.page.touchscreen.tap(emptySpot.x, emptySpot.y)
  await phone.page.waitForTimeout(500)
  await phone.page.touchscreen.tap(emptySpot.x, emptySpot.y)
  await phone.page.waitForTimeout(300)
  check('手機：平移之後，下一次真的點一下照樣加一個點', (await phoneHandles().count()) === 3, `${await phoneHandles().count()} 個點`)
  // 點兩下回到原尺寸（手機不顯示倍率）：畫線中點兩下也不會多出點（先雙指放大）
  pb = await phoneFrame()
  const pm = { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 }
  await touch('touchStart', [{ x: pm.x - 20, y: pm.y, id: 1 }, { x: pm.x + 20, y: pm.y, id: 2 }])
  for (let step = 1; step <= 6; step++) await touch('touchMove', [{ x: pm.x - 20 - 8 * step, y: pm.y, id: 1 }, { x: pm.x + 20 + 8 * step, y: pm.y, id: 2 }])
  await touch('touchEnd', [])
  await phone.page.waitForTimeout(400)
  const zoomedBefore = Number.parseInt((await zoomText()) ?? '100')
  const dbl = { x: emptySpot.x - 40, y: emptySpot.y + 30 }
  for (let i = 0; i < 2; i++) {
    await touch('touchStart', [{ ...dbl, id: 1 }])
    await touch('touchEnd', [])
    await phone.page.waitForTimeout(80)
  }
  await phone.page.waitForTimeout(500)
  check('手機：點兩下回到原尺寸，畫線中也不會多出點；沒有倍率、縮放按鈕', zoomedBefore > 100 && (await zoomText()) === '100%' && (await phoneHandles().count()) === 3 && !(await phone.page.locator('.topo-phone .topo-zoom-controls').isVisible()), `${zoomedBefore}% → ${await zoomText()}，${await phoneHandles().count()} 個點`)
  await phone.page.screenshot({ path: process.env.PHONE_SHOT ?? 'dist-e2e/phone.png' })
  // 照片的下緣可以往上拖到下面工具的上面（最下面也能編輯），不會拖過頭
  // 先放大到照片比畫面高
  const pz = await phoneFrame()
  const pzm = { x: pz.x + pz.width / 2, y: Math.min(pz.y + pz.height / 2, 400) }
  await touch('touchStart', [{ x: pzm.x, y: pzm.y - 20, id: 1 }, { x: pzm.x, y: pzm.y + 20, id: 2 }])
  for (let step = 1; step <= 8; step++) await touch('touchMove', [{ x: pzm.x, y: pzm.y - 20 - 25 * step, id: 1 }, { x: pzm.x, y: pzm.y + 20 + 25 * step, id: 2 }])
  await touch('touchEnd', [])
  await phone.page.waitForTimeout(300)
  // 從離線上的點最遠的地方開始拖（不會拖到點）
  const handlesNow = await phoneHandles().evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
  const up = [60, 195, 330]
    .flatMap((x) => [560, 640, 700].map((y) => ({ x, y })))
    .map((c) => ({ c, d: Math.min(Infinity, ...handlesNow.map((h) => Math.hypot(h.x - c.x, h.y - c.y))) }))
    .sort((a, b) => b.d - a.d)[0].c
  await touch('touchStart', [{ ...up, id: 1 }])
  for (let step = 1; step <= 12; step++) await touch('touchMove', [{ x: up.x, y: up.y - 50 * step, id: 1 }])
  await touch('touchEnd', [])
  await phone.page.waitForTimeout(300)
  const photoBottom = (await phoneFrame()).y + (await phoneFrame()).height
  const toolsTop = (await phone.page.locator('.topo-modes').boundingBox())!.y
  check('手機：照片的下緣可以往上拖到下面工具的上面，不會拖過頭；不多出點', photoBottom <= toolsTop && photoBottom > toolsTop - 30 && (await phoneHandles().count()) === 3, `照片下緣 ${Math.round(photoBottom)}，工具上緣 ${Math.round(toolsTop)}，${await phoneHandles().count()} 個點`)
  // 一根手指按在點上、接著第二根手指捏合：放開後點一下照片照樣加點（拖曳點的狀態不會卡住）
  // 畫面中間看得到的點（上下浮著的按鈕之外）
  const visiblePoints = await phoneHandles().evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
  const onPoint = visiblePoints.find((p) => p.y > 120 && p.y < 680 && p.x > 20 && p.x < 300) ?? visiblePoints[0]
  await touch('touchStart', [{ ...onPoint, id: 1 }])
  await touch('touchStart', [{ ...onPoint, id: 1 }, { x: onPoint.x + 60, y: onPoint.y + 60, id: 2 }])
  for (let step = 1; step <= 4; step++) await touch('touchMove', [{ ...onPoint, id: 1 }, { x: onPoint.x + 60 + 10 * step, y: onPoint.y + 60 + 10 * step, id: 2 }])
  await touch('touchEnd', [])
  await phone.page.waitForTimeout(500)
  const handlesAfter = await phoneHandles().evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
  const free = [60, 195, 330]
    .flatMap((x) => [200, 400, 600].map((y) => ({ x, y })))
    .map((c) => ({ c, d: Math.min(Infinity, ...handlesAfter.map((h) => Math.hypot(h.x - c.x, h.y - c.y))) }))
    .sort((a, b) => b.d - a.d)[0].c
  const countBefore = await phoneHandles().count()
  await phone.page.touchscreen.tap(free.x, free.y)
  await phone.page.waitForTimeout(400)
  check('手機：從點上開始捏合之後，點一下照片照樣加一個點', (await phoneHandles().count()) === countBefore + 1, `${countBefore} → ${await phoneHandles().count()} 個點`)
  await phone.page.locator('.topo-float').getByRole('button', { name: '復原' }).click()
  await phone.page.waitForTimeout(200)
  // 再按一次「畫線」結束畫線：回到選路線，點照片不再加點
  check('手機：畫線時「畫線」亮著', (await phone.page.locator('.topo-modes button[aria-pressed="true"]').textContent()) === '畫線')
  await phone.page.locator('.topo-modes button[aria-pressed="true"]').click()
  await phone.page.waitForTimeout(500)
  check('手機：再按一次「畫線」結束，自動縮放到整條路線', Number.parseInt((await phone.page.locator('.topo-zoom-fit').textContent()) ?? '0') < 600)
  await phone.page.locator('.topo-zoom-fit').dispatchEvent('click')
  await phone.page.waitForTimeout(400)
  let pf = await phoneFrame()
  await phone.page.touchscreen.tap(pf.x + pf.width * 0.8, pf.y + pf.height * 0.6)
  await phone.page.waitForTimeout(300)
  check('手機：結束畫線之後點照片不加點，沒有工具亮著', (await phoneHandles().count()) === 3 && (await phone.page.locator('.topo-modes button[aria-pressed="true"]').count()) === 0, `${await phoneHandles().count()} 個點`)
  // Bolt 和線分開：按 Bolt，選位置（照片上浮著一排），點照片放下
  await phone.page.getByRole('button', { name: 'Bolt' }).click()
  await phone.page.waitForTimeout(500)
  // 放大後照片比畫面大：位置以看得到的那一塊照片為準
  pf = await shownPhoto(phone.page)
  const chips = phone.page.locator('.topo-float-chips .chip')
  const chipCount = await chips.count()
  // 點在離線上的點最遠的地方（不會按到點）
  const handleAt = await phoneHandles().evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
  const spots = [0.15, 0.5, 0.85].flatMap((fx) => [0.2, 0.5, 0.8].map((fy) => ({ x: pf.x + pf.width * fx, y: pf.y + pf.height * fy })))
  // 浮著的按鈕下面不算（點不到照片）
  const onPhoto = (await phone.page.evaluate((cs) => cs.map((c) => !!document.elementFromPoint(c.x, c.y)?.closest('.topo-frame')), spots)) as boolean[]
  const boltSpot = spots
    .filter((_, i) => onPhoto[i])
    .map((c) => ({ c, d: Math.min(Infinity, ...handleAt.map((h) => Math.hypot(h.x - c.x, h.y - c.y))) }))
    .sort((a, b) => b.d - a.d)[0].c
  await phone.page.touchscreen.tap(boltSpot.x, boltSpot.y)
  await phone.page.waitForTimeout(300)
  check('手機：Bolt 一排位置浮在照片上，點照片放下第一顆（和線的點分開）', chipCount > 0 && (await phone.page.locator('.topo-handles rect.bolt').count()) === 1 && (await phoneHandles().count()) === 3, `${chipCount} 個位置，${await phone.page.locator('.topo-handles rect.bolt').count()} 顆 bolt，${await phoneHandles().count()} 個點`)
  await phone.page.locator('.topo-modes button[aria-pressed="true"]').click()
  check('手機：再按一次 Bolt 結束放 bolt', (await phone.page.locator('.topo-modes button[aria-pressed="true"]').count()) === 0 && (await phone.page.locator('.topo-float-chips').count()) === 0)
  // 路線清單打開時返回（Esc），只關掉清單
  await phone.page.locator('.topo-phone-title').click()
  await phone.page.keyboard.press('Escape')
  check('手機：路線清單打開時按返回（Esc），只關掉清單，編輯器還在', (await phone.page.locator('.topo-sheet').count()) === 0 && (await phone.page.locator('dialog.topo-phone[open]').count()) === 1 && new URL(phone.page.url()).pathname.endsWith('/edit/topo/e2ephone'), phone.page.url())
  // 關閉：回到編輯模式的目錄（草稿留在這台裝置）
  await phone.page.locator('.topo-phone-close').click()
  check('手機：關閉 Topo 編輯器回到目錄', (await until(async () => (new URL(phone.page.url()).pathname.replace(/\/$/, '').endsWith('/edit') ? true : undefined), 5000)) === true && (await phone.page.locator('dialog.topo-phone').count()) === 0, phone.page.url())
  // 手機的目錄：分區下有「新增 Topo 照片」（手機也能上傳）
  await phone.page.goto(base + 'edit')
  await phone.page.waitForSelector('.edit-catalog')
  check('手機：目錄的分區下有上傳 Topo 照片的按鈕', (await phone.page.locator('.edit-catalog .topo-upload').count()) > 0)
  // 新增照片時先裁切：選了照片出現裁切畫面，拖曳右下角縮小，按「上傳」，存的是裁切過的照片
  const topoIdsBefore = new Set(Object.keys((await read<Record<string, unknown>>('v2/topos')) ?? {}))
  const png = Buffer.from(
    (await phone.page.evaluate(`(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#7a6a5a'; g.fillRect(0, 0, 800, 600); g.fillStyle = '#c33'; g.fillRect(0, 0, 400, 300); return c.toDataURL('image/png').split(',')[1] })()`)) as string,
    'base64',
  )
  await phone.page.locator('.edit-catalog .topo-upload input[type=file]').first().setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: png })
  await phone.page.waitForSelector('dialog.topo-upload-crop[open] .topo-crop-handle', { timeout: 5000 })
  check('手機：新增照片時先出現裁切畫面（還沒上傳）', (await phone.page.getByRole('button', { name: '上傳' }).count()) === 1 && Object.keys((await read<Record<string, unknown>>('v2/topos')) ?? {}).length === topoIdsBefore.size)
  const corner = (await phone.page.locator('.topo-crop-handle').nth(4).boundingBox())!
  const cropFrame = (await phone.page.locator('.topo-upload-crop-frame').boundingBox())!
  const cropCdp = await phone.ctx.newCDPSession(phone.page)
  const from = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }
  const to = { x: cropFrame.x + cropFrame.width / 2, y: cropFrame.y + cropFrame.height / 2 }
  await cropCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
  for (let step = 1; step <= 6; step++) await cropCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6, id: 1 }] })
  await cropCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await phone.page.getByRole('button', { name: '上傳' }).click()
  const uploaded = await until(async () => {
    const all = (await read<Record<string, { width: number; height: number }>>('v2/topos')) ?? {}
    return Object.entries(all).find(([k]) => !topoIdsBefore.has(k))
  })
  check('手機：裁切後上傳，存的是裁切過的照片（左上那一半），接著打開那張照片的編輯', !!uploaded && Math.abs(uploaded[1].width - 400) <= 8 && Math.abs(uploaded[1].height - 300) <= 8 && (await until(async () => (await phone.page.locator('dialog.topo-phone[open] .topo-phone-title').count()) === 1 || undefined, 10000)) === true, uploaded ? `${uploaded[1].width}×${uploaded[1].height}` : '沒有上傳')
  if (uploaded) await fetch(url(`v2/topos/${uploaded[0]}`), { method: 'DELETE', ...asOwner })
  await phone.ctx.close()
  // 這張照片只給手機測試用：後面的測試以「分區只有一張照片」為前提
  await fetch(url('v2/topos/e2ephone'), { method: 'DELETE', ...asOwner })
  await editor.page.keyboard.press('ArrowDown')
  const next = topoSector.routes[topoSector.routes.findIndex((r) => r.id === topoRoutes[0].id) + 1]
  check('↓ 換到清單裡的下一條路線', (await editor.page.locator('.topo-route-row.on .topo-route-no').textContent()) === (next.number ?? '·'))
  await editor.page.keyboard.press('ArrowUp')
  await editor.page.click('.topo-edit-toolbar .edit-btn.primary')
  const key = topoRoutes[0].id.replace(/\//g, ':').replace(/\./g, ',')
  const edit = await until(async () => {
    const v = await read<Record<string, { routes: Record<string, { line: string }> }>>(`v2/topoEdits/${photo}`)
    return v && Object.keys(v).length === 1 ? Object.values(v)[0] : undefined
  })
  check('提交 Topo：資料庫有一版、第一條路線三個點', !!edit && edit.routes[key]?.line.split(' ').length === 3)

  // ── 5a. 右側面板：Topo 的路線清單與快捷鍵在面板裡；兩側面板可以收起、從窄條展開 ──
  check('Topo：路線清單在右側面板', (await editor.page.locator('.edit-panel .topo-route-row').count()) > 0)
  check('目錄沒有「步道與攀岩者路徑」', (await editor.page.locator('.edit-catalog', { hasText: '步道與攀岩者路徑' }).count()) === 0)
  check('Topo 右側面板上方沒有區域資訊（沒有標題）', (await editor.page.locator('.edit-panel > h2').count()) === 0 || ((await editor.page.locator('.edit-panel > h2').first().textContent()) ?? '').includes('快捷鍵'))
  check('Topo 的提交在上方工具列（和地圖一樣在右側）', (await editor.page.locator('.topo-edit-toolbar .edit-btn.primary').count()) === 1 && (await editor.page.locator('.edit-panel .edit-btn.primary, .edit-panel .action.primary').count()) === 0)
  check('上方按鈕與右側快捷鍵不重複：右側清單沒有按鈕（只剩沒有按鈕的右鍵）', (await editor.page.locator('.edit-panel .key-list button.key-row').count()) === 0 && (await editor.page.locator('.edit-panel .key-row.info').count()) === 1)
  check('工具列按鈕標示按鍵', (await editor.page.locator('.topo-edit-toolbar .topo-tool kbd').count()) >= 4)
  check('工具列是「路線」（不是「線段」），沒有「移除最後一點」', (await editor.page.locator('.topo-tool', { hasText: '路線' }).count()) >= 1 && (await editor.page.locator('.topo-tool', { hasText: /線段|移除最後一點/ }).count()) === 0)
  check('工具列只有一層：裁切、分岔、清除路線、捨棄都在同一列，沒有「更多」選單', (await editor.page.locator('.topo-edit-toolbar .topo-tool', { hasText: /裁切|分岔|清除|捨棄/ }).count()) === 4 && (await editor.page.locator('.edit-more, .edit-more-btn, .topo-edit-subbar').count()) === 0)
  await editor.page.keyboard.press('b')
  check('選 Bolt：bolt 位置的按鈕在同一列（沒有另開一列）', (await editor.page.locator('.topo-edit-toolbar .topo-positions .chip').count()) > 0 && (await editor.page.locator('.topo-edit-subbar').count()) === 0)
  await editor.page.keyboard.press('l')
  await editor.page.locator('.topo-full-btn').click()
  check('右上的全畫面按鈕：編輯區進入全螢幕', (await until(async () => ((await editor.page.evaluate(`document.fullscreenElement?.className ?? ''`)) as string).includes('topo-edit-layout') || undefined)) === true)
  await editor.page.locator('.topo-full-btn').click()
  check('再按一次：離開全螢幕', (await until(async () => ((await editor.page.evaluate(`document.fullscreenElement === null`)) as boolean) || undefined)) === true)
  const rowHeights = await editor.page.locator('.topo-route-row').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  check('路線清單每一列單行（高度一致）', rowHeights.length > 0 && new Set(rowHeights).size === 1, rowHeights.join(','))
  const width = async (sel: string) => Math.round((await editor.page.locator(sel).boundingBox())?.width ?? 0)
  const photoWidth = () => width('.topo-edit-photo')
  const w0 = await photoWidth()
  await editor.page.locator('.edit-panel .edit-dock-head button').click()
  check('收起右側面板：留下窄條、照片區變寬', (await editor.page.locator('.edit-rail.right').count()) === 1 && (await until(async () => ((await photoWidth()) > w0 ? true : undefined))) === true)
  await editor.page.locator('.edit-rail.right').click()
  check('點窄條：右側面板回來', (await editor.page.locator('.edit-rail.right').count()) === 0 && (await editor.page.locator('.edit-panel').isVisible()))
  await editor.page.keyboard.press('[')
  check('[ 收起左側目錄：留下窄條', (await editor.page.locator('.edit-rail.left').count()) === 1 && (await editor.page.locator('.edit-catalog').count()) === 0)
  await editor.page.locator('.edit-rail.left').click()
  check('點窄條：目錄回來', (await editor.page.locator('.edit-catalog').count()) === 1)

  // ── 5c. 說明：Ctrl+Enter 提交、一鍵帶入原文；首頁的完成度 ─────────────────
  const textRoute = topoRoutes[0].id
  await editor.page.goto(base + `edit/text/route:${textRoute.replace(/\//g, ':').replace(/\./g, ',')}`)
  await editor.page.waitForSelector('.edit-textarea')
  check('說明：進來就在文字框裡（可以直接打字）', await editor.page.evaluate(`document.activeElement?.classList.contains('edit-textarea') ?? false`))
  check('說明：右側面板只標示提交的按鍵（上方有提交按鈕，右側不重複放按鈕）', (await editor.page.locator('.edit-panel .key-row.info', { hasText: '提交' }).count()) === 1 && (await editor.page.locator('.edit-panel .key-list button.key-row').count()) === 0)
  await editor.page.locator('.edit-textarea').fill('e2e 說明 ✓')
  check('改了文字：顯示尚未提交', ((await editor.page.locator('.edit-toolbar .edit-status').textContent()) ?? '').includes('尚未提交'))
  await editor.page.locator('.edit-textarea').press('Control+Enter')
  const textEdit = await until(async () => {
    const all = await read<Record<string, Record<string, { text: string }>>>('v2/textEdits')
    const versions = Object.values(all ?? {}).flatMap((v) => Object.values(v))
    return versions.length === 1 ? versions[0] : undefined
  })
  check('Ctrl+Enter 提交：資料庫有一版說明', textEdit?.text === 'e2e 說明 ✓')
  // 手機的路線頁：上方是和區域、分區頁相同的標題卡（所在位置、名稱、地圖），接著是 Topo；點 Topo 開全螢幕、按裡面的「編輯」才進入 Topo 編輯；點說明進入說明編輯；沒有 Topo 的路線不留位置
  const viewer2 = await newContext(undefined, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const vp = viewer2.page
  await signIn(vp, 'viewer2@example.com')
  await vp.goto(base + `route/${topoRoutes[0].id}`)
  await vp.waitForSelector('.route-m .topo')
  const crumbs = (await vp.locator('.route-m .area-hero-crag a').allTextContents()).length
  check('手機路線頁：標題卡上方是所在位置（龍洞 › 區域 › 分區，可以點）', crumbs >= 2, `${crumbs} 層`)
  check('手機路線頁：標題卡有這個分區的地圖', (await vp.locator('.route-m .area-hero svg.area-hero-shape').count()) === 1)
  // 路線頁只畫這面牆（不畫附近的），放到最大
  await vp.waitForSelector('.route-m .area-hero svg.area-hero-shape path[stroke-width="5"]')
  check('手機路線頁：地圖只畫這個分區的岩壁', ((await vp.locator('.route-m .area-hero svg.area-hero-shape path[stroke-width="2"]').getAttribute('d')) ?? '') === '')
  // 沿著線取點換成螢幕座標（getBoundingClientRect 是轉過方向的外框，比線大）
  const routeWall = await vp.locator('.route-m .area-hero svg.area-hero-shape path[stroke-width="5"]').evaluate((el: SVGPathElement) => {
    const length = el.getTotalLength()
    const m = el.getScreenCTM()!
    const pts = Array.from({ length: 201 }, (_, i) => el.getPointAtLength((length * i) / 200).matrixTransform(m))
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  })
  const routeMap = (await vp.locator('.route-m .area-hero svg.area-hero-shape').boundingBox())!
  const routeFill = Math.max(routeWall.width / routeMap.width, routeWall.height / routeMap.height)
  check('手機路線頁：岩壁放到最大（至少佔地圖的六成）', routeFill >= 0.6, `${(routeFill * 100).toFixed(0)}%`)
  check('Topo 直接放在卡片裡：沒有「Topo」標題、沒有分隔線', (await vp.locator('.route-m .topos h2').count()) === 0 && (await vp.locator('.route-m .topos').evaluate((el) => getComputedStyle(el).borderTopWidth)) === '0px')
  const topoY = (await vp.locator('.route-m .topo').boundingBox())!.y
  const heroBottom = await vp.locator('.route-m .area-hero').evaluate((el) => el.getBoundingClientRect().bottom)
  check('手機路線頁：Topo 在標題卡下面', topoY > heroBottom, `${topoY} / ${heroBottom}`)
  check('說明直接顯示內容（沒有「路線資訊」標題）', ((await vp.locator('.community-text').textContent()) ?? '').includes('e2e 說明') && (await vp.locator('.community-text h2').count()) === 0)
  const routeUrl = vp.url()
  const textBox = (await vp.locator('.community-edit').boundingBox())!
  await vp.touchscreen.tap(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2)
  await vp.waitForSelector('.community-text .inline-text-area', { timeout: 5000 })
  check('手機路線頁：點說明在卡片裡編輯（不換頁），文字框是目前的說明', vp.url() === routeUrl && ((await vp.locator('.inline-text-area').inputValue()) ?? '').includes('e2e 說明'), vp.url())
  await vp.locator('.inline-text-area').fill('e2e 手機說明 ✓')
  await vp.locator('.inline-text-actions .action.primary').click()
  await vp.waitForSelector('.inline-text-area', { state: 'detached', timeout: 15000 })
  const phoneText = await until(async () => {
    const all = await read<Record<string, Record<string, { text: string }>>>('v2/textEdits')
    return Object.values(all ?? {}).flatMap((v) => Object.values(v)).find((v) => v.text === 'e2e 手機說明 ✓')
  })
  check('手機路線頁：在卡片裡提交說明，資料庫多一版，卡片顯示新的說明', !!phoneText && ((await vp.locator('.community-text').textContent()) ?? '').includes('e2e 手機說明 ✓'))
  // 說明的草稿：重新載入（App 被系統關掉再回來）回到編輯、文字還在；返回關掉編輯但留著草稿；「取消」才捨棄
  const openText = async () => {
    const box = (await vp.locator('.community-edit').boundingBox())!
    await vp.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await vp.waitForSelector('.inline-text-area', { timeout: 5000 })
  }
  await openText()
  await vp.locator('.inline-text-area').fill('e2e 草稿')
  await vp.reload()
  await vp.waitForSelector('.inline-text-area', { timeout: 15000 })
  check('手機路線頁：編輯說明時重新載入（App 被關掉再回來），回到編輯，打到一半的文字還在', vp.url() === routeUrl && (await vp.locator('.inline-text-area').inputValue()) === 'e2e 草稿', vp.url())
  await vp.evaluate('history.back()')
  await vp.waitForSelector('.inline-text-area', { state: 'detached', timeout: 5000 })
  check('手機路線頁：編輯說明時按返回，關掉編輯、留在路線頁', vp.url() === routeUrl, vp.url())
  await openText()
  check('手機路線頁：返回之後再編輯，草稿還在', (await vp.locator('.inline-text-area').inputValue()) === 'e2e 草稿')
  await vp.locator('.inline-text-actions .action:not(.primary)').click()
  await vp.waitForSelector('.inline-text-area', { state: 'detached', timeout: 5000 })
  await openText()
  check('手機路線頁：按「取消」捨棄草稿，再編輯是目前的說明', (await vp.locator('.inline-text-area').inputValue()) === 'e2e 手機說明 ✓')
  await vp.locator('.inline-text-actions .action:not(.primary)').click()
  await vp.waitForSelector('.inline-text-area', { state: 'detached', timeout: 5000 })
  await vp.evaluate('history.back()')
  await vp.waitForTimeout(300)
  check('手機路線頁：用按鈕關掉編輯後按返回，不會又打開編輯', (await vp.locator('.inline-text-area').count()) === 0)
  await vp.goto(routeUrl)
  await vp.waitForSelector('.route-m .topo')
  const phoneTopo = (await vp.locator('.route-m .topo').boundingBox())!
  const holdAt = { x: phoneTopo.x + phoneTopo.width / 2, y: phoneTopo.y + phoneTopo.height / 2 }
  const hold = await viewer2.ctx.newCDPSession(vp)
  await hold.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...holdAt, id: 1 }] })
  await vp.waitForTimeout(800)
  await hold.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await vp.waitForTimeout(800)
  check('手機路線頁：長按 Topo 不會進入編輯', (await vp.locator('dialog.topo-phone').count()) === 0)
  await vp.keyboard.press('Escape')
  await vp.waitForSelector('dialog.topo-full', { state: 'detached', timeout: 5000 }).catch(() => {})
  // 看圖不會誤進編輯：點照片開全螢幕，按全螢幕裡的「編輯」才進入
  await vp.locator('.route-m figure.route-topo').first().click()
  await vp.waitForSelector('dialog.topo-full[open]', { timeout: 5000 })
  check('手機路線頁：點 Topo 開全螢幕（不進入編輯），有「編輯」按鈕', (await vp.locator('dialog.topo-phone').count()) === 0 && (await vp.locator('dialog.topo-full[open] .topo-full-edit').count()) === 1)
  await vp.locator('dialog.topo-full[open] .topo-full-edit').click()
  await vp.waitForSelector('dialog.topo-phone[open] .topo-phone-title', { timeout: 10000 })
  check('手機路線頁：全螢幕裡按「編輯」在這一頁打開 Topo 編輯器（不換頁），選好這條路線，全螢幕關掉', vp.url() === routeUrl && (await vp.locator('dialog.topo-full').count()) === 0 && (await vp.locator('.topo-phone-title b').textContent()) === topoRoutes[0].number, vp.url())
  await vp.locator('.topo-phone-close').click()
  check('手機路線頁：關閉 Topo 編輯器回到路線卡片', (await vp.locator('dialog.topo-phone').count()) === 0 && vp.url() === routeUrl)
  // 路線卡片的 Topo：這條路線是唯一的主角——沒有按鈕、只標這條的編號、照片灰階（這條周圍原色）、放大到這條路線；點了開全螢幕
  const card = vp.locator('.route-m figure.route-topo').first()
  const cardState = await card.evaluate((f) => {
    const img = f.querySelector<HTMLImageElement>('.topo-frame > img')!
    return {
      buttons: f.querySelectorAll('button').length,
      badges: [...f.querySelectorAll('.topo-badge:not(.small) text')].map((t) => t.textContent),
      gray: getComputedStyle(img).filter.includes('grayscale'),
      tint: getComputedStyle(f.querySelector('.topo-frame')!, '::after').content,
      ratio: f.getBoundingClientRect().width / f.getBoundingClientRect().height,
      fade: getComputedStyle(f.querySelector('.topo-frame')!).maskImage,
      reveal: f.querySelectorAll('.topo-reveal').length,
      zoomed: parseFloat(img.style.width) > 100,
      dim: f.querySelectorAll('.topo-route.dim').length,
    }
  })
  check(
    '手機路線卡片：Topo 上沒有按鈕，只有這條路線是大的編號',
    cardState.buttons === 0 && cardState.badges.join(',') === topoRoutes[0].number,
    JSON.stringify(cardState),
  )
  check('手機路線卡片：照片灰階、上緣淡入卡片的漸層（照片不另外染色），這條路線周圍是原色，放大到這條路線', cardState.gray && cardState.tint === 'none' && cardState.fade.includes('gradient') && cardState.reveal === 1 && cardState.zoomed, JSON.stringify(cardState))
  check('手機路線卡片：Topo 固定 4:5', Math.abs(cardState.ratio - 0.8) < 0.01, String(cardState.ratio))
  await card.click()
  await vp.waitForSelector('dialog.topo-full[open] .topo-route.on', { timeout: 10000 })
  check('手機路線卡片：點 Topo 開全螢幕，選好這條路線', (await vp.locator('dialog.topo-full[open] .topo-route.on').count()) > 0 && vp.url() === routeUrl, vp.url())
  await vp.keyboard.press('Escape')
  await vp.waitForSelector('dialog.topo-full', { state: 'detached', timeout: 5000 }).catch(() => {})
  check('手機路線卡片：關閉全螢幕回到路線卡片', (await vp.locator('dialog.topo-full[open]').count()) === 0 && vp.url() === routeUrl, vp.url())
  await vp.locator('.route-m .page-tools .tool-button[aria-haspopup="menu"]').click()
  await vp.getByRole('menuitem', { name: '編輯：Topo' }).click()
  await vp.waitForSelector('dialog.topo-phone[open] .topo-phone-title', { timeout: 10000 })
  check('手機路線頁：「更多 › 編輯：Topo」也在這一頁打開編輯器', vp.url() === routeUrl)
  // 返回手勢一次退一層：畫線中返回是結束畫線，編輯器還在；重新載入回到編輯（選的路線、草稿都在）；再返回才關閉
  await vp.locator('.topo-phone-title').click()
  await vp.locator('.topo-sheet .topo-route-row', { has: vp.locator('.topo-route-no', { hasText: new RegExp(`^${topoRoutes[1].number}$`) }) }).click()
  await vp.waitForTimeout(400)
  await vp.getByRole('button', { name: '畫線' }).click()
  await vp.waitForTimeout(400)
  const pointsBefore = await vp.locator('.topo-handles circle').count()
  const vpPane = await shownPhoto(vp)
  await vp.touchscreen.tap(vpPane.x + vpPane.width * 0.85, vpPane.y + vpPane.height * 0.15)
  await vp.waitForTimeout(300)
  check('手機 Topo：畫線加了一個點', (await vp.locator('.topo-handles circle').count()) === pointsBefore + 1)
  await vp.evaluate('history.back()')
  await vp.waitForTimeout(400)
  check('手機 Topo：畫線中按返回，結束畫線（不是關掉編輯器）', (await vp.locator('dialog.topo-phone[open]').count()) === 1 && (await vp.locator('.topo-modes button[aria-pressed="true"]').count()) === 0 && vp.url() === routeUrl, vp.url())
  await vp.reload()
  await vp.waitForSelector('dialog.topo-phone[open] .topo-phone-title', { timeout: 15000 })
  await vp.waitForTimeout(400)
  check('手機 Topo：編輯中重新載入（App 被關掉再回來），回到編輯器，選的路線與修改都在', (await vp.locator('.topo-phone-title b').textContent()) === topoRoutes[1].number && (await vp.locator('.topo-handles circle').count()) === pointsBefore + 1, `${await vp.locator('.topo-handles circle').count()} 個點`)
  await vp.locator('.topo-phone-title').click()
  await vp.evaluate('history.back()')
  await vp.waitForTimeout(400)
  check('手機 Topo：路線清單打開時返回，只關掉清單', (await vp.locator('.topo-sheet').count()) === 0 && (await vp.locator('dialog.topo-phone[open]').count()) === 1)
  await vp.evaluate('history.back()')
  await vp.waitForTimeout(400)
  check('手機 Topo：沒有要退的了，返回就關閉編輯器，留在路線頁', (await vp.locator('dialog.topo-phone').count()) === 0 && vp.url() === routeUrl, vp.url())
  await vp.evaluate(`Object.keys(localStorage).filter((k) => k.startsWith('longdong.topoDraft.')).forEach((k) => localStorage.removeItem(k))`)
  // 分區頁、區域頁也在這一頁編輯：關閉、返回都回到原來那一頁（不會跑到編輯模式的目錄）
  const sectorUrl = base + `sector/${topoSector.id}`
  await vp.goto(sectorUrl)
  await vp.waitForSelector('.topos .topo img')
  await vp.locator('.page-tools .tool-button[aria-haspopup="menu"]').click()
  await vp.getByRole('menuitem', { name: '編輯：Topo' }).click()
  await vp.waitForSelector('dialog.topo-phone[open] .topo-phone-title', { timeout: 10000 })
  check('手機分區頁：「更多 › 編輯：Topo」在這一頁打開編輯器（不換到編輯模式）', vp.url() === sectorUrl, vp.url())
  await vp.locator('.topo-phone-close').click()
  check('手機分區頁：關閉編輯器回到分區頁', (await vp.locator('dialog.topo-phone').count()) === 0 && vp.url() === sectorUrl, vp.url())
  const sectorTopo = (await vp.locator('.topos .topo').first().boundingBox())!
  const sectorHold = await viewer2.ctx.newCDPSession(vp)
  await sectorHold.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sectorTopo.x + sectorTopo.width / 2, y: sectorTopo.y + sectorTopo.height / 2, id: 1 }] })
  await vp.waitForTimeout(800)
  await sectorHold.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await vp.waitForTimeout(800)
  check('手機分區頁：長按 Topo 不會進入編輯', (await vp.locator('dialog.topo-phone').count()) === 0)
  await vp.keyboard.press('Escape')
  await vp.waitForSelector('dialog.topo-full', { state: 'detached', timeout: 5000 }).catch(() => {})
  check('手機分區頁：Topo 上沒有按鈕', (await vp.locator('.topos .topo').first().locator('button').count()) === 0)
  await vp.locator('.topos .topo').first().click()
  await vp.waitForSelector('dialog.topo-full[open] .topo-full-edit', { timeout: 10000 })
  check('手機分區頁：點 Topo 開全螢幕，不進入編輯', (await vp.locator('dialog.topo-phone').count()) === 0 && vp.url() === sectorUrl, vp.url())
  await vp.locator('dialog.topo-full[open] .topo-full-edit').click()
  await vp.waitForSelector('dialog.topo-phone[open] .topo-phone-title', { timeout: 10000 })
  check('手機分區頁：全螢幕裡按「編輯」在這一頁編輯那一張', vp.url() === sectorUrl, vp.url())
  await vp.evaluate('history.back()')
  await vp.waitForTimeout(400)
  check('手機分區頁：編輯 Topo 時返回，回到分區頁', (await vp.locator('dialog.topo-phone').count()) === 0 && vp.url() === sectorUrl, vp.url())
  const topoArea = data.areas.find((x) => x.sectors.some((y) => y.id === topoSector.id))!
  const areaUrl = base + `area/${topoArea.id}`
  await vp.goto(areaUrl)
  await vp.waitForSelector('.area-hero-wrap')
  await vp.locator('.page-tools .tool-button[aria-haspopup="menu"]').click()
  await vp.getByRole('menuitem', { name: '編輯：區域說明' }).click()
  await vp.waitForSelector('.inline-text-area', { timeout: 5000 })
  check('手機區域頁：「更多 › 編輯：區域說明」在卡片裡編輯（不換到編輯模式）', vp.url() === areaUrl, vp.url())
  await vp.evaluate('history.back()')
  await vp.waitForSelector('.inline-text-area', { state: 'detached', timeout: 5000 })
  check('手機區域頁：編輯說明時返回，回到區域頁', vp.url() === areaUrl, vp.url())
  const noTopoRoute = data.areas.flatMap((a) => a.sectors).find((x) => x.id !== topoSector.id)!.routes.find((r) => r.number)!
  await vp.goto(base + `route/${noTopoRoute.id}`)
  await vp.waitForSelector('.route-m h1')
  await vp.waitForTimeout(500)
  check('手機路線頁：沒有 Topo 的路線不留位置', (await vp.locator('.route-m .topos').count()) === 0)
  // 四層同一套設計：首頁也是標題卡（整個龍洞的地圖）；長條圖用區域的顏色；區域、分區、路線的名稱同一個字級
  await vp.goto(base)
  await vp.waitForSelector('.area-row .grade-dist .bar')
  // 地圖（scale-map）比路線資料晚載入
  await vp.waitForSelector('.area-hero svg.area-hero-shape path')
  check('首頁：標題卡有整個龍洞的地圖', (await vp.locator('.area-hero svg.area-hero-shape path').count()) === data.areas.length)
  const homeCard = (await vp.locator('.area-hero').boundingBox())!
  const homeMap = (await vp.locator('.area-hero svg.area-hero-shape').boundingBox())!
  check('首頁：地圖放大，左右跨到卡片邊緣', homeMap.x <= homeCard.x + 1 && homeMap.x + homeMap.width >= homeCard.x + homeCard.width - 1, `${homeMap.x}+${homeMap.width} / ${homeCard.x}+${homeCard.width}`)
  const homeColor = await vp.locator('.area-hero').evaluate((el) => getComputedStyle(el).getPropertyValue('--area-color').trim().toLowerCase())
  const areaColors = (JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as { areas: { color?: string }[] }).areas.map((a) => a.color?.toLowerCase())
  // 看起來要不同（不只是色碼不同）：RGB 距離至少 80
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const nearest = Math.min(...areaColors.filter(Boolean).map((c) => Math.hypot(...rgb(c!).map((v, i) => v - rgb(homeColor)[i]))))
  check('首頁：標題卡的顏色和每個區域看起來都不同', /^#[0-9a-f]{6}$/.test(homeColor) && nearest >= 80, `${homeColor}，最接近的差 ${nearest.toFixed(0)}`)
  check('根元素是深色（Android 的系統列跟著深色）', (await vp.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)) === 'rgb(14, 14, 14)')
  const barAndDot = await vp.locator('.area-row').first().evaluate((el) => [getComputedStyle(el.querySelector('.grade-dist .bar')!).fill, getComputedStyle(el, '::before').backgroundColor])
  check('首頁：長條圖用區域的顏色（和色點相同）', barAndDot[0] === barAndDot[1], barAndDot.join(' / '))
  const nameSize = (selector: string) => vp.locator(selector).first().evaluate((el) => getComputedStyle(el).fontSize)
  const homeName = await nameSize('.area-row .area-name')
  await vp.goto(base + `area/${data.areas.find((a) => a.sectors.some((x) => x.id === topoSector.id))!.id}`)
  await vp.waitForSelector('.area-row .sector-name')
  const sectorName = await nameSize('.area-row .sector-name')
  await vp.goto(base + `sector/${topoSector.id}`)
  await vp.waitForSelector('.route-name .zh')
  const routeName = await nameSize('.route-name .zh')
  check('區域、分區、路線清單的名稱同一個字級', homeName === sectorName && sectorName === routeName, [homeName, sectorName, routeName].join(' / '))
  // 手機路線卡片的標題卡固定高度（名稱長短、有沒有警告都一樣）；警告在難度那一列的下一列
  type Hero = { id: string; isFixture?: boolean; safety?: string; name: { zh?: string } }
  const heroRoutes = data.areas.flatMap((a) => a.sectors).flatMap((x) => x.routes) as unknown as Hero[]
  const longest = heroRoutes.reduce((a, b) => ((b.name.zh ?? '').length > (a.name.zh ?? '').length ? b : a))
  // 名稱最長的有警告路線（名稱兩行時難度那一列最低）
  const warned = heroRoutes.filter((r) => !r.isFixture && (r.safety === 'yellow' || r.safety === 'red')).reduce((a, b) => ((b.name.zh ?? '').length > (a.name.zh ?? '').length ? b : a))
  const heroes: { h: number; status?: boolean }[] = []
  for (const r of [topoRoutes[0], longest, warned]) {
    await vp.goto(base + `route/${r.id}`)
    await vp.waitForSelector('.route-m .area-hero .route-facts')
    heroes.push(
      await vp.locator('.route-m .area-hero').evaluate((el) => {
        const status = el.querySelector('.route-status')?.getBoundingClientRect()
        const facts = el.querySelector('.route-facts')!.getBoundingClientRect()
        const hero = el.getBoundingClientRect()
        return { h: hero.height, status: status ? status.top >= facts.bottom && status.left === facts.left && status.bottom <= hero.bottom : undefined }
      }),
    )
  }
  check('手機路線卡片：標題卡一樣高（短名稱、最長的名稱、有警告）', heroes.every((x) => x.h === heroes[0].h), JSON.stringify(heroes))
  check('手機路線卡片：警告在難度那一列的下一列、左邊對齊，名稱兩行時也在標題卡裡', heroes[2].status === true, JSON.stringify(heroes))
  await viewer2.ctx.close()

  await editor.page.goto(base + 'edit')
  const stat = (label: string) => editor.page.locator('.edit-stat', { hasText: label }).locator('.edit-stat-value')
  const topoStat = await until(async () => {
    const text = ((await stat('Topo').textContent()) ?? '').replace(/\s+/g, '')
    return /^\d+\/\d+$/.test(text) ? text : undefined
  })
  const totalRoutes = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')).areas.flatMap((a: { sectors: { routes: { isFixture?: boolean }[] }[] }) => a.sectors.flatMap((x) => x.routes)).filter((r: { isFixture?: boolean }) => !r.isFixture).length
  check('首頁完成度：Topo 是「有線段的路線／全部路線」（1 條線段）', topoStat === `1/${totalRoutes}`, topoStat)
  check('首頁完成度：說明已有 1 個項目被修改', ((await stat('說明').textContent()) ?? '').replace(/\s+/g, '').startsWith('1/'))

  // ── 5b. 編輯 Topo 的入口：公開頁面沒有「新增 Topo 照片」；編輯選單只有一個「Topo」，沒照片進新增頁、有照片進第一張 ──
  // 還沒有照片的分區（e2e-report 回報時附的照片也在同一個模擬器裡）
  const withPhotos = new Set(Object.values((await read<Record<string, { sector: string }>>('v2/topos')) ?? {}).map((p) => p.sector))
  const emptySector = data.areas.flatMap((a) => a.sectors).find((s) => s.id !== topoSector.id && !withPhotos.has(s.id))!
  const topoMenu = async (sectorId: string) => {
    await editor.page.goto(base + `sector/${sectorId}`)
    await editor.page.waitForSelector('.tool-button')
    await editor.page.locator('.tool-button[aria-haspopup=menu]').click()
    return editor.page.locator('.tool-pop [role=menuitem]')
  }
  const withPhoto = await topoMenu(topoSector.id)
  check('有照片的分區：選單只有一個「Topo」，沒有「新增 Topo 照片」', (await withPhoto.filter({ hasText: 'Topo' }).count()) === 1 && (await withPhoto.filter({ hasText: '新增' }).count()) === 0)
  check('有照片：「Topo」直接連到第一張照片', ((await withPhoto.filter({ hasText: 'Topo' }).getAttribute('href')) ?? '').endsWith(`/edit/topo/${photo}`))
  check('分區頁面上沒有「新增 Topo 照片」按鈕', (await editor.page.locator('.topos .topo-upload').count()) === 0)
  const noPhoto = await topoMenu(emptySector.id)
  check('沒有照片的分區：選單也只有一個「Topo」', (await noPhoto.filter({ hasText: 'Topo' }).count()) === 1 && (await noPhoto.filter({ hasText: '新增' }).count()) === 0)
  check('沒有照片：分區頁面沒有「新增 Topo 照片」按鈕', (await editor.page.locator('.topo-upload').count()) === 0)
  await noPhoto.filter({ hasText: 'Topo' }).click()
  await editor.page.waitForSelector('.edit-message .topo-upload button')
  check('沒有照片：進到新增 Topo 的頁面（有上傳按鈕）', /edit\/topo\/sector:/.test(editor.page.url()) && ((await editor.page.locator('.edit-message .topo-upload button').textContent()) ?? '').includes('新增 Topo 照片'))
  await editor.page.goto(base + `edit/topo/sector:${topoSector.id}`)
  check('新增頁的網址遇到已有照片的分區：轉到第一張照片', (await until(async () => (editor.page.url().endsWith(`/edit/topo/${photo}`) ? true : undefined))) === true, editor.page.url())

  // ── 5d. 共用的 anchor：〈細縫〉與〈Z字〉共用頂端的 anchor，一條標好，另一條自動同步 ──
  const sharedSector = data.areas.flatMap((a) => a.sectors).find((x) => x.routes.some((r) => r.number === '568'))!
  const thinRoute = sharedSector.routes.find((r) => r.number === '568')!
  const zRoute = sharedSector.routes.find((r) => r.number === '569')!
  const keyOf = (id: string) => id.replace(/\//g, ':').replace(/\./g, ',')
  await put('v2/topos/e2eshare', { sector: sharedSector.id, width: 2000, height: 1200, image: 'topos/seed/e2eshare.jpg', uid: 'seed', createdAt: Date.now() })
  await put('v2/topoEdits/e2eshare/seed1', {
    uid: 'seed',
    createdAt: Date.now(),
    routes: { [keyOf(thinRoute.id)]: { line: '4000,9000 4100,3000 4200,1000' }, [keyOf(zRoute.id)]: { line: '4600,9000 4400,3000 4250,1000' } },
  })
  await editor.page.goto(base + 'edit/topo/e2eshare')
  await editor.page.waitForSelector('.topo-route-row')
  await row('569').click()
  await editor.page.keyboard.press('b')
  await editor.page.locator('.topo-positions .chip', { hasText: 'A01' }).click()
  const shareFrame = (await editor.page.locator('.topo-frame svg').boundingBox())!
  await editor.page.mouse.click(shareFrame.x + shareFrame.width * 0.425, shareFrame.y + shareFrame.height * 0.14)
  check('Z字標好 anchor（A01）', (await editor.page.locator('.topo-handles rect').count()) === 1)
  await row('568').click()
  check('切到〈細縫〉：它的 A01 已經自動標在同一個點（沒有另外標）', (await editor.page.locator('.topo-handles rect').count()) === 1)
  await row('569').click()
  await editor.page.keyboard.press('z')
  await row('568').click()
  check('復原：兩條路線的 A01 一起回到沒標', (await editor.page.locator('.topo-handles rect').count()) === 0)
  await editor.page.keyboard.press('y')
  await editor.page.click('.topo-edit-toolbar .edit-btn.primary')
  const shared = await until(async () => {
    const v = await read<Record<string, { routes: Record<string, { bolts?: Record<string, string> }> }>>('v2/topoEdits/e2eshare')
    const latest = v && Object.values(v).find((e) => e.routes[keyOf(zRoute.id)]?.bolts)
    return latest
  })
  const [thinAnchor, zAnchor] = [shared?.routes[keyOf(thinRoute.id)]?.bolts?.A01, shared?.routes[keyOf(zRoute.id)]?.bolts?.A01]
  check('提交：兩條路線都有 A01，位置相同', !!thinAnchor && thinAnchor === zAnchor, `${thinAnchor} / ${zAnchor}`)

  // 舊資料：只有〈Z字〉標了 anchor，〈細縫〉沒有：編輯時選〈細縫〉也要看得到
  await put('v2/topos/e2eshare2', { sector: sharedSector.id, width: 2000, height: 1200, image: 'topos/seed/e2eshare2.jpg', uid: 'seed', createdAt: Date.now() })
  await put('v2/topoEdits/e2eshare2/seed1', {
    uid: 'seed',
    createdAt: Date.now(),
    routes: { [keyOf(thinRoute.id)]: { line: '4000,9000 4100,3000 4200,1000' }, [keyOf(zRoute.id)]: { line: '4600,9000 4400,3000 4250,1000', bolts: { A01: '4250,900' } } },
  })
  await editor.page.goto(base + 'edit/topo/e2eshare2')
  await editor.page.waitForSelector('.topo-route-row')
  await row('568').click()
  check('舊資料只有〈Z字〉標了共用的 anchor：編輯時選〈細縫〉也看得到', (await editor.page.locator('.topo-handles rect').count()) === 1)

  // ── 6. 看 Topo：bolt 預設不顯示，按鈕切換 ────────────────────────────
  await put(`v2/topoEdits/${photo}/e2ebolts`, {
    uid: 'seed',
    createdAt: Date.now() + 60000,
    routes: {
      [key]: { line: '3000,8000 3200,5000 3000,2000', bolts: { B01: '3080,7600', A01: '3000,1800' } },
      [topoRoutes[1].id.replace(/\//g, ':').replace(/\./g, ',')]: { line: '6000,8000 6200,5000 6000,2000' },
      // 示意線：只畫了一小段、從照片下緣出去（主要的路線不在照片裡）
      [topoRoutes[2].id.replace(/\//g, ':').replace(/\./g, ',')]: { line: '8000,9990 8050,9700 8100,9400' },
    },
  })
  const viewer = await newContext()
  // 照片載入得慢：載入完之前，標記不先出現（照片與標記一起淡入）
  const slowPhoto = async (r: { fulfill: (o: { status: number }) => Promise<void> }) => {
    await new Promise((res) => setTimeout(res, 2500))
    await r.fulfill({ status: 404 })
  }
  await viewer.page.route(/:9199\//, slowPhoto)
  await viewer.page.goto(base + `sector/${topoSector.id}`)
  await viewer.page.waitForSelector('.topo-frame svg', { state: 'attached', timeout: 20000 })
  const frameState = () => viewer.page.evaluate(`(() => { const f = document.querySelector('.topo-frame'); return [f.classList.contains('ready'), getComputedStyle(f.querySelector('svg')).opacity] })()`) as Promise<[boolean, string]>
  const loading = await frameState()
  check('照片載入中：標記不先出現', loading[0] === false && Number(loading[1]) < 0.5, JSON.stringify(loading))
  const loaded = await until(async () => {
    const [ready, opacity] = await frameState()
    return ready && opacity === '1' ? true : undefined
  })
  check('照片載入完：標記淡入', loaded === true)
  const sketchState = (await viewer.page.evaluate(`(() => {
    const arrow = document.querySelector('figure.topo path.topo-dot')
    if (!arrow) return null
    const a = arrow.getBoundingClientRect()
    const badge = [...document.querySelectorAll('figure.topo .topo-badge')].find((g) => g.textContent === ${JSON.stringify(topoRoutes[2].number)})
    const b = badge && badge.querySelector('rect').getBoundingClientRect()
    return { fill: getComputedStyle(arrow).fill, dx: b ? Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)) : null, gap: b ? a.y - (b.y + b.height) : null }
  })()`)) as { fill: string; dx: number | null; gap: number | null } | null
  check(
    '示意線：終點是看得到的向上箭頭（有填色），編號緊貼在箭頭正上方',
    !!sketchState && sketchState.fill !== 'none' && sketchState.dx !== null && sketchState.dx < 1 && sketchState.gap !== null && sketchState.gap >= 0 && sketchState.gap < 8,
    JSON.stringify(sketchState),
  )
  await viewer.page.unroute(/:9199\//, slowPhoto)
  await viewer.page.waitForSelector('.topo-bolt-toggle', { timeout: 20000 })
  check('bolt 預設不顯示', (await viewer.page.locator('.topo-bolt').count()) === 0)
  await viewer.page.click('.topo-bolt-toggle')
  check('按鈕：顯示 bolt', (await viewer.page.locator('.topo-bolt').count()) === 2)
  await viewer.page.reload()
  await viewer.page.waitForSelector('.topo-bolt-toggle')
  check('選擇會記住（重新整理後還是顯示）', (await viewer.page.locator('.topo-bolt').count()) === 2)
  await viewer.page.click('.topo-bolt-toggle')
  check('再按一次：隱藏', (await viewer.page.locator('.topo-bolt').count()) === 0)

  // ── 6b. 看 Topo（電腦版）：縮放、拖曳平移、不重複顯示、沒有焦點方框 ──
  const fit = () => viewer.page.locator('figure.topo .topo-zoom-fit').textContent()
  const zoomIn = () => viewer.page.locator('figure.topo .topo-zoom-controls button[aria-label=放大]').click()
  check('電腦版有縮放按鈕，一開始是 100%', (await fit()) === '100%')
  const photoBox = (await viewer.page.locator('figure.topo .topo-zoom').boundingBox())!
  const center = { x: photoBox.x + photoBox.width / 2, y: photoBox.y + photoBox.height / 2 }
  await viewer.page.mouse.move(center.x, center.y)
  await viewer.page.mouse.wheel(0, -300)
  check('一般滾輪不縮放（留給頁面捲動）', (await fit()) === '100%')
  await viewer.page.keyboard.down('Control')
  await viewer.page.mouse.wheel(0, -300)
  await viewer.page.keyboard.up('Control')
  const zoomed = Number.parseInt((await fit()) ?? '0')
  check('Ctrl＋滾輪縮放', zoomed > 100, `${zoomed}%`)
  await zoomIn()
  check('按「放大」：倍率變大', Number.parseInt((await fit()) ?? '0') > zoomed)
  const moved = async () => viewer.page.locator('figure.topo .topo-zoom-inner').getAttribute('style')
  const styleBefore = await moved()
  await viewer.page.mouse.move(center.x, center.y)
  await viewer.page.mouse.down()
  await viewer.page.mouse.move(center.x + 40, center.y + 30, { steps: 5 })
  await viewer.page.mouse.up()
  check('放大後按住左鍵拖曳可以平移', (await moved()) !== styleBefore, `${styleBefore} → ${await moved()}`)
  check('拖曳平移不會誤選路線', !viewer.page.url().includes('?r='))
  await viewer.page.locator('figure.topo .topo-zoom-fit').click()
  check('按倍率回到整張（100%）', (await fit()) === '100%')

  // 點最長的那條線的中段（示意線很短，不點它）
  const lineMid = (await viewer.page.evaluate(`(() => {
    const hits = [...document.querySelectorAll('figure.topo g.topo-route.link .topo-hit')]
    const hit = hits.sort((a, b) => b.getTotalLength() - a.getTotalLength())[0]
    const p = hit.getPointAtLength(hit.getTotalLength() * 0.3)
    const m = hit.getScreenCTM()
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
  })()`)) as { x: number; y: number }
  await viewer.page.mouse.click(lineMid.x, lineMid.y)
  await viewer.page.waitForSelector('.detail-pane h1', { timeout: 15000 })
  check('點照片上的路線：右邊顯示那條路線', viewer.page.url().includes('r='))
  check('同時看到分區與路線時，Topo 只顯示一張（路線那邊不重複）', (await viewer.page.locator('figure.topo').count()) === 1 && (await viewer.page.locator('.detail-pane figure.topo').count()) === 0)
  // 用鍵盤 Shift+Tab 從照片右上角的按鈕往回到路線上（有焦點方框的情況）：不出現瀏覽器的方框
  await viewer.page.locator('figure.topo .topo-bolt-toggle').focus()
  let onRoute = false
  for (let i = 0; i < 40 && !onRoute; i++) {
    await viewer.page.keyboard.press('Shift+Tab')
    onRoute = await viewer.page.evaluate(`document.activeElement?.matches('g.topo-route.link') ?? false`)
  }
  check('鍵盤選到路線時沒有焦點方框', onRoute && (await viewer.page.evaluate(`getComputedStyle(document.activeElement).outlineStyle`)) === 'none')

  // ── 6c. 全螢幕（電腦版）：路線清單、滾輪縮放、↑↓ 換路線、Esc 關閉 ──
  await viewer.page.click('.topo-full-open')
  const dialog = viewer.page.locator('dialog.topo-full[open].wide')
  await dialog.waitFor({ timeout: 10000 })
  check('全螢幕：右邊列出這張照片上有標記的路線', (await dialog.locator('.topo-full-row').count()) === 3)
  const fullFit = () => dialog.locator('.topo-zoom-fit').textContent()
  check('全螢幕有縮放按鈕，一開始是 100%', (await fullFit()) === '100%')
  const stage = (await dialog.locator('.topo-full-stage').boundingBox())!
  await viewer.page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
  await viewer.page.mouse.wheel(0, -300)
  check('全螢幕：滾輪縮放', Number.parseInt((await fullFit()) ?? '0') > 100)
  await viewer.page.keyboard.press('0')
  check('按 0 回到整張', (await fullFit()) === '100%')
  await viewer.page.keyboard.press('+')
  check('按 + 放大', Number.parseInt((await fullFit()) ?? '0') > 100)
  await dialog.locator('.topo-full-row').first().click()
  const firstNo = await dialog.locator('.topo-full-row.on .topo-route-no').textContent()
  await viewer.page.keyboard.press('ArrowDown')
  const secondNo = await dialog.locator('.topo-full-row.on .topo-route-no').textContent()
  check('點清單選路線、↓ 換到下一條', !!firstNo && !!secondNo && firstNo !== secondNo, `${firstNo} → ${secondNo}`)
  // 左右滑換路線（沒放大時）：往右滑回上一條、往左滑到下一條
  await viewer.page.keyboard.press('0')
  const swipe = async (dx: number) => {
    const box = (await dialog.locator('.topo-full-stage').boundingBox())!
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
    await viewer.page.mouse.move(x, y)
    await viewer.page.mouse.down()
    await viewer.page.mouse.move(x + dx, y + 4, { steps: 6 })
    await viewer.page.mouse.up()
    return dialog.locator('.topo-full-row.on .topo-route-no').textContent()
  }
  const swipedBack = await swipe(120)
  const swipedNext = await swipe(-120)
  check('全螢幕：往右滑換到上一條、往左滑換到下一條', swipedBack === firstNo && swipedNext === secondNo, `${secondNo} → ${swipedBack} → ${swipedNext}`)
  check('選到的路線在下面顯示，可以開啟', (await dialog.getByRole('button', { name: '路線頁' }).count()) === 1)
  // 點兩下放大（點的那一點留在游標下），再點兩下回到整張
  const fullContent = dialog.locator('.topo-full-content')
  const tapBefore = (await fullContent.boundingBox())!
  const tapAt = { x: tapBefore.x + tapBefore.width * 0.3, y: tapBefore.y + tapBefore.height * 0.6 }
  await viewer.page.mouse.dblclick(tapAt.x, tapAt.y)
  const tapAfter = (await fullContent.boundingBox())!
  const stays = Math.abs((tapAt.x - tapAfter.x) / tapAfter.width - 0.3) < 0.01 && Math.abs((tapAt.y - tapAfter.y) / tapAfter.height - 0.6) < 0.01
  const tapZoomed = await fullFit()
  await viewer.page.mouse.dblclick(tapAt.x, tapAt.y)
  check('全螢幕：點兩下放大（點的位置不動），再點兩下回到整張', tapZoomed === '250%' && stays && (await fullFit()) === '100%', `${tapZoomed} → ${await fullFit()}，${stays ? '位置不動' : '位置跑掉'}`)
  await viewer.page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  check('Esc 關閉全螢幕', (await viewer.page.locator('dialog.topo-full[open]').count()) === 0)
  await viewer.ctx.close()

  // ── 7. 範圍外附近的回報也看得到（直接放去識別的副本；位置在校門口範圍外約 20 公尺） ──
  await put('v2/reportPins/0123456789abcdef0123456789abcdef', { lat: AT.lat + 0.0002, lng: AT.lng - 0.00005, note: '範圍外附近的回報' })
  await editor.page.goto(base + 'edit/map/area:school-gate')
  await editor.page.waitForSelector('.edit-canvas svg[role=img]')
  const nearby = await until(async () => ((await editor.page.locator('.edit-pins').getByText('範圍外附近的回報').count()) === 1 ? true : undefined))
  check('範圍外附近（約 20 公尺）的回報也看得到', nearby === true)
  check('回報清單的標題只有筆數', ((await editor.page.locator('.edit-panel h2', { hasText: '回報' }).first().textContent()) ?? '').trim() === '回報（3）')
  const pinsText = (await editor.page.locator('.edit-pins').textContent()) ?? ''
  check('每一處只列位置與說明：沒有重複的「N 筆回報」、GPS 誤差', !pinsText.includes('筆回報') && !pinsText.includes('GPS'), pinsText.replace(/\s+/g, ' '))
  const panelText = (await editor.page.locator('.edit-panel').textContent()) ?? ''
  check('右側沒有使用說明（不寫「怎麼合併」「對照航照」之類）', !panelText.includes('合併成一處') && !panelText.includes('對照航照') && !panelText.includes('拖曳頂點'))
  // 畫分區的岩壁：列出整個大區的回報，包括指定了同一大區其他分區的
  await put('v2/reportPins/fedcba9876543210fedcba9876543210', { lat: 25.12, lng: 121.9, note: '同大區別的分區的回報', kind: 'base', area: gate.id, sector: `${gate.id}-e2e-other` })
  await editor.page.goto(base + `edit/map/wall:${wallSector.replace('/', ':')}`)
  await editor.page.waitForSelector('.edit-canvas svg[role=img]')
  const areaPins = await until(async () => ((await editor.page.locator('.edit-pins').getByText('同大區別的分區的回報').count()) === 1 ? true : undefined))
  check('畫分區岩壁時，整個大區的回報都列出來', areaPins === true && (await editor.page.locator('.edit-pins').getByText('範圍外附近的回報').count()) === 1)

  const admin = await newContext()
  await signIn(admin.page, 'kant.kang@gmail.com')

  // ── 8. 管理頁：所有輸入、搜尋、依使用者看、處理檢舉、評分只有本人能刪；手機版另一種版面 ──
  const rk = topoRoutes[0].id.replace('/', ':')
  const stamp = Date.now()
  const iso = new Date().toISOString()
  await put('v2/profiles/seedA', { name: '測試甲', updatedAt: iso })
  await put('v2/profiles/seedB', { name: '測試乙', updatedAt: iso })
  await put(`v2/comments/${rk}/e2ec1`, { uid: 'seedA', text: 'e2e 好岩質', createdAt: stamp })
  await put(`v2/comments/${rk}/e2ec2`, { uid: 'seedB', text: 'e2e 加 LINE 領優惠', createdAt: stamp + 1 })
  await put(`v2/ratings/${rk}/seedA`, { stars: 4, feel: 'hard', updatedAt: iso })
  await put('v2/reports/e2er1', { path: `v2/comments/${rk}/e2ec2`, uid: 'seedA', reason: '廣告', createdAt: stamp + 2 })
  const ap = admin.page
  await ap.goto(base + 'admin')
  await ap.waitForSelector('.admin-row', { timeout: 20000 })
  check('管理頁電腦版：左邊六個分類', (await ap.locator('.admin-rail [role=tab]').count()) === 6)
  check('待處理標出 1 筆檢舉', /1/.test((await ap.getByRole('tab', { name: '待處理' }).textContent()) ?? ''))
  await ap.fill('.admin-search', '領優惠')
  const found = await until(async () => ((await ap.locator('.admin-row').count()) === 1 ? true : undefined))
  check('搜尋內容：只剩那一則留言', found === true)
  await ap.locator('.admin-row').first().click()
  await ap.locator('.admin-who', { hasText: '測試乙' }).click()
  const filtered = await until(async () => ((await ap.locator('.admin-chip.on', { hasText: '測試乙' }).count()) === 1 ? true : undefined))
  check('點使用者名稱：只看這個人（出現篩選標籤）', filtered === true)
  await ap.fill('.admin-search', '')
  const whos = await until(async () => {
    const names = await ap.locator('.admin-row-who').allTextContents()
    return names.length > 0 ? names : undefined
  })
  check('清單裡都是這個人的輸入', !!whos && whos.every((n) => n === '測試乙'), String(whos))
  await ap.getByRole('button', { name: '清除' }).click()
  await ap.getByRole('tab', { name: '待處理' }).click()
  await ap.locator('.admin-row').first().click()
  await ap.getByRole('button', { name: '刪除留言' }).click()
  const gone = await until(async () => ((await read(`v2/comments/${rk}/e2ec2`)) === null && (await read('v2/reports/e2er1')) === null ? true : undefined))
  check('刪除被檢舉的留言：留言與檢舉都從資料庫消失', gone === true)
  await ap.getByRole('tab', { name: '全部' }).click()
  await ap.fill('.admin-search', '★ 4')
  await until(async () => ((await ap.locator('.admin-row').count()) === 1 ? true : undefined))
  await ap.locator('.admin-row').first().click()
  check('評分：管理員不能刪（顯示「僅本人可刪」，沒有刪除按鈕）', (await ap.getByText('僅本人可刪').count()) === 1 && (await ap.locator('.admin-desk-detail').getByRole('button', { name: '刪除' }).count()) === 0)
  // 手機寬度：換成上方分頁加可展開的卡片
  await ap.setViewportSize({ width: 390, height: 844 })
  await ap.fill('.admin-search', '')
  await ap.waitForSelector('.admin-mtabs', { timeout: 10000 })
  check('管理頁手機版：上方六個分頁、沒有三欄', (await ap.locator('.admin-mtabs [role=tab]').count()) === 6 && (await ap.locator('.admin-desk').count()) === 0)
  await ap.locator('.admin-card-head').first().click()
  check('點卡片：在原地展開（詳細內容、操作）', (await ap.locator('.admin-card.open .admin-card-body').count()) === 1)
  // ── 9. 路線頁：按鈕兩層、評價與留言（社群 App 的版面） ──
  await put(`v2/likes/${rk}/e2ecm5/seedB`, true)
  for (let i = 0; i < 6; i++) await put(`v2/comments/${rk}/e2ecm${i}`, { uid: 'seedA', text: `e2e 留言 ${i}`, createdAt: stamp + 10 + i })
  const rp = editor.page
  await rp.setViewportSize({ width: 390, height: 844 })
  await rp.goto(base + `route/${topoRoutes[0].id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav')
  const tool = (label: string) => rp.locator('.page-tools').getByRole('button', { name: label, exact: true })
  check('右上的工具：最愛、回報位置（圖示）、更多', (await tool('加入最愛').count()) === 1 && (await tool('回報位置').count()) === 1 && (await tool('更多').count()) === 1)
  check('工具只有圖示、沒有文字，頁面上沒有另一列按鈕', ((await tool('加入最愛').textContent()) ?? '').trim() === '' && ((await tool('回報位置').textContent()) ?? '').trim() === '' && (await rp.locator('.route-actions').count()) === 0)
  const menuItems = () => rp.locator('.page-tools [role=menuitem]').allTextContents()
  check('「更多」選單一開始收起來', (await menuItems()).length === 0)
  await tool('更多').click()
  const items = await menuItems()
  check('「更多」：分享、編輯（路線說明），最下面是路線資料；沒有記錄攀登；手機版沒有修改記錄', items[0] === '分享' && items.at(-1) === '路線資料' && items.some((x) => x.includes('路線說明')) && !items.includes('記錄攀登') && !items.includes('修改記錄'), items.join('|'))
  await rp.getByRole('menuitem', { name: '分享', exact: true }).click()
  const shareSheet = rp.locator('dialog.sheet[open]')
  await shareSheet.locator('.share-item').first().waitFor()
  const shareItems = (await shareSheet.locator('.share-item').allTextContents()).join('|')
  check('分享：選單關掉，從下方滑出 LINE、Facebook、複製連結', shareItems.includes('LINE') && shareItems.includes('複製連結') && (await rp.locator('.tool-pop.menu').count()) === 0, shareItems)
  const cramped = await shareSheet.locator('.share-item').evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth + 1))
  check('分享視窗：文字沒有擠在一起、沒有超出', !cramped)
  await rp.keyboard.press('Escape')
  await rp.locator('.reviews-icon.log').click()
  check('記錄攀登：卡片最下方的圖示打開視窗', (await rp.locator('.sheet[open] .tick-sheet').count()) === 1)
  await rp.keyboard.press('Escape')
  await rp.goto(base + `sector/${topoSector.id}`)
  await rp.waitForSelector('.area-hero-wrap')
  await tool('更多').click()
  check('手機版分區頁：「更多」沒有修改記錄', !(await menuItems()).includes('修改記錄') && (await menuItems()).includes('分享'), (await menuItems()).join('|'))
  await rp.keyboard.press('Escape')
  // 修改記錄只在電腦版：這個分區有修改，「更多」選單有修改記錄
  await rp.setViewportSize({ width: 1366, height: 900 })
  await rp.goto(base + `route/${topoRoutes[0].id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav')
  // 電腦版：左邊分區清單的標題卡也有一組工具，用右邊路線的
  const detailTool = (label: string) => rp.locator('.detail-pane .page-tools').getByRole('button', { name: label, exact: true })
  await detailTool('更多').click()
  await rp.getByRole('menuitem', { name: '修改記錄' }).click()
  check('電腦版修改記錄：展開清單', (await rp.locator('.page-tools .tool-history li').count()) > 0)
  await rp.keyboard.press('Escape')
  // 這個分區沒有任何修改：選單沒有「修改記錄」
  // （有照片的分區有上傳記錄：e2e-report 回報時附的照片也在同一個模擬器裡）
  const photoSectors = new Set(Object.values((await read<Record<string, { sector: string }>>('v2/topos')) ?? {}).map((p) => p.sector))
  const quiet = data.areas.flatMap((a) => a.sectors).find((x) => x.id !== topoSector.id && x.id !== sharedSector.id && !photoSectors.has(x.id) && x.routes.some((r) => r.number))!
  await rp.goto(base + `route/${quiet.routes.find((r) => r.number)!.id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav')
  await detailTool('更多').click()
  check('沒有修改記錄的路線：選單沒有「修改記錄」', !(await menuItems()).includes('修改記錄') && (await menuItems()).includes('分享'), (await menuItems()).join('|'))
  await rp.keyboard.press('Escape')
  await rp.setViewportSize({ width: 390, height: 844 })
  // 區域、分區頁的標題卡：和路線頁同一組工具（最愛、回報位置、更多：分享、編輯），圖示等距
  const favArea = data.areas[2]
  await rp.goto(base + `area/${favArea.id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav')
  check('上一區／下一區用那一區的顏色', (await rp.locator('.pager a.colored').count()) === 2)
  check('區域頁右上：最愛、回報位置、更多', (await tool('加入最愛').count()) === 1 && (await tool('回報位置').count()) === 1 && (await tool('更多').count()) === 1)
  const toolBoxes = await rp.locator('.area-hero-wrap > .page-tools .tool-button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.right]))
  const gaps = toolBoxes.slice(1).map((b, i) => b[0] - toolBoxes[i][1])
  check('標題卡的圖示等距排列', gaps.length === 2 && gaps.every((g) => Math.abs(g - gaps[0]) < 1), gaps.join(' / '))
  await tool('更多').click()
  const areaMenu = await menuItems()
  check('區域頁「更多」：分享、編輯', areaMenu.includes('分享') && areaMenu.some((x) => x.startsWith('編輯')), areaMenu.join('|'))
  await rp.keyboard.press('Escape')
  await tool('回報位置').click()
  check('區域頁回報位置：先選分區（每個分區一個選項）', (await rp.locator('.place-report .chip').count()) === favArea.sectors.length)
  await rp.waitForSelector('.place-report .sm-line')
  check('回報位置的地圖畫出岩壁', (await rp.locator('.place-report .sm-line').count()) > 0)
  await rp.locator('.place-report .chip').first().click()
  check('選了分區：地圖上那個分區的岩壁標成選取', (await rp.locator('.place-report .sm-line.selected').count()) > 0)
  await rp.keyboard.press('Escape')
  // 最愛的區域：首頁排在最前面、名稱旁有愛心；「我的」的最愛也列出來
  await tool('加入最愛').click()
  // 寫進本機資料庫後按鈕才變成已加入；之前換頁會沒存到
  await rp.waitForSelector('.page-tools .tool-button.fav.on')
  await rp.goto(base)
  await rp.waitForSelector('.area-row')
  const firstRow = rp.locator('.area-row').first()
  check('最愛的區域在首頁排最前面、有愛心', ((await firstRow.locator('.area-name').textContent()) ?? '').includes(favArea.name.zh) && (await firstRow.locator('.fav-mark').count()) === 1)
  const heroH = async () => (await rp.locator('.area-hero').boundingBox())!.height
  const homeHero = await heroH()
  await rp.goto(base + `area/${favArea.id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav')
  check('首頁與區域頁的標題卡一樣高', Math.abs(homeHero - (await heroH())) < 1, `${homeHero} / ${await heroH()}`)
  await rp.goto(base + 'me')
  await rp.waitForSelector('.me-m .profile-head')
  const meBoxes = await rp.locator('.me-m :is(.card, .stat-row > div, .checklist-entry, .list-card)').evaluateAll((els) => els.filter((el) => getComputedStyle(el).borderTopWidth !== '0px' || getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)').length)
  check('「我的」整頁一張卡片（和路線卡片同一套）：裡面不再一格一格框起來', (await rp.locator('main .me-m.route-m').count()) === 1 && meBoxes === 0, `${meBoxes}`)
  await rp.getByRole('tab', { name: /最愛/ }).click()
  const favRow = rp.locator('.list-card .route-row', { hasText: favArea.name.zh })
  const [nameBox, rowBox] = [(await favRow.locator('.route-name').boundingBox())!, (await favRow.boundingBox())!]
  check('「我的」最愛：區域的名稱和路線列一樣在名稱欄（不擠在左邊的編號欄）', nameBox.width > rowBox.width / 2, `${nameBox.width} / ${rowBox.width}`)
  check('「我的」最愛：區域也列出來（和路線同樣子、有愛心、路線數）', (await favRow.count()) === 1 && (await favRow.locator('.fav-mark').count()) === 1 && /\d+ 條路線/.test((await favRow.textContent()) ?? ''), (await rp.locator('.list-card').textContent()) ?? '')
  await rp.goto(base + `area/${favArea.id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav.on')
  await tool('已加入最愛').click()
  await rp.waitForSelector('.page-tools .tool-button.fav:not(.on)')
  // 最愛的路線：分區的路線清單排最上面、名稱旁和區域一樣是愛心
  const favRoute = topoSector.routes.filter((r) => r.number).at(-1)!
  await rp.goto(base + `route/${favRoute.id}`)
  await tool('加入最愛').click()
  await rp.waitForSelector('.page-tools .tool-button.fav.on')
  await rp.goto(base + `sector/${topoSector.id}`)
  const topRow = rp.locator('.route-list .route-row').first()
  // 個人資料載入後才排序、標愛心
  const favOnTop = await until(async () => ((await topRow.textContent()) ?? '').includes(favRoute.name.zh) && (await topRow.locator('.fav-mark').count()) === 1 ? true : undefined)
  check('最愛的路線在分區清單排最上面、有愛心（不是星號）', favOnTop === true && !((await topRow.locator('.zh').textContent()) ?? '').includes('★'), (await topRow.textContent()) ?? '')
  await rp.goto(base + `route/${favRoute.id}`)
  await tool('已加入最愛').click()
  await rp.waitForSelector('.page-tools .tool-button.fav:not(.on)')
  // 分區頁回報位置：直接回報這個分區的牆底
  const wallSectorItem = favArea.sectors[0]
  await rp.goto(base + `sector/${wallSectorItem.id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav')
  await tool('回報位置').click()
  check('分區頁回報位置：這個分區的牆底（不必選）', ((await rp.locator('.place-report .map-question').first().textContent()) ?? '').includes(`${wallSectorItem.name.zh} · 牆底`) && (await rp.locator('.place-report .chip').count()) === 0)
  await rp.keyboard.press('Escape')
  // 返回一律回到上一層：換到下一個分區後返回是區域；直接打開的路線返回是分區
  const backSector = data.areas.flatMap((a) => a.sectors).find((x) => x.routes.length > 0)!
  const backArea = data.areas.find((a) => a.sectors.some((x) => x.id === backSector.id))!
  await rp.goto(base + `sector/${backSector.id}`)
  await rp.waitForSelector('.pager .next')
  await rp.locator('.pager .next').click()
  await rp.waitForURL((u) => !u.pathname.endsWith(backSector.id))
  await rp.goBack()
  // 返回先回到上一筆瀏覽紀錄，App 收到後才換成上一層
  await rp.waitForURL((u) => u.pathname === `/area/${backArea.id}`, { timeout: 3000 }).catch(() => {})
  check('換過分區後返回：回到區域，不是上一個分區', new URL(rp.url()).pathname === `/area/${backArea.id}`, rp.url())
  const fresh = await rp.context().newPage()
  await fresh.goto(base + `route/${backSector.routes[0].id}`)
  await fresh.waitForSelector('.route-facts')
  await fresh.goBack()
  check('直接打開的路線返回：回到分區', new URL(fresh.url()).pathname === `/sector/${backSector.id}`, fresh.url())
  await fresh.goBack()
  check('再返回：回到區域', new URL(fresh.url()).pathname === `/area/${backArea.id}`, fresh.url())
  await fresh.close()
  // 安全：只有不是綠燈才在上方顯示警告；拉測、安全評級在路線資料
  type Safe = { id: string; isFixture?: boolean; safety?: string; status?: string; bolts: unknown[]; anchors: unknown[] }
  const everyRoute = data.areas.flatMap((a) => a.sectors).flatMap((x) => x.routes) as unknown as Safe[]
  const warn = everyRoute.find((r) => !r.isFixture && (r.safety === 'yellow' || r.safety === 'red'))
  const green = everyRoute.find((r) => !r.isFixture && r.safety === 'green' && r.status !== 'closed' && r.status !== 'to-remove' && r.bolts.length > 0 && r.anchors.length > 0)!
  if (warn) {
    await rp.goto(base + `route/${warn.id}`)
    await rp.waitForSelector('.route-facts')
    check('非綠燈（小心、危險）：標題卡上顯示警告', (await rp.locator('.area-hero .route-status').count()) === 1)
  }
  await rp.goto(base + `route/${green.id}`)
  await rp.waitForSelector('.route-facts')
  check('綠燈：標題卡上沒有警告', (await rp.locator('.route-status').count()) === 0)
  // 路線卡片：難度、長度、快扣、種類在標題卡裡；說明沒有標題；路線資料一行一項，Bolt 只有摘要，明細點了才展開
  check('難度、長度、快扣、種類在標題卡裡（卡片外沒有另一列）', (await rp.locator('.area-hero .route-facts .route-grade').count()) === 1 && (await rp.locator('.route-facts').count()) === 1)
  check('路線頁的難度沒有難度底色', (await rp.locator('.route-facts .grade-pill').count()) === 0 && (await rp.locator('.route-facts .route-grade').evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(0, 0, 0, 0)')
  // 說明以外的資料（安全與拉測、首攀、備註、Bolt）整份收在說明下面，只有一個 ⓘ 按鈕
  // 說明以外的資料（安全與拉測、首攀、備註、Bolt）：留言右邊的 ⓘ，點了從下方滑出（卡片裡沒有）
  const icons = (await rp.locator('.reviews-bar-icons > button').evaluateAll((els) => els.map((el) => el.className.split(' ')[1]))) as string[]
  check('卡片最下方的圖示：評分、留言、完攀、記錄攀登；卡片裡沒有路線資料', icons.join() === 'rating,comments,sent,log' && (await rp.locator('.route-m .route-data').count()) === 0, icons.join())
  // 完攀：從下方滑出 OS／RP／TR，選了圖示旁邊標出來，重新整理還在，再按一次清除
  await rp.locator('.reviews-icon.sent').click()
  await rp.locator('dialog.sheet[open] .checklist-style', { hasText: 'OS' }).click()
  await rp.keyboard.press('Escape')
  // 寫進本機資料庫後畫面才更新
  check('完攀：選 OS 後圖示旁邊標 OS', await until(async () => ((await rp.locator('.reviews-icon.sent.on').textContent()) ?? '') === 'OS') === true)
  await rp.reload()
  await rp.waitForSelector('.reviews-icon.sent')
  check('完攀：重新整理後還在', await until(async () => ((await rp.locator('.reviews-icon.sent.on').textContent()) ?? '') === 'OS') === true)
  await rp.locator('.reviews-icon.sent').click()
  await rp.locator('dialog.sheet[open] .checklist-style', { hasText: 'OS' }).click()
  await rp.keyboard.press('Escape')
  check('完攀：再按一次清除', await until(async () => (await rp.locator('.reviews-icon.sent.on').count()) === 0) === true)
  await tool('更多').click()
  await rp.getByRole('menuitem', { name: '路線資料' }).click()
  const infoSheet = rp.locator('dialog.sheet[open]')
  await infoSheet.locator('.route-data').waitFor()
  const infoLabels = await infoSheet.locator('.route-data-label').allTextContents()
  check('「更多 › 路線資料」：從下方滑出安全與拉測、Bolt（同一份）', infoLabels.includes('安全與拉測') && infoLabels.includes('Bolt') && ((await infoSheet.textContent()) ?? '').includes('最近拉測'), infoLabels.join())
  // 一整張卡片：標題卡沒有自己的底色與圓角、卡片裡沒有水平分隔線
  check('卡片沒有斷裂：標題卡透明、各段沒有水平分隔線', (await rp.locator('.route-m .area-hero').evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(0, 0, 0, 0)' && (await rp.locator('.route-m .route-block').evaluateAll((els) => els.every((el) => getComputedStyle(el).borderTopWidth === '0px'))))
  // 沒有任何評分：星星和留言圖示一樣是白色（不是星星色）
  const starColor = await rp.locator('.reviews-icon.rating svg').evaluate((el) => getComputedStyle(el).color)
  const commentColor = await rp.locator('.reviews-icon.comments svg').evaluate((el) => getComputedStyle(el).color)
  check('沒有任何評分：星星是白色', (await rp.locator('.reviews-icon.rating.rated').count()) === 0 && starColor === commentColor, `${starColor} / ${commentColor}`)
  check('Bolt 只有摘要（幾支 bolt）、明細收起來', ((await infoSheet.locator('.route-bolts summary').textContent()) ?? '').includes('支 bolt') && !(await infoSheet.locator('.route-bolts table.bolts').isVisible()))
  await infoSheet.locator('.route-bolts summary').click()
  const boltTable = (await infoSheet.locator('.route-bolts table.bolts').boundingBox())!
  const sheetWidth = (await infoSheet.boundingBox())!.width
  check('點 Bolt：明細在下面展開、幾乎滿寬', boltTable.width >= sheetWidth - 48, `${boltTable.width} / ${sheetWidth}`)
  await rp.keyboard.press('Escape')
  // 沒有任何路線資料（固定點、沒有首攀、備註、bolt）：「更多」沒有路線資料
  type Bare = Safe & { firstAscent?: string; notes?: string }
  const bare = (everyRoute as Bare[]).find((r) => r.isFixture && !r.firstAscent && !r.notes && r.bolts.length + r.anchors.length === 0)
  if (bare) {
    await rp.goto(base + `route/${bare.id}`)
    await rp.waitForSelector('.reviews-bar')
    await tool('更多').click()
    check('沒有路線資料：「更多」沒有路線資料', !(await menuItems()).includes('路線資料'), (await menuItems()).join('|'))
    await rp.keyboard.press('Escape')
    await rp.goto(base + `route/${green.id}`)
    await rp.waitForSelector('.reviews-bar')
  }
  check('路線頁最下方有上一條／下一條，沒有「左右滑動可切換」', (await rp.locator('.pager a').count()) >= 1 && !((await rp.locator('.pager').textContent()) ?? '').includes('滑動'))
  check('上一條／下一條用那條路線所在分區的顏色', (await rp.locator('.pager a.colored').count()) >= 1)
  // 電腦版：路線頁右上沒有 ×
  await rp.setViewportSize({ width: 1366, height: 900 })
  await rp.goto(base + `route/${green.id}`)
  await rp.waitForSelector('.detail-pane .route')
  check('電腦版路線頁：右上沒有 ×（Esc 可以關閉）', (await rp.locator('.detail-close').count()) === 0)
  await rp.setViewportSize({ width: 390, height: 844 })
  await rp.goto(base + `route/${topoRoutes[0].id}`)
  // 評價與留言（像 IG）：只有圖示與數字（★ 平均、留言數），下面是最新一則的預覽，沒有文字標籤
  await rp.waitForSelector('.reviews-latest')
  const bar = ((await rp.locator('.reviews-bar-icons').textContent()) ?? '').trim()
  check('評價與留言：只有圖示與數字（沒有「評價與留言」「則留言」等文字）', /^[\d.\s]+$/.test(bar) && (await rp.locator('.reviews-icon svg').count()) >= 2 && (await rp.locator('.reviews').count()) === 0, bar)
  check('有評分的路線：評分只在卡片下方，標題卡沒有', /\d\.\d/.test(bar) && !((await rp.locator('.area-hero').textContent()) ?? '').includes('★'), bar)
  check('評價與留言：預覽最新一則', ((await rp.locator('.reviews-latest').textContent()) ?? '').includes('e2e 留言 5'))
  // 評分：點星星從下方滑出；點一顆星評分，再點同一顆取消（沒有「你的評分」「刪除我的評分」）
  await rp.locator('.reviews-icon.rating').click()
  const ratingSheet = rp.locator('dialog.sheet[open]')
  await ratingSheet.locator('.star-picker').waitFor()
  check('評分視窗：沒有「你的評分」「刪除我的評分」', !/你的評分|刪除我的評分|你覺得/.test((await ratingSheet.textContent()) ?? ''))
  // 還沒選的星星、平均下面沒亮的星星：和視窗底色的對比至少 3:1（深色底上看得到）
  const starContrast = (await rp.evaluate(`(() => {
    const sheet = document.querySelector('dialog.sheet[open]')
    const rgb = (c) => (c.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = (c) => {
      const [r, g, b] = rgb(c).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const bg = getComputedStyle(sheet).backgroundColor
    const ratio = (el) => {
      if (!el) return 0
      const s = getComputedStyle(el)
      if (Number(s.opacity) < 1) return 0
      const [a, b] = [lum(s.color), lum(bg)].sort((x, y) => y - x)
      return (a + 0.05) / (b + 0.05)
    }
    return { picker: ratio(sheet.querySelector('.star-picker button:not(.on)')), dim: ratio(sheet.querySelector('.stars-static .dim')) }
  })()`)) as { picker: number; dim: number }
  check('評分視窗：沒選的星星看得到（對比 ≥ 3）', starContrast.picker >= 3 && starContrast.dim >= 3, JSON.stringify(starContrast))
  const myStars = async () => Object.values((await read<Record<string, { stars: number }>>(`v2/ratings/${rk}`)) ?? {}).map((r) => r.stars).sort().join()
  const ratedBefore = await myStars()
  await ratingSheet.locator('.star-picker button').nth(2).click()
  const rated = await until(async () => ((await myStars()) !== ratedBefore ? await myStars() : undefined))
  check('點第 3 顆星：資料庫多了 3 星', (rated ?? '').split(',').length === ratedBefore.split(',').filter(Boolean).length + 1 && (rated ?? '').includes('3'), `${ratedBefore} → ${rated}`)
  await ratingSheet.locator('.star-picker button').nth(2).click()
  const unrated = await until(async () => ((await myStars()) === ratedBefore ? true : undefined))
  check('再點同一顆：取消評分', unrated === true, await myStars())
  await rp.keyboard.press('Escape')
  // 留言：點留言圖示滑出所有留言，新的在下面，輸入框在最下方；沒有「顯示全部」
  await rp.locator('.reviews-icon.comments').click()
  await rp.waitForSelector('.comments-sheet .comment-m-list li')
  check('留言視窗：全部留言（6 則新留言加原有的），沒有「顯示全部」', (await rp.locator('.comments-sheet .comment-m-list > li').count()) >= 7 && (await rp.locator('.comment-more').count()) === 0)
  check('最新的在最下面', ((await rp.locator('.comments-sheet .comment-m-list > li').last().textContent()) ?? '').includes('e2e 留言 5'))
  check('留言旁邊帶這個人給的星等與體感', (await rp.locator('.reviews .comment-rated', { hasText: '★4' }).count()) > 0)
  // 輸入框固定在視窗最下方（留言多時蓋在清單上、清單在後面捲動）
  const sheetBox = (await rp.locator('dialog.comments-sheet').boundingBox())!
  const composeBox = (await rp.locator('.comments-sheet .review-compose').boundingBox())!
  check('新增留言在最下面', Math.abs(composeBox.y + composeBox.height - (sheetBox.y + sheetBox.height)) <= 2 && (await rp.locator('.comments-sheet .review-compose .star-picker').count()) === 0, `${composeBox.y + composeBox.height} / ${sheetBox.y + sheetBox.height}`)
  // 輸入框一行、沒有提示文字；打了字才出現送出鍵
  const composeHeight = (await rp.locator('.comments-sheet .comment-m-form').boundingBox())!.height
  check('留言輸入框：一行、沒有提示文字、沒打字時沒有送出鍵', composeHeight <= 44 && !(await rp.locator('.review-compose textarea').getAttribute('placeholder')) && (await rp.locator('.review-compose .send').count()) === 0, `${composeHeight}`)
  await rp.locator('.review-compose textarea').fill('e2e 新留言')
  check('打了字才出現送出鍵', (await rp.locator('.review-compose .send').count()) === 1)
  await rp.locator('.review-compose .send').click()
  const posted = await until(async () => (((await rp.locator('.reviews .comment-m-list > li').last().textContent()) ?? '').includes('e2e 新留言') ? true : undefined))
  check('送出留言：出現在最下面', posted === true)
  await rp.locator('.reviews .comment-m-list > li').last().locator('.comment-menu-button').click()
  check('自己的留言：「⋯」選單只有刪除', (await rp.locator('.comment-menu-list button').allTextContents()).join() === '刪除')
  await rp.locator('.comment-menu-list button').click()
  const removed = await until(async () => (((await rp.locator('.reviews .comment-m-list > li').last().textContent()) ?? '').includes('e2e 新留言') ? undefined : true))
  check('刪除：留言消失', removed === true)
  await rp.locator('.reviews .comment-m-list > li').last().locator('.comment-menu-button').click()
  check('別人的留言：「⋯」選單是檢舉', (await rp.locator('.comment-menu-list button').allTextContents()).join() === '檢舉')
  // 點別處關掉選單（留言視窗還開著）
  await rp.locator('.comments-sheet h2').click()

  // ── 9b. 留言按讚、回覆 ──
  const newest = () => rp.locator('.reviews .comment-m-list > li').last()
  const likeButton = () => newest().locator('.comment-like').first()
  const likedBy = async () => Object.keys((await read<Record<string, true>>(`v2/likes/${rk}/e2ecm5`)) ?? {}).sort().join()
  check('別人按的讚：顯示數量 1', ((await likeButton().textContent()) ?? '').trim() === '1' && (await likeButton().getAttribute('aria-pressed')) === 'false')
  await likeButton().click()
  const liked = await until(async () => ((await likeButton().getAttribute('aria-pressed')) === 'true' ? true : undefined))
  check('按讚：變成已按、數量 2、資料庫有我的讚', liked === true && ((await likeButton().textContent()) ?? '').trim() === '2' && (await likedBy()).split(',').length === 2, await likedBy())
  await likeButton().click()
  const unliked = await until(async () => ((await likeButton().getAttribute('aria-pressed')) === 'false' ? true : undefined))
  check('再按一次取消：數量回到 1、資料庫只剩別人的', unliked === true && ((await likeButton().textContent()) ?? '').trim() === '1' && (await likedBy()) === 'seedB', await likedBy())
  await likeButton().click()
  await until(async () => (((await likedBy()).split(',').length === 2) ? true : undefined))

  const topCount = await rp.locator('.reviews .comment-m-list > li').count()
  await newest().locator('.comment-reply-button').first().click()
  check('回覆：展開輸入框', (await newest().locator('.reply-form textarea').count()) === 1)
  await newest().locator('.reply-form textarea').fill('e2e 回覆內容')
  await newest().locator('.reply-form .send').click()
  const replied = await until(async () => (((await newest().locator('.comment-reply').count()) === 1) ? true : undefined))
  check('送出回覆：出現在這則留言下面（自動展開），不是新的一則', replied === true && (await rp.locator('.reviews .comment-m-list > li').count()) === topCount && ((await newest().locator('.comment-reply').textContent()) ?? '').includes('e2e 回覆內容'))
  const stored = await read<Record<string, { text: string; parent?: string }>>(`v2/comments/${rk}`)
  check('資料庫：回覆帶 parent 指向那則留言', Object.values(stored ?? {}).some((c) => c.text === 'e2e 回覆內容' && c.parent === 'e2ecm5'))
  check('回覆不能再被回覆（回覆沒有「回覆」按鈕）', (await newest().locator('.comment-reply .comment-reply-button').count()) === 0)
  await rp.reload()
  await rp.locator('.reviews-icon.comments').click()
  await rp.waitForSelector('.reviews .comment-m-list li')
  check('重新整理：回覆收起來，顯示「查看 1 則回覆」，讚還在', ((await newest().locator('.comment-thread-toggle').textContent()) ?? '').includes('查看 1 則回覆') && (await newest().locator('.comment-reply').count()) === 0 && ((await likeButton().textContent()) ?? '').trim() === '2')
  await newest().locator('.comment-thread-toggle').click()
  await newest().locator('.comment-reply .comment-menu-button').click()
  await newest().locator('.comment-reply .comment-menu-list button').click()
  const replyGone = await until(async () => (((await newest().locator('.comment-thread-toggle').count()) === 0) ? true : undefined))
  check('刪除自己的回覆：回覆消失、沒有「查看回覆」', replyGone === true)
  // 沒登入：看得到讚的數量，不能按讚、回覆
  const guest = await newContext()
  await guest.page.setViewportSize({ width: 390, height: 844 })
  await guest.page.goto(base + `route/${topoRoutes[0].id}`)
  await guest.page.waitForSelector('.reviews-icon.comments')
  check('沒登入：沒有「登入後可…」的文字', !((await guest.page.locator('main').textContent()) ?? '').includes('登入後'))
  await guest.page.locator('.reviews-icon.comments').click()
  await guest.page.waitForSelector('.reviews .comment-m-list li')
  check('沒登入：看得到讚的數量，沒有按讚、回覆的按鈕', ((await guest.page.locator('.reviews .comment-m-list > li').last().locator('.comment-like.static').first().textContent()) ?? '').trim() === '2' && (await guest.page.locator('.reviews button.comment-like').count()) === 0 && (await guest.page.locator('.comment-reply-button').count()) === 0)
  await guest.ctx.close()
  // 觸控手機：點了標題卡右上的按鈕、關掉之後，圓形底要消失（:hover 不會一直留著）
  const tapper = await newContext(undefined, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await tapper.page.goto(base + `route/${topoRoutes[0].id}`)
  const more = tapper.page.locator('.area-hero-wrap .tool-button[aria-haspopup="menu"]')
  await more.tap()
  await more.tap()
  await tapper.page.waitForTimeout(300)
  check('觸控：點了「更多」再關掉，按鈕沒有圓形底', (await more.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(0, 0, 0, 0)', await more.evaluate((el) => getComputedStyle(el).backgroundColor))
  // 觸控手機：往右滑換到上一條，畫面一路往右動（不會先被拉回左邊、新頁面也不會從右邊進來）
  await tapper.page.goto(base + `route/${topoRoutes[1].id}`)
  await tapper.page.waitForSelector('.pager a')
  const fromUrl = tapper.page.url()
  const finger = await tapper.ctx.newCDPSession(tapper.page)
  const swipeTo = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0) => finger.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 760, id: 1 }] })
  await swipeTo('touchStart', 60)
  for (let step = 1; step <= 10; step++) await swipeTo('touchMove', 60 + 22 * step)
  await tapper.page.evaluate(`(() => {
    window.__frames = []
    const t0 = performance.now()
    const tick = () => {
      const el = document.querySelector('main > div')
      if (el) window.__frames.push({ x: el.getBoundingClientRect().left, o: Number(getComputedStyle(el).opacity) })
      if (performance.now() - t0 < 500) requestAnimationFrame(tick)
    }
    tick()
  })()`)
  await swipeTo('touchEnd')
  await tapper.page.waitForTimeout(600)
  const frames = (await tapper.page.evaluate('window.__frames')) as { x: number; o: number }[]
  // 看得到（不透明度 ≥ 0.5）的連續畫面裡不能往左跳：舊頁面往右滑出、淡掉，新頁面才從左邊淡入
  const backward = frames.some((f, i) => i > 0 && f.o >= 0.5 && frames[i - 1].o >= 0.5 && f.x < frames[i - 1].x - 4)
  check('觸控：往右滑換到上一條，畫面不會往左跳（舊頁面往右滑出、新頁面從左邊進來）', tapper.page.url() !== fromUrl && !backward, frames.map((f) => `${Math.round(f.x)}/${f.o.toFixed(1)}`).join(' '))
  await tapper.ctx.close()

  // ── 10. 手機版首頁：天氣（Open-Meteo 換成固定的回應）、日出日落、交通、最近查過；電腦版沒有 ──
  const weatherSample = readFileSync('tests/fixtures/open-meteo.json', 'utf8')
  await rp.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: weatherSample }))
  // 潮汐：今天（台北時間）的資料，和資料檔的日期無關
  const tideFor = (date: string) => JSON.stringify({ location: '海水浴場龍洞灣公園', fetchedAt: 'x', days: [{ date, range: 'spring', tides: [{ time: '05:11', type: 'low' }, { time: '14:01', type: 'high' }] }] })
  const taipeiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  await rp.route('**/data/tide.json', (r) => r.fulfill({ contentType: 'application/json', body: tideFor(taipeiToday) }))
  await rp.setViewportSize({ width: 390, height: 844 })
  await rp.goto(base + `route/${topoRoutes[2].id}`)
  await rp.locator('.reviews-icon.log').click()
  await rp.locator('.tick-sheet button[type=submit]').click()
  await rp.waitForSelector('.sheet[open]', { state: 'detached' })
  // 分區頁的路線清單：難度沒有底色；評分、小心／危險（兩個字）、自己的完攀方式（編號下面）
  const listRow = (number?: string) => rp.locator('.route-list .route-row', { has: rp.locator('.route-no', { hasText: new RegExp(`^#${number}(OS|RP|TR)?$`) }) })
  await rp.goto(base + `sector/${topoSector.id}`)
  await rp.waitForSelector('.route-list .route-row-grade')
  check('分區頁路線清單：難度沒有底色', (await rp.locator('.route-list .grade-pill').count()) === 0 && (await rp.locator('.route-list .route-row-grade').first().evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(0, 0, 0, 0)')
  check('分區頁路線清單：有評分的路線顯示評分', /^★\d\.\d/.test((await listRow(topoRoutes[0].number).locator('.stars-badge').textContent()) ?? ''))
  const sendTags = await rp.locator('.route-list .send-tag').allTextContents()
  check('分區頁路線清單：記錄過的路線在編號下面標完攀方式（RP），其他沒有', sendTags.join() === 'RP' && (await listRow(topoRoutes[2].number).locator('.send-tag').textContent()) === 'RP', sendTags.join())
  if (warn) {
    await rp.goto(base + `sector/${data.areas.flatMap((a) => a.sectors).find((x) => x.routes.some((r) => r.id === warn.id))!.id}`)
    await rp.waitForSelector('.route-list .route-status')
    const flags = await rp.locator('.route-list .route-status').allTextContents()
    check('分區頁路線清單：小心、危險只有兩個字', flags.length > 0 && flags.every((f) => ['!小心', '!危險'].includes(f)), flags.join('|'))
  }
  // 最近查過：看超過 10 秒才算（其他步驟沒打開過的兩條路線）
  const [longView, glance] = data.areas.at(-1)!.sectors.at(-1)!.routes
  await rp.goto(base + `route/${longView.id}`)
  await rp.waitForTimeout(10_500)
  await rp.goto(base + `route/${glance.id}`)
  await rp.waitForTimeout(2_000)
  await rp.goto(base)
  await rp.waitForSelector('.home-m .weather-now')
  check('首頁天氣：目前溫度、天氣與風', ((await rp.locator('.weather-now').textContent()) ?? '').replace(/\s+/g, '') === '23°毛毛雨風5m/s·陣風11·濕度90%', (await rp.locator('.weather-now').textContent()) ?? '')
  const hours = await rp.locator('.weather-hours li').allTextContents()
  check('首頁天氣：接下來 12 小時每兩小時一格，從下一個整點開始', hours.length === 6 && hours[0] === '22:0023°65%' && hours[5].startsWith('08:00'), hours.join('|'))
  check('首頁：日出、日落、預報來源與時間', /日出\s*\d\d:\d\d.*日落\s*\d\d:\d\d/.test((await rp.locator('.sun-times').textContent()) ?? '') && ((await rp.locator('.weather-source').textContent()) ?? '') === 'Open-Meteo 預報 · 21:15 · 潮汐：中央氣象署')
  check('首頁潮汐：今天的潮差與乾潮、滿潮時間', ((await rp.locator('.tide-times').textContent()) ?? '').replace(/\s+/g, '') === '大潮乾潮05:11滿潮14:01', (await rp.locator('.tide-times').textContent()) ?? '')
  const directions = (await rp.locator('.home-links a').evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).href))).map((u) => new URL(u).searchParams)
  check('交通：Google 地圖開車（路況）與大眾運輸，目的地是和美國小', directions.length === 2 && directions.every((p) => p.get('destination') === '25.112353,121.919128') && directions[0].get('travelmode') === 'driving' && directions[1].get('travelmode') === 'transit')
  const viewed = (await rp.locator('.home-recent .route-row').allTextContents()).join('|')
  check('最近查過：看超過 10 秒的路線在最前面', ((await rp.locator('.home-recent .route-row').first().textContent()) ?? '').includes(longView.name.zh), viewed)
  check('最近查過：只看 2 秒的不算', !viewed.includes(glance.name.zh), viewed)
  // 從最近查過進路線：返回到路線的分區，分區是這個分頁的第一筆紀錄（再返回就離開 App）
  const recentPage = await rp.context().newPage()
  await recentPage.setViewportSize({ width: 390, height: 844 })
  await recentPage.goto(base)
  await recentPage.locator('.home-recent .route-row').first().click()
  await recentPage.waitForURL(`**/route/${longView.id}`)
  await recentPage.goBack()
  const longViewSector = data.areas.at(-1)!.sectors.at(-1)!
  await recentPage.waitForURL(`**/sector/${longViewSector.id}`)
  await recentPage.goBack()
  // 新分頁一開始是空白頁：離開 App 就回到那裡
  check('最近查過進路線：返回到分區，再返回就離開 App', recentPage.url() === 'about:blank', recentPage.url())
  await recentPage.close()
  check('首頁的區域清單還在卡片下面', (await rp.locator('.home-m ~ .area-list .area-row').count()) === data.areas.length)
  await rp.unroute('https://api.open-meteo.com/**')
  await rp.route('https://api.open-meteo.com/**', (r) => r.abort())
  await rp.reload()
  await rp.waitForSelector('.home-today .error')
  check('讀不到天氣：一行錯誤訊息，日出日落照樣顯示', (await rp.locator('.weather-now').count()) === 0 && (await rp.locator('.sun-times').count()) === 1)
  await rp.unroute('**/data/tide.json')
  await rp.route('**/data/tide.json', (r) => r.fulfill({ contentType: 'application/json', body: tideFor('2000-01-01') }))
  await rp.reload()
  await rp.waitForSelector('.home-today .sun-times')
  check('潮汐資料沒有今天（每週更新停了）：說出來', await until(async () => (await rp.locator('.home-today').textContent())?.includes('沒有今天的潮汐資料')) === true)
  await rp.unroute('**/data/tide.json')
  await rp.setViewportSize({ width: 1366, height: 900 })
  // 等畫面換成電腦版（區域清單在手機版本來就有，不能拿來等）
  await rp.waitForSelector('.home-m', { state: 'detached' })
  check('電腦版首頁維持原樣：沒有天氣、交通卡片', (await rp.locator('.home-m').count()) === 0 && (await rp.locator('.area-hero.strip').count()) === 1)
  await rp.unroute('https://api.open-meteo.com/**')

  await admin.ctx.close()
  await editor.ctx.close()
} catch (err) {
  check('流程', false, String(err))
} finally {
  const unexpected = logs.filter((l) => !/Failed to load resource|favicon|net::ERR/.test(l))
  if (unexpected.length) {
    console.log('主控台錯誤：\n  ' + unexpected.slice(0, 10).join('\n  '))
    ok = false
  }
  await browser.close()
  server.httpServer.close()
}
process.exit(ok ? 0 : 1)
