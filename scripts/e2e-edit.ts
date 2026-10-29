/**
 * 端對端測試（編輯模式）：登入 → 回報 → 去識別副本 → 編輯區域範圍時看到該區的回報 → 地圖編輯（大區域範圍、分區岩壁、刪除版本）→
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
  areas: { id: string; sectors: { id: string; routes: { id: string; number?: string; bolts?: unknown[]; anchors?: unknown[] }[] }[] }[]
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
  check('不畫 OpenStreetMap 的岩壁', (await editor.page.locator('.sm-cliff').count()) === 0)
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
  check('換到別的分區畫岩壁：地圖範圍不變', !!viewBefore && (await mapTransform()) === viewBefore, `${viewBefore} → ${await mapTransform()}`)
  const shownWall = await until(async () => ((await editor.page.locator('.edit-canvas .sm-line').count()) > 0 && (await editor.page.locator('.edit-canvas .sm-sector-label', { hasText: gateSectorName }).count()) > 0 ? true : undefined), 5000)
  check('畫岩壁時，其他分區已有的岩壁也畫出來', shownWall === true)
  // 地圖頁：放大到校門口，分區名稱標在岩壁中間
  await editor.page.goto(base + 'map')
  const gateLabel = await editor.page.waitForSelector('.sm-label-school-gate', { timeout: 20000 })
  const gateBox = (await gateLabel.boundingBox())!
  await editor.page.mouse.move(gateBox.x + gateBox.width / 2, gateBox.y + gateBox.height / 2)
  for (let i = 0; i < 8; i++) {
    await editor.page.mouse.wheel(0, -300)
    await editor.page.waitForTimeout(150)
  }
  const sectorLabel = await until(async () => ((await editor.page.locator('.sm-sector-label', { hasText: gateSectorName }).count()) > 0 ? true : undefined), 5000)
  check('地圖放大後，分區名稱標在岩壁上', sectorLabel === true)

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
  const emptySector = data.areas.flatMap((a) => a.sectors).find((s) => s.id !== topoSector.id)!
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
  check('右上的工具：收藏、回報位置（圖示）、更多', (await tool('收藏').count()) === 1 && (await tool('回報位置').count()) === 1 && (await tool('更多').count()) === 1)
  check('工具只有圖示、沒有文字，頁面上沒有另一列按鈕', ((await tool('收藏').textContent()) ?? '').trim() === '' && ((await tool('回報位置').textContent()) ?? '').trim() === '' && (await rp.locator('.route-actions').count()) === 0)
  const menuItems = () => rp.locator('.page-tools [role=menuitem]').allTextContents()
  check('「更多」選單一開始收起來', (await menuItems()).length === 0)
  await tool('更多').click()
  const items = await menuItems()
  check('「更多」：分享、記錄攀登、編輯（路線說明）、修改記錄（這個分區有修改才有）', items.includes('分享') && items.includes('記錄攀登') && items.some((x) => x.includes('路線說明')) && items.includes('修改記錄'), items.join('|'))
  await rp.getByRole('menuitem', { name: '分享', exact: true }).click()
  check('分享：展開 LINE、Facebook、複製連結', (await rp.locator('.share-item').allTextContents()).join('|').includes('LINE') && (await rp.locator('.share-item').allTextContents()).join('|').includes('複製連結'))
  await rp.getByRole('menuitem', { name: '記錄攀登' }).click()
  check('記錄攀登：打開視窗', (await rp.locator('.sheet[open]').count()) === 1 && (await rp.locator('.page-tools [role=menuitem]').count()) === 0)
  await rp.keyboard.press('Escape')
  await tool('更多').click()
  await rp.getByRole('menuitem', { name: '修改記錄' }).click()
  check('修改記錄：展開清單', (await rp.locator('.page-tools .tool-history li').count()) > 0)
  await rp.keyboard.press('Escape')
  // 這個分區沒有任何修改：選單沒有「修改記錄」
  const quiet = data.areas.flatMap((a) => a.sectors).find((x) => x.id !== topoSector.id && x.id !== sharedSector.id && x.routes.some((r) => r.number))!
  await rp.goto(base + `route/${quiet.routes.find((r) => r.number)!.id}`)
  await rp.waitForSelector('.page-tools .tool-button.fav')
  await tool('更多').click()
  check('沒有修改記錄的路線：選單沒有「修改記錄」', !(await menuItems()).includes('修改記錄') && (await menuItems()).includes('分享'), (await menuItems()).join('|'))
  // 安全：只有不是綠燈才在上方顯示警告；拉測、安全評級在「更多資訊」
  type Safe = { id: string; isFixture?: boolean; safety?: string; status?: string; bolts: unknown[]; anchors: unknown[] }
  const everyRoute = data.areas.flatMap((a) => a.sectors).flatMap((x) => x.routes) as unknown as Safe[]
  const warn = everyRoute.find((r) => !r.isFixture && (r.safety === 'yellow' || r.safety === 'red'))
  const green = everyRoute.find((r) => !r.isFixture && r.safety === 'green' && r.status !== 'closed' && r.status !== 'to-remove' && r.bolts.length > 0 && r.anchors.length > 0)!
  if (warn) {
    await rp.goto(base + `route/${warn.id}`)
    await rp.waitForSelector('.route-facts')
    check('非綠燈（小心、危險）：上方顯示警告色塊', (await rp.locator('.route-status').count()) === 1)
  }
  await rp.goto(base + `route/${green.id}`)
  await rp.waitForSelector('.route-facts')
  check('綠燈：上方沒有安全色塊', (await rp.locator('.route-status').count()) === 0)
  const summary = (await rp.locator('.route-more summary').textContent()) ?? ''
  check('「更多資訊」摘要：安全與拉測、Bolt / Anchor 合併成一項', summary.includes('安全與拉測') && summary.includes('Bolt / Anchor') && !summary.includes('Anchor 配件'), summary)
  await rp.locator('.route-more summary').click()
  const bolted = green.bolts.length + green.anchors.length > 0
  check('更多資訊：有拉測資訊，Bolt 與 Anchor 在同一張表', ((await rp.locator('.route-more').textContent()) ?? '').includes('最近拉測') && (await rp.locator('.route-more table.bolts').count()) === (bolted ? 1 : 0))
  // 電腦版：路線頁右上沒有 ×
  await rp.setViewportSize({ width: 1366, height: 900 })
  await rp.goto(base + `route/${green.id}`)
  await rp.waitForSelector('.detail-pane .route')
  check('電腦版路線頁：右上沒有 ×（Esc 可以關閉）', (await rp.locator('.detail-close').count()) === 0)
  await rp.setViewportSize({ width: 390, height: 844 })
  await rp.goto(base + `route/${topoRoutes[0].id}`)
  await rp.waitForSelector('.reviews .comment-m-list li')
  check('評價與留言：先顯示最新 5 則，其餘收在「顯示全部」', (await rp.locator('.reviews .comment-m-list li').count()) === 5 && (await rp.locator('.comment-more').count()) === 1)
  check('最新的在最上面', ((await rp.locator('.reviews .comment-m-list li').first().textContent()) ?? '').includes('e2e 留言 5'))
  await rp.locator('.comment-more').click()
  check('顯示全部：6 則新留言加原有的', (await rp.locator('.reviews .comment-m-list li').count()) >= 7 && (await rp.locator('.comment-more').count()) === 0)
  check('留言旁邊帶這個人給的星等與體感', ((await rp.locator('.reviews .comment-rated').first().textContent()) ?? '').includes('★4'))
  check('發表區在留言上面，頭像旁邊有星等與輸入框', (await rp.locator('.review-compose .review-rate .star-picker').count()) === 1 && (await rp.locator('.review-compose textarea').count()) === 1)
  await rp.locator('.review-compose textarea').fill('e2e 新留言')
  await rp.locator('.review-compose .send').click()
  const posted = await until(async () => (((await rp.locator('.reviews .comment-m-list li').first().textContent()) ?? '').includes('e2e 新留言') ? true : undefined))
  check('送出留言：出現在最上面', posted === true)
  await rp.locator('.reviews .comment-m-list li').first().locator('.comment-menu-button').click()
  check('自己的留言：「⋯」選單只有刪除', (await rp.locator('.comment-menu-list button').allTextContents()).join() === '刪除')
  await rp.locator('.comment-menu-list button').click()
  const removed = await until(async () => (((await rp.locator('.reviews .comment-m-list li').first().textContent()) ?? '').includes('e2e 新留言') ? undefined : true))
  check('刪除：留言消失', removed === true)
  await rp.locator('.reviews .comment-m-list li').first().locator('.comment-menu-button').click()
  check('別人的留言：「⋯」選單是檢舉', (await rp.locator('.comment-menu-list button').allTextContents()).join() === '檢舉')
  await rp.keyboard.press('Escape')
  await rp.mouse.click(5, 5)

  // ── 9b. 留言按讚、回覆 ──
  const newest = () => rp.locator('.reviews .comment-m-list > li').first()
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
  await guest.page.waitForSelector('.reviews .comment-m-list li')
  check('沒登入：看得到讚的數量，沒有按讚、回覆的按鈕', ((await guest.page.locator('.reviews .comment-like.static').first().textContent()) ?? '').trim() === '2' && (await guest.page.locator('.reviews button.comment-like').count()) === 0 && (await guest.page.locator('.comment-reply-button').count()) === 0)
  await guest.ctx.close()

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
