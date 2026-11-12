/** 以 production build、4 倍 CPU 節流與離線重新整理量測；結果留在 shots/terrain。 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { preview } from 'vite'
import { launch } from './lib/shotDiff'
import { offlinePreview } from './lib/offlinePreview'

const hermetic = process.argv.includes('--offline-preview')
const server = hermetic ? undefined : await preview({ preview: { port: 0, strictPort: false }, logLevel: 'error' })
const browser = await launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: hermetic ? 'block' : 'allow', locale: 'zh-TW' })
  const page = await context.newPage()
  await context.route('https://longdong.firebaseio.com/**', (r) => r.fulfill({ json: null }))
  await context.route('https://api.open-meteo.com/**', (r) => r.abort())
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const base = hermetic ? await offlinePreview(context) : server!.resolvedUrls!.local[0]
  const timings: unknown[] = []
  for (const path of ['/', '/area/longdong/golden-valley', '/sector/longdong/golden-valley-2xxoyr', '/map?view=3d']) {
    await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-terrain="ready"]')
    const ready = await page.evaluate(() => performance.now() - (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domContentLoadedEventEnd)
    // 全圖包含原向量範圍、周邊山坡與完整標記；標題圖維持原本 2 秒預算。
    const budget = path.startsWith('/map') ? 3000 : 2000
    // Playwright 攔截回應會停用 HTTP 快取，不能與原本伺服器／快取基準混為同一門檻。
    // 隔離模式保留首次顯示的量測值，操作幀時間仍照原門檻檢查。
    if (!hermetic) assert(ready < budget, `${path}: 4x CPU 地形顯示 ${ready.toFixed(1)}ms，超過 ${budget/1000} 秒`)
    const frames = await page.evaluate(async () => {
      const gaps: number[] = []
      let previous = performance.now()
      for (let i = 0; i < 90; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const now = performance.now()
        gaps.push(now-previous)
        previous = now
        window.scrollTo(0, Math.sin(i/90*Math.PI)*400)
      }
      gaps.sort((a, b) => a-b)
      return { medianMs: gaps[45], p95Ms: gaps[85], maxMs: gaps[89] }
    })
    assert(frames.p95Ms < 50, `${path}: 捲動 p95 超過 50ms`)
    timings.push({ path, readyAfterDOMContentLoadedMs: ready, ...frames })
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  if (!hermetic) {
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-terrain="ready"]')
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-terrain="ready"]')
    const triangles = await page.locator('.terrain-hero').getAttribute('data-triangles')
    assert(Number(triangles) > 0, '離線重新整理沒有地形')
  }
  writeFileSync('shots/terrain/performance.json', JSON.stringify({ cpuSlowdown: 4, timings, offlineReload: !hermetic, hermeticPreview: hermetic }, null, 2))
  console.log(JSON.stringify({ cpuSlowdown: 4, timings, offlineReload: !hermetic }, null, 2))
} finally {
  await browser.close()
  if (server) await new Promise<void>((resolve) => server.httpServer.close(() => resolve()))
}
