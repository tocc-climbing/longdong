/**
 * 地圖的視覺基準：同一組場景（全圖、區域、岩壁放大、各語言、編輯岩壁與區域與步道、正在畫的多邊形、回報）用實際的瀏覽器畫 ScaleMap 截圖，
 * 與 tests/fixtures/map-shots/ 的基準圖逐像素比對。只有向量（沒有航照、等高線、OpenStreetMap 圖磚），岩壁是原始版。
 *   npm run test:map-shots            比對，超出容許值就失敗（差異圖寫到 shots/map-diff/）
 *   npm run test:map-shots -- --update 重新產生基準（改了呈現、確認新圖正確才做）
 * 別的實作（climbio 的 mapkit）用同一份資料比對外觀與排版：
 *   longdong-map.json      整張地圖的 v2 地圖畫面（scripts/lib/climbioMap.ts）
 *   <名稱>.scene.json       框的大小、語言、畫面（中心經緯度、每像素幾公尺、旋轉）、疊在上面的東西（座標都是經度在前）
 *   <名稱>.map.svg          ScaleMap 畫出來的 SVG（哪些地名、圖示有畫、畫在哪裡）
 * 文字用系統字型，所以只在同一台機器上比對（不進 CI 的 npm test）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import type { LatLng } from '../src/geo'
import { unproject } from '../src/map/mapData'
import type { Dataset } from '../src/data/schema'
import { longdongMap } from './lib/climbioMap'
import { globalId } from './lib/climbio'
import { diff, launch, TOLERANCE } from './lib/shotDiff'
import { SCENES, type MapScene } from './map-shots/scenes'

const update = process.argv.includes('--update')
const dir = new URL('../tests/fixtures/map-shots/', import.meta.url)
const diffDir = new URL('../shots/map-diff/', import.meta.url)

const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat]

/** 從 SVG 的 transform（mapTransform：translate(w/2 h/2) rotate(度) scale(1/s) translate(-cx -cy)）讀回畫面 */
function viewOf(transform: string) {
  const n = transform.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)!.map(Number)
  const [deg, k, cx, cy] = [n[2], n[3], -n[4], -n[5]]
  return { center: lngLat(unproject([cx, cy])), metersPerPixel: 1 / k, rotation: deg }
}

function sceneJson(s: MapScene, transform: string) {
  const sector = (key: string) => globalId(key.split('#')[0])
  return {
    name: s.name,
    frame: { w: s.width, h: s.height },
    lang: s.lang,
    view: viewOf(transform),
    ...(s.focus?.area ? { dim: globalId(`longdong/${s.focus.area}`) } : {}),
    ...(s.walls ? { walls: true, sectorLabels: true } : {}),
    ...(s.selectedWall ? { selected: { node: sector(s.selectedWall), line: Number(s.selectedWall.split('#')[1]) } } : {}),
    ...(s.hideAreas ? { hideAreas: true } : {}),
    ...(s.edit
      ? {
          edit: {
            node: s.edit.target.startsWith('wall:') ? globalId(s.edit.target.slice(5)) : s.edit.target.startsWith('area:') ? globalId(`longdong/${s.edit.target.slice(5)}`) : 'trail',
            selected: s.edit.selected,
            ...(s.edit.faces ? { faces: true } : {}),
          },
        }
      : {}),
    ...(s.draft ? { draft: { points: s.draft.points.map(lngLat), closed: !!s.draft.closed } } : {}),
    ...(s.marks ? { marks: s.marks.map((m) => ({ at: lngLat(m.at), ...(m.picked ? { picked: lngLat(m.picked) } : {}), ...(m.label ? { label: m.label } : {}), ...(m.selected ? { selected: true } : {}) })) } : {}),
    ...(s.here ? { here: { at: lngLat(s.here.coords), accuracy: s.here.accuracy } } : {}),
    ...(s.pick ? { pick: lngLat(s.pick) } : {}),
  }
}

mkdirSync(dir, { recursive: true })
if (update) {
  const dataset = JSON.parse(readFileSync(new URL('../public/data/longdong.json', import.meta.url), 'utf8')) as Dataset
  writeFileSync(new URL('longdong-map.json', dir), JSON.stringify(longdongMap(dataset)) + '\n')
}

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls!.local[0]
const browser = await launch()
const failures: string[] = []
try {
  for (const s of SCENES) {
    const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2 })
    await page.addInitScript((scene) => ((window as unknown as { __scene: unknown }).__scene = scene), s)
    await page.goto(`${base}scripts/map-shots/harness.html`)
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready, undefined, { timeout: 30000 })
    const svg = page.locator('#root svg').first()
    const markup = await svg.evaluate((el) => el.outerHTML)
    const transform = (await page.locator('#root svg > g[transform]').first().getAttribute('transform'))!
    const png = await page.locator('#root').screenshot({ animations: 'disabled' })
    await page.close()
    const file = new URL(`${s.name}.png`, dir)
    if (update) {
      writeFileSync(file, png)
      writeFileSync(new URL(`${s.name}.scene.json`, dir), JSON.stringify(sceneJson(s, transform), null, 1) + '\n')
      writeFileSync(new URL(`${s.name}.map.svg`, dir), markup + '\n')
      console.log(`更新 ${s.name}`)
      continue
    }
    const { ratio, image } = await diff(png, readFileSync(file))
    const ok = ratio <= TOLERANCE
    console.log(`${ok ? '通過' : '失敗'} ${s.name}（差異 ${(ratio * 100).toFixed(3)}%）`)
    if (!ok) {
      failures.push(s.name)
      mkdirSync(diffDir, { recursive: true })
      writeFileSync(new URL(`${s.name}.png`, diffDir), image ?? png)
    }
  }
} finally {
  await browser.close()
  await server.close()
}
if (failures.length) {
  console.error(`外觀與基準不同：${failures.join('、')}（差異圖在 shots/map-diff/）`)
  process.exit(1)
}
