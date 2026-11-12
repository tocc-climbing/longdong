/** 由編輯器同來源 B5000 的藍色海岸線建立陸地多邊形；圖磚只留在快取。 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const z = 18, count = 2**z, size = 256
const world = ([lng, lat]) => [(lng+180)/360*count*size, (1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*count*size]
const lnglat = ([x, y]) => [x/(count*size)*360-180, Math.atan(Math.sinh(Math.PI*(1-2*y/(count*size))))*180/Math.PI]
const nw = world([121.918, 25.1145]), se = world([121.9244, 25.102])
const x0 = Math.floor(nw[0]/size), y0 = Math.floor(nw[1]/size), x1 = Math.floor(se[0]/size), y1 = Math.floor(se[1]/size)
const width = (x1-x0+1)*size, height = (y1-y0+1)*size
const canvas = createCanvas(width, height), ctx = canvas.getContext('2d')
mkdirSync('.cache/b5000', { recursive: true })
const sourceTiles = []
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
  const url = `https://wmts.nlsc.gov.tw/wmts/B5000/default/GoogleMapsCompatible/${z}/${y}/${x}`
  const path = `.cache/b5000/${z}-${x}-${y}.png`
  if (!existsSync(path)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status}: ${url}`)
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()))
  }
  const bytes = readFileSync(path), image = await loadImage(bytes)
  if (image.width !== size || image.height !== size) throw new Error(`圖磚大小不符：${path}`)
  sourceTiles.push({ x, y, sha256: createHash('sha256').update(bytes).digest('hex') })
  ctx.drawImage(image, (x-x0)*size, (y-y0)*size)
}
const rgba = ctx.getImageData(0, 0, width, height).data
const boundary = new Uint8Array(width*height), sea = new Uint8Array(boundary.length)
for (let i = 0; i < boundary.length; i++) boundary[i] = rgba[i*4] === 0 && rgba[i*4+1] === 0 && rgba[i*4+2] === 255 && rgba[i*4+3] > 0 ? 1 : 0
const ink = boundary.slice()
// 圖面在字註／交會處有數像素線隙：閉合半徑 4px（約 2.2m），
// 海面填充後再以相同尺寸侵蝕還原，避免把整條海岸向海擴張。
for (let r = 4; r+4 < height; r++) for (let c = 4; c+4 < width; c++) {
  if (!ink[r*width+c]) continue
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) boundary[(r+dy)*width+c+dx] = 1
}
// 從東側外海辨識海面，不以陸地顏色或 DTM 高度推測海岸。
const queue = new Int32Array(sea.length); let head = 0, tail = 0
const visit = (i) => { if (!boundary[i] && !sea[i]) { sea[i] = 1; queue[tail++] = i } }
// 從東側開放海域進入。
for (let r = 0; r < height; r++) visit(r*width+width-1)
while (head < tail) {
  const i = queue[head++], c = i%width
  if (c) visit(i-1)
  if (c+1 < width) visit(i+1)
  if (i >= width) visit(i-width)
  if (i+width < sea.length) visit(i+width)
}
const horizontal = new Uint8Array(sea.length), restored = new Uint8Array(sea.length)
for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
  for (let dx = -4; dx <= 4; dx++) if (sea[r*width+Math.max(0, Math.min(width-1, c+dx))]) { horizontal[r*width+c] = 1; break }
}
for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
  for (let dy = -4; dy <= 4; dy++) if (horizontal[Math.max(0, Math.min(height-1, r+dy))*width+c]) { restored[r*width+c] = 1; break }
}
sea.set(restored)
const stride = width+1, edges = new Map()
const edge = (x, y, xx, yy) => {
  const a = y*stride+x, b = yy*stride+xx
  if (!edges.has(a)) edges.set(a, [])
  edges.get(a).push(b)
}
for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
  const i = r*width+c
  if (sea[i]) continue
  if (!r || sea[i-width]) edge(c, r, c+1, r)
  if (c+1 === width || sea[i+1]) edge(c+1, r, c+1, r+1)
  if (r+1 === height || sea[i+width]) edge(c+1, r+1, c, r+1)
  if (!c || sea[i-1]) edge(c, r+1, c, r)
}
const point = (key) => [key%stride, Math.floor(key/stride)]
const area = (ring) => ring.reduce((n, a, i) => { const b = ring[(i+1)%ring.length]; return n+a[0]*b[1]-b[0]*a[1] }, 0)/2
function simplify(points, tolerance) {
  if (points.length < 3) return points
  const a = points[0], b = points.at(-1), dx = b[0]-a[0], dy = b[1]-a[1], length = dx*dx+dy*dy
  let distance = 0, split = 0
  for (let i = 1; i+1 < points.length; i++) {
    const p = points[i], u = length ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) : 0
    const d = Math.hypot(p[0]-a[0]-u*dx, p[1]-a[1]-u*dy)
    if (d > distance) { distance = d; split = i }
  }
  return distance <= tolerance ? [a, b] : [...simplify(points.slice(0, split+1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)]
}
const rings = []
while (edges.size) {
  const start = edges.keys().next().value, ring = []; let at = start, previous
  do {
    ring.push(point(at))
    const next = edges.get(at)
    if (!next?.length) throw new Error('海岸像素邊界未閉合')
    let index = 0
    if (next.length > 1 && previous !== undefined) {
      const a = point(previous), b = point(at), dx = b[0]-a[0], dy = b[1]-a[1]
      index = next.findIndex((key) => { const c = point(key); return dx*(c[1]-b[1])-dy*(c[0]-b[0]) > 0 })
      if (index < 0) throw new Error('海岸像素交點無法判定')
    }
    previous = at; at = next.splice(index, 1)[0]
    if (!next.length) edges.delete(previous)
  } while (at !== start)
  ring.push(point(start))
  if (Math.abs(area(ring)) >= 4) rings.push(simplify(ring, 2))
}
const outer = rings.filter((r) => area(r) > 0).sort((a, b) => area(b)-area(a))
if (!outer.length || area(outer[0]) < width*height*0.1) throw new Error('主岸擷取失敗，禁止輸出空白海岸')
if (rings.some((r) => area(r) < 0)) throw new Error('發現內圈，須檢查水域拓撲後再輸出')
const coordinates = outer.map((ring) => [ring.map(([x, y]) => lnglat([x+x0*size, y+y0*size]).map((v) => Number(v.toFixed(7))))])
const westNorth = lnglat([x0*size, y0*size]), eastSouth = lnglat([(x1+1)*size, (y1+1)*size])
const result = {
  source: 'https://wmts.nlsc.gov.tw/wmts/B5000/default/GoogleMapsCompatible/{z}/{y}/{x}',
  sourceInfo: 'https://maps.nlsc.gov.tw/S09SOA/pro/Wmts_ajax_main.jsp',
  attribution: '© 內政部國土測繪中心 · 1/5000 基本地形圖', license: '政府資料開放授權條款第1版',
  accessed: '2026-11-10', surveyDate: null,
  extraction: { method: 'exact-blue-boundary / four-neighbour ocean flood / pixel-edge rings', closeRadiusPixels: 4, restoreRadiusPixels: 4, z, simplifyPixels: 2, minimumAreaPixels: 4, metersPerPixel: 156543.03392804097*Math.cos(25.108*Math.PI/180)/count, sourceTiles },
  extent: [westNorth[0], eastSouth[1], eastSouth[0], westNorth[1]],
  geometry: { type: 'MultiPolygon', coordinates },
}
writeFileSync('scripts/data/coast-b5000.json', JSON.stringify(result)+'\n')
console.log({ polygons: coordinates.length, points: coordinates.flat(2).length, bytes: JSON.stringify(result).length, extent: result.extent })
