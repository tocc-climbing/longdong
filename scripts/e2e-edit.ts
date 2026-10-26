/**
 * 端對端測試（修改模式）：登入 → 回報 → 去識別副本 → 修改區域範圍時看到該區的回報 → 地圖編輯（範圍、岩壁、刪除版本）→
 * Topo 標記（復原、重做、提交）→ 看 Topo 的 bolt 切換 → 管理頁匯入去識別副本。
 * 用 Firebase 模擬器（firebase.e2e.json），不碰正式資料；模擬器載入真正的資料庫規則，一併驗證規則允許這些寫入。
 * 每一項檢查的是「資料庫裡真的有什麼」與「畫面上真的出現什麼」，不是程式內部狀態。
 *
 *   npm run test:e2e        （先跑 scripts/e2e-report.ts，再跑這個）
 */
import { readFileSync } from 'node:fs'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { preview } from 'vite'

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
  areas: { id: string; sectors: { id: string; routes: { id: string; number?: string }[] }[] }[]
}
const topoSector = data.areas.flatMap((a) => a.sectors).find((s) => s.routes.filter((r) => r.number).length >= 3)!
const topoRoutes = topoSector.routes.filter((r) => r.number).slice(0, 3)
const gate = data.areas.find((a) => a.id.endsWith('/school-gate'))!
const wallSector = gate.sectors[0].id
/** 校門口範圍裡的一個位置（areas.geojson 的一塊的中間） */
const AT = { lat: 25.11272, lng: 121.92216 }

const server = await preview({ build: { outDir: 'dist-e2e' }, preview: { port: 4220, strictPort: true }, logLevel: 'silent' })
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

async function newContext(location?: { lat: number; lng: number }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'zh-TW', serviceWorkers: 'block' })
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
const rings = (page: Page) => page.locator('.sm-edit-ring').count()
/** 提交並等畫面說完成（「已儲存」提示）：資料庫收到了、畫面也更新完才繼續，不然接著畫的會被儲存完成時的更新蓋掉 */
async function submitMap(page: Page) {
  await page.waitForSelector('.edit-toast', { state: 'detached', timeout: 10000 }).catch(() => {})
  await page.click('.edit-toolbar .edit-btn.primary')
  await page.waitForSelector('.edit-toast', { timeout: 15000 })
}

