import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { elevation, type Terrain } from '../../src/map/terrain'

/** 突變：只更新 viewBox，讓圖示沿用停止縮放前的比例，等重繪才恢復大小。 */
export async function checkTerrainZoomStability(page: Page) {
  const changes = await page.locator('.terrain-map-view').evaluate(async (node) => {
    const svg = node as SVGSVGElement, changes: number[] = []
    for (const action of ['wheel-in', 'wheel-out', '+', '-']) {
      const labels = [...svg.querySelectorAll('[data-label-box]')].map((el) => ({ el, width: el.getBoundingClientRect().width }))
      if (!labels.length) throw Error('縮放檢查缺少圖示')
      const rect = svg.getBoundingClientRect()
      if (action.startsWith('wheel')) svg.dispatchEvent(new WheelEvent('wheel', { deltaY: action === 'wheel-in' ? -240 : 240, clientX: rect.x+rect.width/2, clientY: rect.y+rect.height/2, bubbles: true, cancelable: true }))
      else svg.dispatchEvent(new KeyboardEvent('keydown', { key: action, bubbles: true, cancelable: true }))
      const start = performance.now()
      do {
        for (const { el, width } of labels) if (el.isConnected) changes.push(Math.abs(el.getBoundingClientRect().width/width-1))
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      } while (performance.now()-start < 250)
    }
    return changes
  })
  assert(changes.length > 0 && Math.max(...changes) < 0.01, `縮放過程圖示尺寸跳動 ${Math.round(Math.max(...changes)*100)}%`)
  await page.locator('.terrain-map-view').dispatchEvent('keydown', { key: 'Home' })
  await page.waitForTimeout(150)
}

export async function checkTerrainPresentation(page: Page) {
  const state = await page.locator('.terrain-map').evaluate((el) => ({
    bluePoints: el.querySelectorAll('[data-wall-location]').length,
    hazards: el.querySelectorAll('[data-label-kind="hazard"]').length,
    glyphs: [...el.querySelectorAll('[data-hazard-glyph]')].map((el) => {
      const glyph = el as SVGGraphicsElement, b = glyph.getBBox()
      const p = new DOMPoint(b.x+b.width/2, b.y+b.height/2).matrixTransform(glyph.getCTM()!).matrixTransform((glyph.parentElement as unknown as SVGGraphicsElement).getCTM()!.inverse())
      return { x: p.x, y: p.y }
    }),
  }))
  assert.equal(state.bluePoints, 0, '仍有分區藍點')
  assert.equal(state.glyphs.length, state.hazards, '警示符號未使用置中的圖形')
  for (const glyph of state.glyphs) assert(Math.abs(glyph.x) < 0.1 && Math.abs(glyph.y-8/3) < 0.6, '警示符號未置中')
  return state
}

