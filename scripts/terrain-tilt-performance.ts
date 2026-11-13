/** 正式建置的雙指傾角效能；不以 React 開發模式的額外檢查估計手機效能。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { preview } from 'vite'
import { launch } from './lib/shotDiff'
import { offlinePreview } from './lib/offlinePreview'

const hermetic = process.argv.includes('--offline-preview')
const server = hermetic ? undefined : await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
const browser = await launch()
mkdirSync('shots/terrain', { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'zh-TW', serviceWorkers: 'block', permissions: ['geolocation'], geolocation: { latitude: 25.108, longitude: 121.923 } })
  const base = hermetic ? await offlinePreview(context) : server!.resolvedUrls!.local[0]
  const page = await context.newPage(), errors: string[] = []
  page.on('pageerror', e => errors.push(e.stack ?? e.message))
  await page.route('https://longdong.firebaseio.com/**', r => r.fulfill({ json: null }))
  if (hermetic) {
    const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d')
    ctx.fillStyle = '#577f96'; ctx.fillRect(0, 0, 256, 256)
    const body = canvas.toBuffer('image/png')
    await page.route('https://wmts.nlsc.gov.tw/wmts/PHOTO2/**', r => r.fulfill({ contentType: 'image/png', body }))
  }
  await page.addInitScript(() => { localStorage.setItem('longdong.map.intro', '1'); localStorage.setItem('longdong.lang', 'zh'); localStorage.removeItem('longdong.map.ortho') })
  await page.goto(new URL('map?view=3d', base).href)
  await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  const cdp = await context.newCDPSession(page), results = []
  for (const ortho of [false, true]) {
    if (ortho) {
      await page.getByRole('button', { name: '航照', exact: true }).click()
      await page.waitForSelector('[data-surface="ortho"][data-image-ready="true"]', { timeout: 60000 })
    }
    const r = (await page.locator('.terrain-map-view').boundingBox())!, x = r.x+r.width/2, y = r.y+r.height*0.6
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.evaluate(`window.__tiltStats=[];window.__tiltRunning=true;window.__tiltPrevious=performance.now();window.__tiltSampler=(now)=>{if(window.__tiltRunning){if(document.querySelector('.terrain-map')?.dataset.tilting==='true')window.__tiltStats.push(now-window.__tiltPrevious);window.__tiltPrevious=now;requestAnimationFrame(window.__tiltSampler)}};requestAnimationFrame(window.__tiltSampler)`)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x-35, y, id: 1 }, { x: x+35, y, id: 2 }] })
    const pitches: number[] = []
    for (let i = 0; i < 60; i++) {
      const py = y-90*Math.sin((i+1)*Math.PI/30)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x-35, y: py, id: 1 }, { x: x+35, y: py, id: 2 }] })
      await page.waitForTimeout(18)
      pitches.push(Number(await page.locator('.terrain-map').getAttribute('data-pitch')))
    }
    const gaps = await page.evaluate('window.__tiltRunning=false;window.__tiltStats') as number[]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    gaps.sort((a, b) => a-b)
    const stats = { ortho, frames: gaps.length, medianMs: gaps[Math.floor(gaps.length*.5)], p95Ms: gaps[Math.floor(gaps.length*.95)], maxMs: gaps.at(-1) }
    console.log(stats); results.push(stats)
    assert(Math.min(...pitches) < 15 && Math.max(...pitches) > 45, '效能測量期間沒有實際調整傾角')
    assert(gaps.length > 20 && stats.p95Ms < 50, '傾角手勢過慢 '+JSON.stringify(stats))
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `shots/terrain/tilt-${ortho ? 'ortho' : 'color'}-30.png` })
  }
  assert.deepEqual(errors, [])
  writeFileSync('shots/terrain/tilt-performance.json', JSON.stringify({ cpuSlowdown: 4, hermeticPreview: hermetic, results }, null, 2))
} finally {
  await browser.close()
  if (server) await new Promise<void>(resolve => server.httpServer.close(() => resolve()))
}
