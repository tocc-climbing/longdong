import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import type { Page } from 'playwright-core'
import { elevation, terrainView, type Terrain } from '../../src/map/terrain'

/** 突變：忽略 bearing、只轉 SVG 疊層、手勢中編碼 PNG、把雙指扭轉誤判成傾角。 */
export async function checkTerrainRotation(page: Page) {
  const map = page.locator('.terrain-map'), svg = page.locator('.terrain-map-view')
  assert.equal(await map.locator('.terrain-map-rotation button').count(), 2, '缺少旋轉按鈕')
  await svg.dispatchEvent('keydown', { key: 'Home' }); await page.waitForTimeout(200)
  const bearing = () => map.getAttribute('data-bearing').then(Number)
  const width = () => svg.getAttribute('viewBox').then((b) => Number(b!.split(' ')[2]))
  const pitch = Number(await map.getAttribute('data-pitch')), originalWidth = await width()
  const ortho = await page.locator('[data-surface="ortho-base"]').count() > 0
  const waitSurface = () => page.waitForSelector(`[data-surface="${ortho ? 'ortho' : 'all'}"][data-image-ready="true"]`)
  await waitSurface()
  const surface = page.locator(ortho ? '[data-surface="ortho-base"]' : '[data-surface="all"]')
  const original = await surface.getAttribute('href')
  await map.locator('.terrain-map-rotation button').last().click()
  await page.waitForFunction(() => Number(document.querySelector('.terrain-map')?.getAttribute('data-bearing')) === 15)
  assert(Math.abs(await width()-originalWidth) < 0.01, '旋轉按鈕改變縮放比例')
  assert.notEqual(await surface.getAttribute('href'), original, '旋轉後沒有重繪地形')
  const wall = page.locator('[data-terrain-wall]').first()
  const [sector, line] = (await wall.getAttribute('data-terrain-wall'))!.split('#')
  const source = JSON.parse(readFileSync('public/rescue/walls.geojson', 'utf8')).features.find((f: { properties: { sector: string } }) => f.properties.sector === sector).geometry.coordinates[Number(line)][0]
  const m = 6371000*Math.PI/180, point: [number, number] = [(source[0]-121.92)*m*Math.cos(25.107*Math.PI/180), (25.107-source[1])*m]
  const terrain = JSON.parse(readFileSync('public/rescue/terrain-map-20m.json', 'utf8')) as Terrain
  const expected = terrainView(point, elevation(terrain, point)!, 15, pitch)
  const actual = (await wall.getAttribute('d'))!.match(/^M([-\d.]+),([-\d.]+)/)!
  assert(Math.abs(Number(actual[1])-expected[0]) < 0.051 && Math.abs(Number(actual[2])-expected[1]) < 0.051, '旋轉後岩壁與地形的投影不一致')
  await map.locator('.mk-compass').click()
  await waitSurface()
  assert.equal(await bearing(), 0, '指北按鈕沒有恢復北向')
  assert(Math.abs(await width()-originalWidth) < 0.01, '回到北向改變縮放比例')

  const cdp = await page.context().newCDPSession(page)
  const touchPoints = await page.evaluate(() => navigator.maxTouchPoints)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const rect = (await svg.boundingBox())!, cx = rect.x+rect.width/2, cy = rect.y+rect.height/2
  let active = false
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', angle: number, radius = 50) => {
    const x = Math.cos(angle*Math.PI/180)*radius, y = Math.sin(angle*Math.PI/180)*radius
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx-x, y: cy-y, id: 1 }, { x: cx+x, y: cy+y, id: 2 }] })
    active = type !== 'touchEnd'
  }
  await page.evaluate(`window.__rotationPngCalls=0;window.__rotationEncode=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){window.__rotationPngCalls++;return window.__rotationEncode.apply(this,args)}`)
  try {
    await touch('touchStart', 0)
    for (let angle = 5; angle <= 40; angle += 5) { await touch('touchMove', angle); await page.waitForTimeout(25) }
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('.terrain-map')?.getAttribute('data-bearing'))-40) < 0.5)
    assert.equal(Number(await map.getAttribute('data-pitch')), pitch, '雙指扭轉誤改傾角')
    assert(Math.abs(await width()-originalWidth) < 0.1, '等距雙指旋轉改變比例')
    assert.equal(await page.evaluate('window.__rotationPngCalls'), 0, '旋轉中逐幀編碼 PNG')
    assert.equal(await map.getAttribute('data-orienting'), 'true')
    const painted = await page.locator('[data-terrain-live]').evaluate((el) => {
      const canvas = el as HTMLCanvasElement, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let count = 0
      for (let i = 3; i < pixels.length; i += 128) if (pixels[i] > 200) count++
      return count
    })
    assert(painted > 100, '旋轉手勢中沒有實際繪製地形')
    mkdirSync('shots/terrain', { recursive: true })
    await page.screenshot({ path: `shots/terrain/rotate-live-${ortho ? 'ortho' : 'color'}-${Math.round(rect.width)}.png` })
    await touch('touchEnd', 40); await page.waitForTimeout(250)
    await map.locator('.mk-compass').click(); await waitSurface()
    await touch('touchStart', 30)
    for (let i = 1; i <= 8; i++) { await touch('touchMove', 30+i*0.35, 50+i*3); await page.waitForTimeout(25) }
    assert.equal(await bearing(), 0, '捏合時的小幅偏移被誤判為旋轉')
    await touch('touchEnd', 30); await page.waitForTimeout(250)
    await svg.dispatchEvent('keydown', { key: 'Home' }); await page.waitForTimeout(150)
    await touch('touchStart', 0)
    for (let i = 1; i <= 8; i++) { await touch('touchMove', i*3, 50+i*2); await page.waitForTimeout(25) }
    await touch('touchEnd', 24)
    assert(Math.abs(await bearing()-24) < 0.5, '捏合與旋轉沒有同時生效')
    assert(await width() < originalWidth/1.25, '旋轉時無法同時放大')
  } finally {
    if (active) await touch('touchEnd', 0)
    await page.evaluate('HTMLCanvasElement.prototype.toDataURL=window.__rotationEncode')
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touchPoints > 0, maxTouchPoints: Math.max(1, touchPoints) })
    await cdp.detach()
  }
  await svg.dispatchEvent('keydown', { key: 'Home' }); await page.waitForTimeout(150)
  await page.keyboard.down('Shift')
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx+80, cy, { steps: 8 }); await page.mouse.up()
  await page.keyboard.up('Shift')
  assert(Math.abs(await bearing()-28) < 0.5, 'Shift 拖曳沒有旋轉')
  await svg.dispatchEvent('keydown', { key: 'Home' }); await page.waitForTimeout(150)
  assert.equal(await bearing(), 0)
  await svg.dispatchEvent('keydown', { key: 'e', ctrlKey: true })
  assert.equal(await bearing(), 0, '旋轉攔截了瀏覽器的 Ctrl 快捷鍵')
}

