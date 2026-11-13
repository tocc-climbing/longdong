import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { preview } from 'vite'
import { launch } from './lib/shotDiff'
import { checkTerrainMap, checkTerrainPresentation, checkTerrainZoomStability } from './lib/terrainMapCheck'
import { offlinePreview } from './lib/offlinePreview'

const hermetic = process.argv.includes('--offline-preview')
const server = hermetic ? undefined : await preview({ preview: { port: 0 }, logLevel: 'error' })
const browser = await launch()
mkdirSync('shots/terrain', { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: hermetic ? 'block' : 'allow', permissions: ['geolocation'], geolocation: { latitude: 25.108, longitude: 121.923 }, locale: 'zh-TW' })
  await context.addInitScript(() => localStorage.setItem('longdong.map.intro', '1'))
  await context.route('https://longdong.firebaseio.com/**', (r) => r.fulfill({ json: null }))
  const page = await context.newPage(), errors: string[] = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => errors.push(e.message))
  const base = hermetic ? await offlinePreview(context) : server!.resolvedUrls!.local[0]
  await checkTerrainMap(page, base)
  console.log('3D 切換、放大、拖曳、滾輪、重設、岩壁點選、區域導覽通過')
  const results: unknown[] = []
  for (const lang of ['zh', 'en', 'ja']) for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((lang) => localStorage.setItem('longdong.lang', lang), lang)
    await page.emulateMedia({ colorScheme: theme })
    for (const [width, height] of [[360, 740], [390, 844], [768, 1024], [1023, 720], [1024, 600], [1280, 720], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height })
      await page.goto(new URL('/map?view=3d', base).href, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
      const state = await page.locator('.terrain-map').evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const texts = [...el.querySelectorAll('[data-label-box]')].map((e) => e.getBoundingClientRect())
        const collisions = texts.flatMap((a, i) => texts.slice(i+1).filter((b) => a.left < b.right-0.1 && b.left < a.right-0.1 && a.top < b.bottom-0.1 && b.top < a.bottom-0.1)).length
        const leaders = el.querySelectorAll('g:has(> [data-terrain-label]) > path').length
        const movedIcons = [...el.querySelectorAll('[data-terrain-label]')].filter((e) => !['area', 'sector', 'place', 'line-name'].includes(e.getAttribute('data-label-kind')!)).filter((e) => {
          const [x, y] = e.getAttribute('data-label-anchor')!.split(',').map(Number), r = e.querySelector('[data-label-box]')!.getBoundingClientRect()
          return Math.abs(r.x+r.width/2-rect.x-x) > 0.1 || Math.abs(r.y+r.height/2-rect.y-y) > 0.1
        }).length
        return { fits: texts.every((r) => r.x >= rect.x && r.right <= rect.right && r.y >= rect.y && r.bottom < rect.bottom-18), collisions, leaders, movedIcons, shown: texts.length, rescue: el.querySelectorAll('[data-label-kind="rescue"]').length, areas: el.querySelectorAll('[data-label-kind="area"]').length, overflow: document.documentElement.scrollWidth > innerWidth, height: rect.height, triangles: Number(el.querySelector('svg')?.getAttribute('data-triangles')) }
      })
      assert(state.fits && !state.overflow && state.height > 200, `${lang}/${theme}/${width}×${height}: 地圖或名稱超出容器 ${JSON.stringify(state)}`)
      assert.equal(state.collisions, 0, `${lang}/${theme}/${width}×${height}: 圖示與文字相互重疊`)
      assert.equal(state.leaders, 0, '名稱仍使用連接線')
      assert.equal(state.movedIcons, 0, '圖示偏離實際位置')
      const presentation = await checkTerrainPresentation(page)
      assert(state.rescue > 0 && state.areas > 0, `${lang}/${theme}/${width}×${height}: 全圖缺少救援編號或區域名稱 ${JSON.stringify(state)}`)
      assert(state.triangles > 0 && state.triangles < 180000, '3D 地圖超出互動網格預算')
      if (lang === 'zh' && theme === 'dark' && [390, 1440].includes(width)) await page.screenshot({ path: `shots/terrain/map-3d-${width}.png` })
      results.push({ lang, theme, width, viewportHeight: height, ...state, ...presentation })
      await checkTerrainZoomStability(page)
    }
  }
  await page.evaluate(() => localStorage.setItem('longdong.lang', 'zh'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(new URL('/map?view=3d', base).href, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const frames = page.evaluate(async () => {
    const gaps: number[] = []; let previous = performance.now()
    for (let i = 0; i < 90; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const now = performance.now(); gaps.push(now-previous); previous = now
    }
    gaps.sort((a, b) => a-b)
    return { medianMs: gaps[45], p95Ms: gaps[85], maxMs: gaps[89] }
  })
  const imageBeforeDrag = await page.locator('.terrain-map image[data-surface="all"]').getAttribute('href')
  await page.mouse.move(280, 600); await page.mouse.down()
  for (let i = 0; i < 40; i++) await page.mouse.move(280-i, 600-i/2)
  assert.equal(await page.locator('.terrain-map image[data-surface="all"]').getAttribute('href'), imageBeforeDrag, '拖曳中重複重算地形影像')
  await page.mouse.up()
  const frameStats = await frames
  assert(frameStats.p95Ms < 50, `4 倍 CPU 節流拖曳 p95 ${frameStats.p95Ms}ms 超過 50ms`)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.locator('.terrain-map-view').focus(); await page.keyboard.press('Home')
  const svg = page.locator('.terrain-map-view'), initial = await svg.getAttribute('viewBox')
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', span: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195-span, y: 470, id: 1 }, { x: 195+span, y: 470, id: 2 }] })
  await touch('touchStart', 35)
  const iconWidths = await page.locator('[data-terrain-label]').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-terrain-label')!, width: el.getBoundingClientRect().width })))
  for (let s = 40; s <= 80; s += 5) {
    await touch('touchMove', s)
    const widths = await page.locator('[data-terrain-label]').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-terrain-label')!, width: el.getBoundingClientRect().width })))
    assert(widths.length > 0 && widths.every((w) => Math.abs(w.width/iconWidths.find((i) => i.id === w.id)!.width-1) < 0.01), '雙指縮放過程圖示尺寸跳動')
  }
  await touch('touchEnd', 0)
  await page.waitForTimeout(350)
  assert(Number((await svg.getAttribute('viewBox'))!.split(' ')[2]) < Number(initial!.split(' ')[2])*0.6, '雙指縮放沒有放大')
  if (!hermetic) {
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  }
  assert.deepEqual(errors, [])
  writeFileSync('shots/terrain/map-check.json', JSON.stringify({ responsive: results, cpuSlowdown: 4, performance: frameStats, pinch: true, offlineReload: !hermetic, hermeticPreview: hermetic }, null, 2))
  console.log('48 種尺寸／語言／主題組合與雙指縮放通過', { ...frameStats, offlineReload: !hermetic })
} finally {
  await browser.close()
  if (server) await new Promise<void>((resolve) => server.httpServer.close(() => resolve()))
}
