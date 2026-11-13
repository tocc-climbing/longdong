import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { elevation, type Terrain } from '../../src/map/terrain'

/** 突變：雙指上下滑仍做平移／縮放、GPU 傾角未更新、標示與地形不同步、每幀輸出 PNG。 */
export async function checkTerrainTilt(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const touchPoints = await page.evaluate(() => navigator.maxTouchPoints)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const svg = page.locator('.terrain-map-view'), rect = (await svg.boundingBox())!
  const x = rect.x+rect.width/2
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number, span = 35) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: x-span, y, id: 1 }, { x: x+span, y, id: 2 }] })
  const pitch = async () => Number(await page.locator('.terrain-map').getAttribute('data-pitch'))
  const width = async () => Number((await svg.getAttribute('viewBox'))!.split(' ')[2])
  const ortho = await page.locator('[data-surface="ortho-base"]').count() > 0
  const surface = page.locator(ortho ? '[data-surface="ortho-base"]' : '[data-surface="all"]')
  const initialWidth = await width(), original = await surface.getAttribute('href')
  await page.evaluate(`window.__tiltPngCalls=0;window.__tiltEncode=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){window.__tiltPngCalls++;return window.__tiltEncode.apply(this,args)}`)
  try {
    const start = rect.y+rect.height*0.7
    await touch('touchStart', start)
    for (let dy = 10; dy <= 110; dy += 10) { await touch('touchMove', start-dy); await page.waitForTimeout(18) }
    // 最後一筆 pointermove 的繪製由 rAF 批次處理，等待畫面提交再讀取。
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('.terrain-map')?.getAttribute('data-pitch'))-52) < 0.5)
    assert(Math.abs(await pitch()-52) < 0.5, '雙指上滑未增加傾角')
    assert.equal(await page.locator('.terrain-map').getAttribute('data-tilting'), 'true')
    assert(Math.abs(await width()-initialWidth) < 0.01, '調整傾角改變縮放比例')
    assert.equal(await page.evaluate('window.__tiltPngCalls'), 0, '傾角手勢中逐幀編碼 PNG')
    assert.equal(await surface.getAttribute('href'), original, '手勢中反覆產生靜態影像')
    const content = await page.locator('[data-terrain-live]').evaluate((el) => {
      const c = el as HTMLCanvasElement, pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let painted = 0
      for (let i = 3; i < pixels.length; i += 128) if (pixels[i] > 200) painted++
      return painted
    })
    assert(content > 100, '調整傾角時沒有實際重畫地形')
    mkdirSync('shots/terrain', { recursive: true })
    await page.screenshot({ path: `shots/terrain/tilt-live-${ortho ? 'ortho' : 'color'}-${Math.round(rect.width)}.png` })
    const id = (await page.locator('[data-terrain-wall]').first().getAttribute('data-terrain-wall'))!.split('#')
    const source = JSON.parse(readFileSync('public/rescue/walls.geojson', 'utf8')).features.find((f: { properties: { sector: string } }) => f.properties.sector === id[0]).geometry.coordinates[Number(id[1])][0]
    const m = 6371000*Math.PI/180, at: [number, number] = [(source[0]-121.92)*m*Math.cos(25.107*Math.PI/180), (25.107-source[1])*m]
    const terrain = JSON.parse(readFileSync('public/rescue/terrain-map-20m.json', 'utf8')) as Terrain
    const expected = at[1]*Math.cos(52*Math.PI/180)-elevation(terrain, at)!*Math.sin(52*Math.PI/180)
    const actual = (await page.locator('[data-terrain-wall]').first().getAttribute('d'))!.match(/^M[-\d.]+,([-\d.]+)/)!
    assert(Math.abs(Number(actual[1])-expected) < 0.1, '岩壁未隨傾角投影')
    const trail = await page.locator('[data-terrain-line="trail"] [data-terrain-trail]').first().evaluate(el => ({ d: el.getAttribute('d')!, dash: el.getAttribute('stroke-dasharray') }))
    assert(!trail.dash && (trail.d.match(/M/g)?.length ?? 0) > 2, '步道虛線仍由投影後的長度切分，調角時會沿路滑動')
    if (ortho) {
      const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(u => u.includes('/PHOTO2/')))
      const level = Math.min(...urls.map(u => Number(u.match(/Compatible\/(\d+)\//)![1])))
      const points = [[550, -500], [550, -200], [550, 100]].map(([x, y]) => ({ x, y, z: elevation(terrain, [x, y])! }))
      const pixels = await page.locator('[data-terrain-live]').evaluate((el, points) => {
        const c = el as HTMLCanvasElement, b = (document.querySelector('.terrain-map-view') as SVGSVGElement).viewBox.baseVal, ctx = c.getContext('2d')!
        return points.map(p => {
          const x = (p.x-b.x)/b.width*c.width, y = (p.y*Math.cos(52*Math.PI/180)-p.z*Math.sin(52*Math.PI/180)-b.y)/b.height*c.height
          return x >= 0 && y >= 0 && x < c.width && y < c.height ? [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data] : undefined
        })
      }, points)
      let checked = 0
      points.forEach((p, i) => {
        if (!pixels[i]) return
        const lng = 121.92+p.x/(m*Math.cos(25.107*Math.PI/180)), lat = (25.107-p.y/m)*Math.PI/180, n = 2**level
        const tx = (lng+180)/360*n, ty = (1-Math.asinh(Math.tan(lat))/Math.PI)/2*n
        const expected = [(tx%1)*256, (ty%1)*256, 50+Math.floor(tx)%2*80+Math.floor(ty)%2*30], actual = pixels[i]!, light = actual[2]/expected[2]
        assert(actual[3] > 250 && light >= 0.82 && light <= 1.03 && Math.abs(actual[0]-expected[0]*light) < 8 && Math.abs(actual[1]-expected[1]*light) < 8, 'GPU 航照未使用手勢的實際傾角')
        checked++
      })
      assert(checked >= 2, '缺少即時航照傾角對位樣點')
    }
    await touch('touchEnd', 0)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-terrain-live]')!).display === 'none')
    assert.notEqual(await surface.getAttribute('href'), original, '手勢結束未輸出新角度影像')
    // 相同傾角下的張合只縮放，不把縮放誤認為傾角。
    await touch('touchStart', rect.y+rect.height*0.5)
    for (let span = 45; span <= 80; span += 5) { await touch('touchMove', rect.y+rect.height*0.5, span); await page.waitForTimeout(18) }
    await touch('touchEnd', 0)
    assert(Math.abs(await pitch()-52) < 0.5 && await width() < initialWidth*0.6, '雙指張合與傾角手勢互相干擾')
    await svg.dispatchEvent('keydown', { key: 'Home' }); await page.waitForTimeout(180)
    assert.equal(await pitch(), 30, 'Home 未恢復 30 度預設角度')
    await touch('touchStart', rect.y+rect.height*0.3)
    for (let dy = 10; dy <= 200; dy += 10) { await touch('touchMove', rect.y+rect.height*0.3+dy); await page.waitForTimeout(18) }
    await touch('touchEnd', 0)
    assert.equal(await pitch(), 0, '雙指下滑未到達俯視角度')
    await touch('touchStart', rect.y+rect.height*0.8)
    for (let dy = 10; dy <= 350; dy += 10) { await touch('touchMove', rect.y+rect.height*0.8-dy); await page.waitForTimeout(18) }
    await touch('touchEnd', 0)
    assert.equal(await pitch(), 60, '傾角未限制在 60 度')
  } finally {
    await page.evaluate('HTMLCanvasElement.prototype.toDataURL=window.__tiltEncode;delete window.__tiltEncode;delete window.__tiltPngCalls')
    await svg.dispatchEvent('keydown', { key: 'Home' }); await page.waitForTimeout(250)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touchPoints > 0, maxTouchPoints: Math.max(1, touchPoints) })
    await cdp.detach()
  }
}