try {
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
  await anon.ctx.close()

  // ── 2. 修改區域範圍：看到該區的回報（合併、有幾筆） ──────────────────
  const editor = await newContext()
  await signIn(editor.page, 'editor@example.com')
  await editor.page.goto(base + 'edit/map/area:school-gate')
  await editor.page.waitForSelector('.edit-canvas svg[role=img]')
  const list = await editor.page.waitForSelector('.edit-pins li', { timeout: 15000 }).catch(() => undefined)
  check('修改校門口：右側有回報清單', !!list)
  const text = (await editor.page.locator('.edit-pins').textContent()) ?? ''
  check('同一個點附近的回報合併成一處、標出 2 筆', (await editor.page.locator('.edit-pins li').count()) === 1 && text.includes('2 筆回報') && text.includes('×2'), text.replace(/\s+/g, ' ').slice(0, 120))
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
  await submitMap(editor.page)
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
  check('修改記錄列出兩個版本', (await until(async () => ((await editor.page.locator('.edit-versions li').count()) === 2 ? true : undefined))) === true)
  // 刪除最新的版本（在修改記錄裡）：資料庫少一個、編輯的形狀回到前一版
  await editor.page.locator('.edit-versions li').first().locator('button').click()
  const left = await until(async () => {
    const v = await read<Record<string, unknown>>('v2/mapEdits/area:school-gate')
    return v && Object.keys(v).length === 1 ? v : undefined
  })
  check('刪除最新的版本：資料庫剩第一版', !!left)
  const back = await until(async () => ((await rings(editor.page)) === n0 + 1 ? true : undefined))
  check('編輯的形狀回到前一版（不是載回舊的或停在刪掉的）', back === true, `${await rings(editor.page)} 塊，應為 ${n0 + 1}`)

  // ── 4. 岩壁：分區的「岩壁」可以畫、提交 ──────────────────────────────
  await editor.page.goto(base + `edit/map/wall:${wallSector.replace('/', ':')}`)
  await editor.page.waitForSelector('.edit-canvas svg[role=img]')
  check('網址是岩壁時，切到「岩壁」', (await editor.page.locator('.edit-toolbar [aria-pressed=true]', { hasText: '岩壁' }).count()) === 1)
  await editor.page.keyboard.press('n')
  await clickCanvas(editor.page, [[0.3, 0.4], [0.45, 0.5], [0.6, 0.45]])
  await editor.page.keyboard.press('Enter')
  await submitMap(editor.page)
  const wallKey = `wall:${wallSector.replace('/', ':')}`
  const wall = await until(async () => {
    const v = await read<Record<string, { lines: string }>>(`v2/mapEdits/${wallKey}`)
    return v && Object.keys(v).length === 1 ? v : undefined
  })
  check('提交岩壁：資料庫有一版、一條三點的線', !!wall && Object.values(wall)[0].lines.split('|').length === 1 && Object.values(wall)[0].lines.split(' ').length === 3)

  // ── 5. Topo 標記：復原、重做、移除最後一點、提交 ─────────────────────
  const photo = 'e2ephoto'
  await put(`v2/topos/${photo}`, { sector: topoSector.id, width: 2000, height: 1200, image: `topos/seed/${photo}.jpg`, uid: 'seed', createdAt: Date.now() })
  await editor.page.goto(base + `edit/topo/${photo}`)
  await editor.page.waitForSelector('.topo-route-row')
  const handles = () => editor.page.locator('.topo-handles circle').count()
  const click = (label: string) => editor.page.locator('.topo-tool', { hasText: label }).click()
  const disabled = (label: string) => editor.page.locator('.topo-tool', { hasText: label }).isDisabled()
  check('沒有修改時：復原、重做都不能按', (await disabled('復原')) && (await disabled('重做')))
  check('預設選了第一條有編號的路線，照片下面有這一步的提示', (await editor.page.locator('.topo-route-row.on').count()) === 1 && ((await editor.page.locator('.topo-edit-hint').textContent()) ?? '').includes('點照片'))
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
  check('Backspace 移除最後一點：兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('Control+z')
  check('Ctrl+Z：三個點', (await handles()) === 3)
  await editor.page.keyboard.press('Control+Shift+z')
  check('Ctrl+Shift+Z 重做剛剛復原的移除：兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('Control+y')
  check('Ctrl+Y 沒有可重做的了：還是兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('Control+z')
  check('Ctrl+Z：回到三個點', (await handles()) === 3)
  await editor.page.keyboard.press('ArrowDown')
  const next = topoSector.routes[topoSector.routes.findIndex((r) => r.id === topoRoutes[0].id) + 1]
  check('↓ 換到清單裡的下一條路線', (await editor.page.locator('.topo-route-row.on .topo-route-no').textContent()) === (next.number ?? '·'))
  await editor.page.keyboard.press('ArrowUp')
  await editor.page.click('.topo-edit-bar .action.primary')
  const key = topoRoutes[0].id.replace(/\//g, ':').replace(/\./g, ',')
  const edit = await until(async () => {
    const v = await read<Record<string, { routes: Record<string, { line: string }> }>>(`v2/topoEdits/${photo}`)
    return v && Object.keys(v).length === 1 ? Object.values(v)[0] : undefined
  })
  check('提交 Topo：資料庫有一版、第一條路線三個點', !!edit && edit.routes[key]?.line.split(' ').length === 3)

  // ── 6. 看 Topo：bolt 預設不顯示，按鈕切換 ────────────────────────────
  await put(`v2/topoEdits/${photo}/e2ebolts`, {
    uid: 'seed',
    createdAt: Date.now() + 60000,
    routes: { [key]: { line: '3000,8000 3200,5000 3000,2000', bolts: { B1: '3100,7000', B2: '3150,5500' } } },
  })
  const viewer = await newContext()
  await viewer.page.goto(base + `sector/${topoSector.id}`)
  await viewer.page.waitForSelector('.topo-bolt-toggle', { timeout: 20000 })
  check('bolt 預設不顯示', (await viewer.page.locator('.topo-bolt').count()) === 0)
  await viewer.page.click('.topo-bolt-toggle')
  check('按鈕：顯示 bolt', (await viewer.page.locator('.topo-bolt').count()) === 2)
  await viewer.page.reload()
  await viewer.page.waitForSelector('.topo-bolt-toggle')
  check('選擇會記住（重新整理後還是顯示）', (await viewer.page.locator('.topo-bolt').count()) === 2)
  await viewer.page.click('.topo-bolt-toggle')
  check('再按一次：隱藏', (await viewer.page.locator('.topo-bolt').count()) === 0)
  await viewer.ctx.close()

  // ── 7. 管理頁：匯入已經上傳的回報，已經有的略過 ──────────────────────
  const geo = (note: string, at: [number, number], time: string) => ({ type: 'Feature', properties: { note, accuracy: 9, time }, geometry: { type: 'Point', coordinates: at } })
  const upload = (...f: object[]) => ({ geojson: JSON.stringify({ type: 'FeatureCollection', features: f }), createdAt: Date.now() })
  await put('v2/calibration/seedalice/u1', upload(geo('舊回報一', [121.9231, 25.1124], '2026-10-01T01:00:00.000Z'), geo('舊回報二', [121.9235, 25.1128], '2026-10-01T02:00:00.000Z')))
  await put('v2/anonReports/00000000-0000-4000-8000-000000000000/u1', upload(geo('舊的沒登入回報', [121.9233, 25.1126], '2026-10-02T01:00:00.000Z')))
  const before = Object.keys(await pins()).length
  const admin = await newContext()
  await signIn(admin.page, 'kant.kang@gmail.com')
  await admin.page.goto(base + 'admin')
  await admin.page.getByRole('tab', { name: '地圖回報' }).click()
  const button = admin.page.getByRole('button', { name: '匯入去識別副本給修改者參考' })
  await button.waitFor({ timeout: 20000 })
  await button.click()
  const done = await until(async () => ((await admin.page.getByText(/已匯入 \d+ 筆新的/).count()) > 0 ? await admin.page.getByText(/已匯入 \d+ 筆新的/).first().textContent() : undefined))
  // 3 筆舊的是新的；回報頁上傳過的 2 筆（沒登入）本來就有，代碼相同，略過
  check('匯入：新增 3 筆（登入的 2 筆、沒登入的 1 筆）', !!done && done.includes('已匯入 3 筆新的'), done ?? '')
  check('資料庫多 3 筆、原本的沒被覆蓋', Object.keys(await pins()).length === before + 3)
  check('匯入的副本沒有帳號、裝置代號', !JSON.stringify(await pins()).includes('seedalice') && !JSON.stringify(await pins()).includes('00000000-0000'))
  await button.click()
  const again = await until(async () => ((await admin.page.getByText('已匯入 0 筆新的').count()) > 0 ? true : undefined))
  check('再按一次：全部已經有，新增 0 筆', again === true && Object.keys(await pins()).length === before + 3)
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
