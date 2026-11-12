/** 紅案：拿掉 DTM、把高程壓平、裁切標題圖或讓圖形超出容器時，檢查必須失敗。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { preview } from 'vite'
import { launch } from './lib/shotDiff'
import type { Dataset } from '../src/data/schema'
import { elevation, type Terrain } from '../src/map/terrain'

const dataset = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset
const bytes = readFileSync('public/rescue/terrain-20m.json')
const terrain = JSON.parse(bytes.toString()) as Terrain
assert(bytes.length < 100_000, 'DTM 原檔超過 100KB')
assert(gzipSync(bytes).length < 30_000, 'DTM gzip 超過 30KB')
const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'error' })
const browser = await launch()
mkdirSync('shots/terrain', { recursive: true })
const results: unknown[] = []
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-TW' })
  // 外部資料固定成唯讀的離線情境，避免既有社群版本與網路延遲影響測量。
  await page.route('https://longdong.firebaseio.com/**', (r) => r.fulfill({ json: null }))
  await page.route('https://api.open-meteo.com/**', (r) => r.abort())
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const base = server.resolvedUrls!.local[0]
  const paths = ['/', ...dataset.areas.map((a) => `/area/${a.id}`), ...dataset.areas.flatMap((a) => a.sectors.map((s) => `/sector/${s.id}`))]
  for (const path of paths) {
    console.log('場景', path)
    await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-terrain="ready"]', { timeout: 10000 }).catch(async (error) => {
      await page.screenshot({ path: 'shots/terrain/error.png' })
      console.log(await page.locator('body').innerText(), errors, await page.locator('.terrain-hero').count())
      throw error
    })
    const shape = await page.locator('.terrain-hero').evaluate((el) => ({
      triangles: Number(el.getAttribute('data-triangles')),
      nodes: el.querySelectorAll('path').length,
      invalid: [...el.querySelectorAll('path')].some((p) => /NaN|Infinity/.test(p.getAttribute('d') ?? '')),
    }))
    assert(shape.triangles > 0 && shape.triangles < 360000, `${path}: 地形三角形數量異常`)
    assert(shape.nodes < 250, `${path}: SVG 節點過多`)
    assert(!shape.invalid, `${path}: 投影含無效座標`)
    // 紅案：還原未補值資料或改回深色岩壁描邊。
    assert.equal(await page.locator('.terrain-hero').getAttribute('data-estimated-points'), '5', `${path}: 沒有載入 B5000 海陸判讀後的內插資料`)
    assert.equal(await page.locator('.terrain-hero').getAttribute('data-renderer'), 'webgl', `${path}: 平滑光照未啟用`)
    assert(Number(await page.locator('.terrain-hero').getAttribute('data-wall-coverage')) >= 0.95, `${path}: 新範圍沒有完整涵蓋岩壁`)
    assert(Number(await page.locator('.terrain-hero').getAttribute('data-continuous-coverage')) >= 0.99, `${path}: 區域之間的陸地出現透明斷段`)
    assert(Number(await page.locator('.terrain-hero').getAttribute('data-detail-meters')) < 8, `${path}: 地形仍使用粗網格`)
    assert.equal(await page.locator('[data-region-base]').count(), 0, `${path}: 仍以平面底色掩蓋缺值`)
    assert.equal(await page.locator('[data-climbing-context]').count(), 0, `${path}: 灰色背景仍可能露出岸內`)
    assert.equal(await page.locator('.terrain-surface').getAttribute('clip-path'), null, `${path}: WebGL 仍使用投影後的平面海岸遮罩`)
    assert(Number(await page.locator('.terrain-hero').getAttribute('data-coast-resolution')) <= 2.1, `${path}: 海岸遮罩未與 20m 高度網格分開`)
    if (path === '/area/longdong/long-lane') {
      // 突變：長巷改回原深藍；必須驗證主岸 PNG，不只檢查離岸小礁。
      const href = (await page.locator('image[data-surface="all"]').getAttribute('href'))!
      const image = await loadImage(Buffer.from(href.split(',')[1], 'base64'))
      const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data
      let brightBlue = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i+3] === 255 && pixels[i] > 20 && pixels[i] < 50 && pixels[i+1] > 95 && pixels[i+2] > 170) brightBlue++
      assert(brightBlue > 20, '長巷主岸仍使用過暗的深藍陰影')
    }
    if (path === '/area/longdong/back-door') {
      const href = (await page.locator('image[data-surface="all"]').getAttribute('href'))!
      const image = await loadImage(Buffer.from(href.split(',')[1], 'base64'))
      const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data, shades = new Set<number>()
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i+3] === 255) shades.add(pixels[i])
      assert(shades.size > 40, `單一區域坡面光照仍有明顯色階：${shades.size}`)
    }
    const ink = await page.locator('.terrain-hero').evaluate((el) => [...el.querySelectorAll('path')].some((p) => {
      const stroke = getComputedStyle(p).stroke
      return stroke === 'rgb(23, 45, 48)'
    }))
    assert(!ink, `${path}: 岩壁仍有深色粗描邊`)
    results.push({ path, ...shape })
  }
  const sizes = [[360, 740], [390, 844], [768, 1024], [1023, 720], [1024, 600], [1280, 720], [1440, 900], [1920, 1080]]
  // 黃金谷海岸使用補零海面網格，取代上一版的示意底色。
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-terrain="ready"]')
  assert.equal(await page.locator('.terrain-hero').getAttribute('data-region-count'), String(dataset.areas.length), '總覽缺少區域')
  assert.equal(await page.locator('[data-terrain-island]').count(), 20, '沒有保留 B5000 延伸範圍附近的完整島礁')
  for (const i of [0, 2, 11, 13, 14, 16]) assert.equal(await page.locator(`[data-terrain-island="coast-island-${i}"]`).getAttribute('fill'), dataset.areas.find((a) => a.id.endsWith('/clocktower'))!.color, '圈選的鐘塔海角未沿用鐘塔顏色')
  assert.equal(await page.locator('[data-terrain-island="coast-island-12"]').getAttribute('fill'), '#287fc0', '長巷海角仍使用陰影下過暗的深藍')
  // 實際畫面檢核：新端部要顯示，海灣仍透明。海陸在曲面上依精細遮罩收邊。
  const probes = [{ name: '校門北端', p: [175, -780], land: true }, { name: '後門小半島', p: [365, 380], land: true }, { name: '後門左上多餘邊角', p: [220, 355], land: false }, { name: '外海', p: [409.8, -131.8], land: false }].map(({ name, p, land }) => {
    const angle = 80*Math.PI/180, z = land ? elevation(terrain, [p[0], p[1]])! : 0
    return { name, land, x: p[0]*Math.cos(angle)-p[1]*Math.sin(angle), y: (p[0]*Math.sin(angle)+p[1]*Math.cos(angle))*0.5-z*Math.sqrt(3)/2 }
  })
  const painted = await page.evaluate(`(async () => {
    const svg = document.querySelector('.terrain-hero'), copy = svg.cloneNode(true), rect = svg.getBoundingClientRect(), box = svg.viewBox.baseVal
    copy.setAttribute('xmlns','http://www.w3.org/2000/svg'); copy.setAttribute('width',rect.width); copy.setAttribute('height',rect.height)
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}))
    try {
      const img = new Image(); img.src = url; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(rect.width); canvas.height = Math.ceil(rect.height)
      const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,rect.width,rect.height)
      return ${JSON.stringify(probes)}.map(p => ({name:p.name,land:p.land,alpha:ctx.getImageData(Math.round((p.x-box.x)/box.width*rect.width),Math.round((p.y-box.y)/box.height*rect.height),1,1).data[3]}))
    } finally { URL.revokeObjectURL(url) }
  })()`) as { name: string; land: boolean; alpha: number }[]
  for (const p of painted) assert(p.land ? p.alpha >= 220 : p.alpha <= 10, `海岸裁切／南北延伸錯誤：${JSON.stringify(p)}`)
  for (const island of await page.locator('[data-terrain-island]').all()) {
    const islandBox = await island.boundingBox()
    assert(islandBox && islandBox.width > 0 && islandBox.height > 0, '東側島礁沒有實際顯示')
  }
  await page.locator('.terrain-hero').screenshot({ path: 'shots/terrain/coast-interpolated.png' })
  for (const lang of ['zh', 'en', 'ja']) {
    await page.addInitScript((lang) => localStorage.setItem('longdong.lang', lang), lang)
    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height })
        for (const path of ['/', `/area/${dataset.areas[3].id}`, `/sector/${dataset.areas[3].sectors[0].id}`]) {
          await page.goto(new URL(path, base).href)
          await page.waitForSelector('[data-terrain="ready"]').catch(async (error) => {
            await page.screenshot({ path: 'shots/terrain/responsive-error.png' })
            const state = await page.locator('.terrain-hero').evaluateAll((els) => els.map((e) => ({ state: e.getAttribute('data-terrain'), rect: e.getBoundingClientRect().toJSON() })))
            console.error({ path, lang, theme, width, height, state, errors })
            throw error
          })
          const rect = await page.locator('.terrain-hero').evaluate((el) => {
            const r = el.getBoundingClientRect(), parent = el.parentElement!.getBoundingClientRect()
            return { w: r.width, h: r.height, right: r.right, bottom: r.bottom, parentBottom: parent.bottom, overflow: document.documentElement.scrollWidth > innerWidth }
          })
          assert(rect.w > 80 && rect.h > 50 && !rect.overflow && rect.right <= width+1 && rect.bottom <= rect.parentBottom+1, JSON.stringify({ path, width, height, rect }))
          if (path === '/') {
            const source = (await page.locator('image[data-surface="all"]').getAttribute('href'))!
            const raster = await loadImage(Buffer.from(source.split(',')[1], 'base64'))
            assert(raster.width >= rect.w*1.99 && raster.height >= rect.h*1.99, `首頁輸出解析度不足：${JSON.stringify({ width, height, raster: [raster.width, raster.height], rect })}`)
            // 紅案：地形圖還原成絕對定位背景、或文字改回低對比色。
            const home = await page.evaluate(`(() => {
              const hero = document.querySelector('.area-hero.strip')
              const text = hero.querySelector('.area-hero-text').getBoundingClientRect()
              const map = hero.querySelector('.hero-map').getBoundingClientRect()
              const wide = document.documentElement.dataset.layout === 'wide'
              const gap = wide ? map.left-text.right : map.top-text.bottom
              const swatch = document.createElement('span')
              swatch.style.cssText = 'position:absolute;background:color-mix(in srgb,var(--area-color) 14%,var(--surface))'
              hero.append(swatch)
              const background = getComputedStyle(swatch).backgroundColor
              swatch.remove()
              const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
              const ctx = canvas.getContext('2d')
              const luminance = (color) => {
                ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1)
                const channels = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v/255 <= 0.04045 ? v/255/12.92 : ((v/255+0.055)/1.055)**2.4)
                return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722
              }
              const bg = luminance(background)
              const contrasts = [...hero.querySelectorAll('h1, .area-hero-crag, .page-sub')].filter((el) => el.textContent?.trim()).map((el) => {
                const text = luminance(getComputedStyle(el).color)
                return (Math.max(text, bg)+0.05)/(Math.min(text, bg)+0.05)
              })
              return { gap, wide, contrasts }
            })()`) as { gap: number; wide: boolean; contrasts: number[] }
            assert(home.gap >= 8, `首頁圖文重疊：${JSON.stringify({ lang, theme, width, height, home })}`)
            assert(home.contrasts.every((ratio) => ratio >= 4.5), `首頁文字對比不足：${JSON.stringify({ lang, theme, width, height, home })}`)
          }
          if (lang === 'zh' && (width === 390 || width === 1440)) {
            await page.locator('.area-hero').screenshot({ path: `shots/terrain/${path === '/' ? 'overview' : path.startsWith('/area') ? 'area' : 'sector'}-${theme}-${width}.png` })
          }
        }
      }
    }
  }
  const retina = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: 'zh-TW' })
  await retina.route('https://longdong.firebaseio.com/**', (r) => r.fulfill({ json: null }))
  await retina.route('https://api.open-meteo.com/**', (r) => r.abort())
  await retina.goto(base, { waitUntil: 'domcontentloaded' })
  await retina.waitForSelector('[data-terrain="ready"]')
  const highDensity = await retina.locator('.terrain-hero').boundingBox()
  const highSource = (await retina.locator('image[data-surface="all"]').getAttribute('href'))!
  const highImage = await loadImage(Buffer.from(highSource.split(',')[1], 'base64'))
  assert(highImage.width >= highDensity!.width*2.99, '3 倍像素手機沒有使用對應輸出解析度')
  await retina.close()
  assert.deepEqual(errors, [])
  writeFileSync('shots/terrain/results.json', JSON.stringify({ dtmBytes: bytes.length, dtmGzipBytes: gzipSync(bytes).length, scenes: results, responsiveChecks: 144, interpolatedLandPoints: 5, seaLevelPoints: 1223, coastalIslands: 20, coastSource: 'B5000' }, null, 2))
  console.log(`DTM ${bytes.length} bytes / gzip ${gzipSync(bytes).length} bytes；${paths.length} 個場景、144 個版面檢查通過`)
} finally {
  await browser.close()
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()))
}