export async function checkRotationPersistence(page: Page, base: string) {
  await page.goto(new URL('/map?view=3d', base).href, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  const svg = page.locator('.terrain-map-view')
  await svg.dispatchEvent('keydown', { key: '+' }); await svg.dispatchEvent('keydown', { key: '+' })
  await page.waitForTimeout(200)
  await page.locator('.terrain-map-rotation button').last().click()
  await page.locator('.terrain-map-rotation button').last().click()
  const width = Number((await svg.getAttribute('viewBox'))!.split(' ')[2])
  await page.getByRole('button', { name: '3D 地圖', exact: true }).click()
  await page.waitForSelector('.kit-map-host svg[role="img"] > g[transform]')
  const angle = await page.locator('.kit-map-host svg[role="img"] > g[transform]').first().evaluate((el) => {
    const m = (el as SVGGElement).transform.baseVal.consolidate()!.matrix
    return Math.atan2(m.b, m.a)*180/Math.PI
  })
  assert(Math.abs(angle-30) < 0.01, '切回 2D 遺失朝向')
  await page.getByRole('button', { name: '3D 地圖', exact: true }).click()
  await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  assert.equal(Number(await page.locator('.terrain-map').getAttribute('data-bearing')), 30, '切回 3D 遺失朝向')
  assert(Math.abs(Number((await svg.getAttribute('viewBox'))!.split(' ')[2])-width) < 0.01, '切換模式遺失縮放比例')
}

export async function checkRotationUnavailable(page: Page, base: string) {
  await page.addInitScript(`
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : getContext.call(this, type, ...args) }
  `)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(new URL('/map?view=3d', base).href, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.terrain-map [role="alert"]')
  for (const button of await page.locator('.terrain-map-rotation button, .terrain-map .mk-compass').all()) {
    assert(await button.isDisabled(), '無法顯示 3D 時旋轉控制項仍可操作')
  }
  await page.locator('.terrain-map-view').dispatchEvent('keydown', { key: 'e' })
  assert.deepEqual(errors, [], '無 WebGL2 時使用旋轉使 App 崩潰')
}