/** 突變：移除 3D 切換、縮放或拖曳事件，或讓牆線與區域失去點選入口。 */
export async function checkTerrainMap(page: Page, base: string) {
  await page.addInitScript(() => localStorage.setItem('longdong.map.intro', '1'))
  await page.goto(new URL('/map', base).href, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.kit-map-host .mk-bottom-right')
  const controlLayout = () => page.locator('.kit-map').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return [...el.querySelectorAll('.mk-bottom-right button')].flatMap((b) => {
      const p = b.getBoundingClientRect()
      return p.width && p.height ? [{ label: b.getAttribute('aria-label'), right: r.right-p.right, bottom: r.bottom-p.bottom, w: p.width, h: p.height }] : []
    })
  })
  const controls2D = await controlLayout()
  await page.waitForSelector('.kit-map-host svg > g[transform]')
  const flatCamera = await page.locator('.kit-map-host svg[role="img"]').evaluate((el) => {
    const svg = el as SVGSVGElement, g = svg.querySelector('g[transform]') as SVGGElement, m = g.transform.baseVal.consolidate()!.matrix
    const p = new DOMPoint(svg.width.baseVal.value/2, svg.height.baseVal.value/2).matrixTransform(m.inverse())
    return { x: p.x, y: p.y, scale: 1/Math.hypot(m.a, m.b) }
  })
  await page.getByRole('button', { name: '3D 地圖', exact: true }).click()
  const svg = page.locator('.terrain-map-view')
  await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  await checkTerrainPresentation(page)
  assert.deepEqual(await controlLayout(), controls2D, '3D 控制項未對齊 2D 右下配置')
  assert.equal(await page.locator('.terrain-map-controls, .terrain-map .mk-compass').count(), 0, '3D 仍有額外右上按鈕')
  assert.equal(await page.locator('.terrain-map').getAttribute('data-area-count'), '9', '3D 地圖缺少區域入口')
  assert.equal(await page.locator('.terrain-map').getAttribute('data-poi-count'), '60', '原向量圖的地點與線名未完整載入')
  assert.equal(await page.locator('.terrain-map').getAttribute('data-label-candidates'), '126', '缺少原圖地點、分區或區域標示')
  for (const kind of ['highway', 'road', 'tunnel', 'trail']) assert(await page.locator(`[data-terrain-line="${kind}"]`).count() > 0, `缺少 ${kind} 線層`)
  assert(await page.locator('[data-terrain-polygon="building"]').count() > 0, '缺少聚落建物')
  assert(await page.locator('[data-terrain-wall]').count() > 50, '3D 地圖缺少可點選岩壁')
  assert(await page.locator('[data-terrain-wall]').evaluateAll((paths) => paths.every((p) => p.getAttribute('stroke') === 'transparent' && p.parentElement!.querySelectorAll('path').length === 1)), '仍把 2D 示意線畫成 3D 岩壁輪廓')
  assert(await page.locator('[data-terrain-trail]').count() > 0, '3D 地圖缺少步道')
  const readBox = () => svg.evaluate((e) => { const b = (e as SVGSVGElement).viewBox.baseVal; return [b.x, b.y, b.width, b.height] })
  const initial = await readBox()
  await checkTerrainZoomStability(page)
  const baseMap = JSON.parse(readFileSync('public/rescue/kitbase.json', 'utf8'))
  const viewport = (await svg.boundingBox())!
  assert(Math.abs(initial[2]/viewport.width-flatCamera.scale) < 0.001, '切換 3D 改變了平面地圖比例')
  const [w, s, e, north] = baseMap.props.bounds, m = 6371000*Math.PI/180
  const lat = (s+north)/2-flatCamera.y/m, lng = (w+e)/2+flatCamera.x/(m*Math.cos((s+north)/2*Math.PI/180))
  const centerX = (lng-121.92)*m*Math.cos(25.107*Math.PI/180)
  const centerY = (25.107-lat)*m
  const full = JSON.parse(readFileSync('public/rescue/terrain-map-20m.json', 'utf8')) as Terrain
  assert(Math.abs(initial[0]+initial[2]/2-centerX) < 0.1, '切換 3D 未保留平面地圖中心')
  assert(Math.abs(initial[1]+initial[3]/2-(centerY*0.5-elevation(full, [centerX, centerY])!*Math.sqrt(3)/2)) < 0.1, '切換 3D 未保留平面地圖緯度')
  if (initial[2]/viewport.width > 2.4) {
    assert.equal(await page.locator('[data-label-kind="boat"], [data-label-kind="helicopter"]').count(), 0, '全圖仍擠滿細節標示')
  }
  const image = await page.locator('.terrain-map image[data-surface]').getAttribute('href')
  const painted = await page.evaluate(async (src) => {
    const image = new Image(); image.src = src!; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data, colors = new Set<string>()
    let opaque = 0
    for (let i = 0; i < pixels.length; i += 16) if (pixels[i+3] > 240) { opaque++; colors.add([pixels[i]>>5, pixels[i+1]>>5, pixels[i+2]>>5].join(',')) }
    return { opaque, colors: colors.size }
  }, image)
  assert(painted.opaque > 1000 && painted.colors > 20, '3D 地形沒有實際顯示彩色坡面')
  // 突變：恢復額外抬高，或恢復固定螢幕長度的虛線。
  const checkGroundStart = async (selector: string, source: [number, number], name: string) => {
    const m = 6371000*Math.PI/180, p: [number, number] = [(source[0]-121.92)*m*Math.cos(25.107*Math.PI/180), (25.107-source[1])*m]
    const actual = (await page.locator(selector).first().getAttribute('d'))!.match(/^M([-\d.]+),([-\d.]+)/)!
    assert(Math.abs(Number(actual[1])-p[0]) <= 0.051 && Math.abs(Number(actual[2])-(p[1]*0.5-elevation(full, p)!*Math.sqrt(3)/2)) <= 0.051, `${name}沒有貼合實際高程`)
  }
  const wallId = (await page.locator('[data-terrain-wall]').first().getAttribute('data-terrain-wall'))!.split('#')
  const wallSource = JSON.parse(readFileSync('public/rescue/walls.geojson', 'utf8')).features.find((f: { properties: { sector: string } }) => f.properties.sector === wallId[0]).geometry.coordinates[Number(wallId[1])][0]
  await checkGroundStart('[data-terrain-wall]', wallSource, '岩壁')
  const trailSource = JSON.parse(readFileSync('public/rescue/scale-map.geojson', 'utf8')).features.find((f: { properties: { kind: string }; geometry: { type: string } }) => f.properties.kind === 'trail' && f.geometry.type === 'MultiLineString').geometry.coordinates[0][0]
  await checkGroundStart('[data-terrain-line="trail"] [data-terrain-trail]', trailSource, '步道')
  const dash = page.locator('[data-terrain-line="trail"] [data-terrain-trail]').first()
  const dashState = await dash.evaluate((el) => ({ d: el.getAttribute('d'), pattern: el.getAttribute('stroke-dasharray'), effect: getComputedStyle(el).vectorEffect }))
  assert.equal(dashState.effect, 'none', '虛線仍依螢幕分段，縮放會滑動')
  await page.mouse.click(viewport.x+2, viewport.y+viewport.height/2)
  assert.equal(await svg.evaluate((el) => getComputedStyle(el).outlineStyle), 'none', '滑鼠點選地圖仍出現焦點外框')
  const west = await page.locator('.terrain-map image[data-surface]').evaluate(async (el, z) => {
    const node = el as SVGImageElement, img = new Image(); img.src = node.href.baseVal; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
    return [...ctx.getImageData(Math.round((140-node.x.baseVal.value)/node.width.baseVal.value*img.width), Math.round((-175-z*Math.sqrt(3)/2-node.y.baseVal.value)/node.height.baseVal.value*img.height), 1, 1).data]
  }, elevation(full, [140, -350])!)
  assert(west[3] > 220 && west[1] > west[0] && west[1] > west[2], '原圖西側山坡仍是空白或被攀岩區顏色覆蓋')
  const zoomButton = page.getByRole('button', { name: '放大', exact: true })
  if (await zoomButton.isVisible()) await zoomButton.click()
  else { await svg.focus(); await page.keyboard.press('+') }
  await page.waitForTimeout(250)
  assert((await readBox())[2] < initial[2]*0.8, '3D 放大按鈕無效')
  assert.deepEqual(await dash.evaluate((el) => ({ d: el.getAttribute('d'), pattern: el.getAttribute('stroke-dasharray'), effect: getComputedStyle(el).vectorEffect })), dashState, '縮放後虛線的地圖座標或分段改變')
  assert.notEqual(await page.locator('.terrain-map image[data-surface]').getAttribute('href'), image, '放大後沒有重新繪製高解析度地形')
  const bounds = (await svg.boundingBox())!
  const before = await readBox()
  await page.mouse.move(bounds.x+bounds.width*0.3, bounds.y+bounds.height*0.75)
  await page.mouse.down()
  await page.mouse.move(bounds.x+bounds.width*0.3+55, bounds.y+bounds.height*0.75+30, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const after = await readBox()
  assert(after[0] < before[0] && after[1] < before[1], '3D 拖曳沒有平移地圖')
  await page.mouse.wheel(0, -250)
  await page.waitForTimeout(300)
  assert((await readBox())[2] < after[2], '3D 滾輪沒有縮放')
  await svg.focus(); await page.keyboard.press('Home')
  assert.deepEqual(await readBox(), initial, 'Home 沒有恢復取景')
  await svg.focus()
  await page.keyboard.press('+')
  assert((await readBox())[2] < initial[2], '鍵盤縮放沒有作用')
  await page.keyboard.press('Home')
  await page.waitForTimeout(150)
  assert.deepEqual(await readBox(), initial, '鍵盤 Home 未取消待處理的縮放')
  for (let i = 0; i < 20; i++) await page.keyboard.press('-')
  assert((await readBox())[2] < initial[2]*3, '仍能縮小到遠超出 2D 範圍的視野')
  await page.keyboard.press('Home'); await page.waitForTimeout(150)
  const target = await page.locator('[data-terrain-wall]').evaluateAll((paths) => paths.flatMap((e) => [0.25, 0.5, 0.75].map((f) => {
    const p = e as SVGPathElement, at = p.getPointAtLength(p.getTotalLength()*f), m = p.getScreenCTM()!
    const x = at.x*m.a+at.y*m.c+m.e, y = at.x*m.b+at.y*m.d+m.f
    return { id: p.dataset.terrainWall!, x, y, exposed: document.elementFromPoint(x, y) === p }
  })).find((p) => p.exposed && p.x > 40 && p.y > 160 && p.y < innerHeight-90))
  assert(target, '找不到畫面內的岩壁')
  await page.mouse.click(target.x, target.y)
  await page.waitForSelector('dialog.sheet[open]')
  // 關閉岩壁資料，再確認切回平面仍能操作。
  await page.keyboard.press('Escape')
  await page.mouse.move(target.x, target.y)
  await page.mouse.wheel(0, -950)
  await page.waitForTimeout(350)
  assert.equal(await page.locator('[data-wall-location]').count(), 0, '仍顯示大量藍色分區定位點')
  assert(await page.locator('[data-terrain-sector]').count() > 0, '放大後沒有分區名稱')
  await page.locator('[data-terrain-sector] text').first().click()
  await page.waitForSelector('dialog.sheet[open]')
  await page.keyboard.press('Escape')
  const zoomed = await readBox(), zoomedWidth = (await svg.boundingBox())!.width
  await page.getByRole('button', { name: '3D 地圖', exact: true }).click()
  assert.equal(await page.locator('.terrain-map').count(), 0, '3D 按鈕無法切回 2D')
  await page.waitForSelector('.kit-map-host canvas, .kit-map-host svg')
  const restoredScale = await page.locator('.kit-map-host svg[role="img"] > g[transform]').first().evaluate((el) => {
    const m = (el as SVGGElement).transform.baseVal.consolidate()!.matrix
    return 1/Math.hypot(m.a, m.b)
  })
  assert(Math.abs(restoredScale-zoomed[2]/zoomedWidth) < 0.001, '切回 2D 遺失了縮放比例')
  await page.getByRole('button', { name: '3D 地圖', exact: true }).click()
  await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  assert(Math.abs((await readBox())[2]-zoomed[2]) < 0.01, '切回 3D 遺失了縮放比例')
  const areaLabel = page.locator('[data-terrain-area]').first(), areaId = await areaLabel.getAttribute('data-terrain-area')
  await areaLabel.locator('text').click()
  await page.waitForURL(`**/area/${areaId}`)
  await page.goto(new URL('/map?view=3d', base).href, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.terrain-map-view[data-terrain="ready"]')
  const aerialBox = await readBox()
  // 突變：航照按鈕切回 2D、貼圖沒有按高程投影、UV 顛倒或整張貼圖偏移。
  const aerialRoute = 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/**'
  let releaseTiles!: () => void
  let tileRequests = 0
  const tileGate = new Promise<void>((resolve) => { releaseTiles = resolve })
  await page.route(aerialRoute, async (route) => {
    tileRequests++
    const [, y, x] = route.request().url().match(/\/(\d+)\/(\d+)$/)!.map(Number)
    const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d'), image = ctx.createImageData(256, 256)
    for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) image.data.set([c, r, 50+x%2*80+y%2*30, 255], (r*256+c)*4)
    ctx.putImageData(image, 0, 0)
    await tileGate
    await route.fulfill({ contentType: 'image/png', body: canvas.toBuffer('image/png') })
  })
  await page.getByRole('button', { name: '航照', exact: true }).click()
  const dragX = viewport.x+viewport.width*0.6, dragY = viewport.y+viewport.height*0.65
  await page.mouse.move(dragX, dragY); await page.mouse.down(); await page.mouse.move(dragX+20, dragY)
  const duringLoad = await readBox()
  releaseTiles()
  await page.waitForSelector('[data-surface="ortho"]')
  await page.mouse.move(dragX+21, dragY)
  const afterLoad = await readBox()
  assert(Math.abs(afterLoad[0]-(duringLoad[0]-duringLoad[2]/viewport.width)) < 0.01, `航照載入時把拖曳中的鏡頭退回舊位置 ${JSON.stringify({ duringLoad, afterLoad, viewport })}`)
  await page.mouse.up()
  await svg.dispatchEvent('keydown', { key: 'Home' })
  await page.waitForTimeout(150)
  assert.equal(await page.locator('.terrain-map').count(), 1, '航照仍然切回平面地圖')
  assert.deepEqual(await readBox(), aerialBox, '疊上航照改變了視野或比例')
  assert.equal(await page.getByRole('button', { name: '航照', exact: true }).getAttribute('aria-pressed'), 'true')
  const samples = [[550, -500], [550, -200], [550, 100]].map(([x, y]) => ({ x, y, z: elevation(full, [x, y])! }))
  const pixels = await page.locator('[data-surface="ortho"]').evaluate(async (el, points) => {
    const node = el as SVGImageElement, image = new Image(); image.src = node.href.baseVal; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
    return points.map(({ x, y, z }) => {
      const px = (x-node.x.baseVal.value)/node.width.baseVal.value*image.width, py = (y*0.5-z*Math.sqrt(3)/2-node.y.baseVal.value)/node.height.baseVal.value*image.height
      return px >= 0 && py >= 0 && px < image.width && py < image.height ? [...ctx.getImageData(Math.floor(px), Math.floor(py), 1, 1).data] : undefined
    })
  }, samples)
  const atlasTiles = Number(await page.locator('[data-surface="ortho"]').getAttribute('data-ortho-tiles'))
  const baseTiles = Number(await page.locator('[data-surface="ortho-base"]').getAttribute('data-ortho-tiles'))
  assert(atlasTiles > 0 && atlasTiles <= 64, '航照圖磚超出記憶體預算')
  assert(baseTiles > 0 && baseTiles <= 16, '全圖航照底層超出預算')
  assert.equal(tileRequests, atlasTiles+baseTiles, '相同視野重複載入航照圖磚')
  assert((await page.locator('[data-surface="ortho"]').getAttribute('data-ortho-pixels'))!.split('x').map(Number).every((v) => v > 0 && v <= 2048), '航照紋理尺寸超出預算')
  // 圖磚請求的層級由實際 WMTS 網址取得，檢查地面座標對應的像素顏色。
  const requests = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((url) => url.includes('/PHOTO2/')))
  const z = Number(requests.at(-1)!.match(/Compatible\/(\d+)\//)![1]), n = 2**z
  let checked = 0
  samples.forEach(({ x, y }, i) => {
    if (!pixels[i]) return
    const lng = 121.92+x/(m*Math.cos(25.107*Math.PI/180)), lat = (25.107-y/m)*Math.PI/180
    const tx = (lng+180)/360*n, ty = (1-Math.asinh(Math.tan(lat))/Math.PI)/2*n
    const expected = [(tx%1)*256, (ty%1)*256, 50+Math.floor(tx)%2*80+Math.floor(ty)%2*30]
    const actual = pixels[i]!, light = actual[2]/expected[2]
    assert(actual[3] > 250 && light >= 0.82 && light <= 1.03 && Math.abs(actual[0]-expected[0]*light) < 8 && Math.abs(actual[1]-expected[1]*light) < 8, `航照未按地形座標對位 ${JSON.stringify({ x, y, actual, expected })}`)
    checked++
  })
  assert(checked >= 2, '航照對位檢查缺少可見地點')
  await checkTerrainPhotoContinuity(page)
  await page.getByRole('button', { name: '航照', exact: true }).click()
  assert.equal(await page.locator('[data-surface="ortho"]').count(), 0, '關閉航照仍留下貼圖')
  assert.deepEqual(await readBox(), aerialBox, '關閉航照改變了視野或比例')
  await page.unroute(aerialRoute)
  await page.route(aerialRoute, (r) => r.fulfill({ status: 503, body: '' }))
  await page.getByRole('button', { name: '航照', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '航照 HTTP 503' }).waitFor()
  assert.deepEqual(await readBox(), aerialBox, '航照載入失敗改變了視野')
  await page.getByRole('button', { name: '航照', exact: true }).click()
  await page.unroute(aerialRoute)
  // 回報選點繼續使用平面地圖。
  await page.getByRole('button', { name: '回報', exact: true }).click()
  assert.equal(await page.locator('.terrain-map').count(), 0, '回報選點仍停在傾斜地圖')
}

/** 突變：移除全圖航照、重現分區底色，或在新影像 load 前移除舊影像。 */
export async function checkTerrainPhotoContinuity(page: Page) {
  const svg = page.locator('.terrain-map-view')
  const baseImage = await page.locator('[data-surface="ortho-base"]').getAttribute('href')
  assert(baseImage, '航照缺少全圖底層')
  await page.waitForSelector('[data-surface="ortho"][data-image-ready="true"]')
  const source = await page.locator('[data-surface="ortho"]').getAttribute('href')
  // 用真實 load 事件的攔截重現「新圖已加入，但尚未通知 React 可以移除舊圖」。
  await page.evaluate(() => {
    document.addEventListener('load', (event) => {
      if ((event.target as Element)?.getAttribute?.('data-surface') === 'ortho') event.stopImmediatePropagation()
    }, { capture: true, signal: ((window as unknown as { photoLoadHold: AbortController }).photoLoadHold = new AbortController()).signal })
  })
  await svg.dispatchEvent('keydown', { key: '+' })
  await page.waitForFunction((previous) => document.querySelector('[data-surface="ortho"]')?.getAttribute('href') !== previous, source)
  assert.equal(await page.locator('[data-surface="ortho-previous"]').count(), 1, '新航照完成載入前移除了舊影像')
  assert.equal(await page.locator('[data-surface="ortho-previous"]').getAttribute('href'), source, '新航照完成載入前移除了舊影像')
  await page.evaluate(() => (window as unknown as { photoLoadHold: AbortController }).photoLoadHold.abort())
  await page.locator('[data-surface="ortho"]').dispatchEvent('load')
  await page.waitForFunction(() => !document.querySelector('[data-surface="ortho-previous"]'))
  const zoomed = await page.locator('[data-surface="ortho"]').getAttribute('href')
  // 延遲下一批圖磚，縮小與拖曳後必須由全圖航照補上新露出的範圍。
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const pattern = 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/**'
  const hold = async (route: import('playwright-core').Route) => { await gate; await route.fallback() }
  await page.route(pattern, hold)
  try {
    await svg.dispatchEvent('keydown', { key: '-' })
    await svg.dispatchEvent('keydown', { key: '-' })
    await page.waitForTimeout(250)
    assert.equal(await page.locator('[data-surface="ortho"]').getAttribute('href'), zoomed, '新圖磚未到時丟棄了舊航照')
    assert.equal(await page.locator('[data-surface="ortho-base"]').getAttribute('href'), baseImage, '縮放重新產生全圖底層')
    assert.equal(await page.locator('image[data-surface="all"]').count(), 0, '航照下方仍繪製分區色塊')
    const pixels = await svg.evaluate(async (el) => {
      const svg = el as SVGSVGElement, clone = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      clone.setAttribute('viewBox', svg.getAttribute('viewBox')!)
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', '400'); clone.setAttribute('height', '300')
      for (const image of svg.querySelectorAll('image[data-surface]')) clone.append(image.cloneNode(true))
      const image = new Image(); image.src = 'data:image/svg+xml;base64,'+btoa(new XMLSerializer().serializeToString(clone)); await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      return [60, 340].map((x) => [...ctx.getImageData(x, 150, 1, 1).data])
    })
    assert(pixels.every((p) => p[3] > 245), `縮小時露出未覆蓋範圍 ${JSON.stringify(pixels)}`)
  } finally { release(); await page.unroute(pattern, hold) }
  await svg.dispatchEvent('keydown', { key: 'Home' })
  await page.waitForTimeout(250)
}
