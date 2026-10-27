/**
 * 端對端測試（編輯模式）：登入 → 回報 → 去識別副本 → 編輯區域範圍時看到該區的回報 → 地圖編輯（範圍、岩壁、刪除版本）→
 * Topo 標記（復原、重做、提交）→ 看 Topo 的 bolt 切換 → 管理頁的所有輸入、搜尋、處理檢舉（電腦版、手機版）。
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
  // 快捷鍵都是單一按鍵，右側清單的每一列也是按鈕
  await editor.page.keyboard.press('z')
  check('Z 復原：少一塊', (await rings(editor.page)) === n0)
  await editor.page.locator('.key-list button.key-row', { hasText: '重做' }).click()
  check('快捷鍵清單的「重做」按鈕：回到多一塊', (await rings(editor.page)) === n0 + 1)
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
  check('Backspace 移除最後一點：兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('z')
  check('Z 復原：三個點', (await handles()) === 3)
  await editor.page.keyboard.press('y')
  check('Y 重做剛剛復原的移除：兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('y')
  check('Y 沒有可重做的了：還是兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('Control+z')
  check('Ctrl+Z 不是快捷鍵（留給瀏覽器）：還是兩個點', (await handles()) === 2)
  // 右側的快捷鍵清單：每一列是按鈕，按下去和按鍵一樣
  await editor.page.locator('.topo-keys summary').click()
  const keyRow = (name: string) => editor.page.locator('.key-list button.key-row', { hasText: name })
  await keyRow('復原').click()
  check('快捷鍵清單的「復原」按鈕：三個點', (await handles()) === 3)
  await keyRow('重做').click()
  check('快捷鍵清單的「重做」按鈕：兩個點', (await handles()) === 2)
  await editor.page.keyboard.press('z')
  check('Z：回到三個點', (await handles()) === 3)
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
    routes: {
      [key]: { line: '3000,8000 3200,5000 3000,2000', bolts: { B1: '3100,7000', B2: '3150,5500' } },
      [topoRoutes[1].id.replace(/\//g, ':').replace(/\./g, ',')]: { line: '6000,8000 6200,5000 6000,2000' },
    },
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

  const line = viewer.page.locator('figure.topo g.topo-route.link').first()
  await line.locator('.topo-hit').first().click({ force: true })
  await viewer.page.waitForSelector('.detail-pane .route-sub, .detail-pane h1', { timeout: 15000 })
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
  check('全螢幕：右邊列出這張照片上有標記的路線', (await dialog.locator('.topo-full-row').count()) === 2)
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
  check('選到的路線在下面顯示，可以開啟', (await dialog.getByRole('button', { name: '路線頁' }).count()) === 1)
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
