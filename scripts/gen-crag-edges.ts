/**
 * 由國土測繪中心的正射影像（航照）找出岩場岩石帶的兩條邊，給 scripts/gen-scale-map.ts 對齊區域色塊用：
 *   scripts/data/nlsc-crag-edges.json   sea：岩石與海的交界；vegetation：岩石與植物的交界；
 *                                       islet：島礁（不碰到陸地上植物的岩石）與海的交界（[緯度, 經度]，約每 1.5 公尺一點）
 *
 *   npm run crag-edges
 *
 * 每個像素依顏色分成海水（偏藍）、植物（偏綠）、岩石（其他，灰白色），多數決平滑後：
 * 只有和外海連通的水算海（樹林的陰影也偏藍）；只取碰到海的岩石帶（內陸的步道、道路也是灰白色）。
 * 影像：臺灣通用正射影像（WMTS PHOTO2），© 內政部國土測繪中心，政府資料開放授權條款第 1 版。
 */
import { writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

/** 範圍：校門口北邊的岬角到後門南邊的海灣 */
const BOUNDS = { west: 121.9198, east: 121.9256, south: 25.1032, north: 25.1142 }
/** z18 每像素約 0.54 公尺 */
const Z = 18
const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'
/** 多數決平滑的半徑（像素）與次數：去掉零星的誤判（岩縫的陰影、岩石上的小草） */
const SMOOTH_R = 3
const SMOOTH_ROUNDS = 2
/** 邊上的點每 EDGE_CELL 像素取一點 */
const EDGE_CELL = 3

const SEA = 0
const PLANT = 1
const ROCK = 2

const n = 2 ** Z
const tileX = (lng: number) => ((lng + 180) / 360) * n
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
}
const x0 = Math.floor(tileX(BOUNDS.west))
const x1 = Math.floor(tileX(BOUNDS.east))
const y0 = Math.floor(tileY(BOUNDS.north))
const y1 = Math.floor(tileY(BOUNDS.south))
const W = (x1 - x0 + 1) * 256
const H = (y1 - y0 + 1) * 256

const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')
for (let x = x0; x <= x1; x++) {
  for (let y = y0; y <= y1; y++) {
    const res = await fetch(TILE_URL.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y)))
    if (!res.ok) throw new Error(`圖磚 ${Z}/${x}/${y} 下載失敗：HTTP ${res.status}`)
    ctx.drawImage(await loadImage(Buffer.from(await res.arrayBuffer())), (x - x0) * 256, (y - y0) * 256)
  }
}
const pixels = ctx.getImageData(0, 0, W, H).data

let kind = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) {
  const [r, g, b] = [pixels[4 * i], pixels[4 * i + 1], pixels[4 * i + 2]]
  kind[i] = b > g + 3 && b > r + 10 ? SEA : g >= b - 3 && g > r + 3 ? PLANT : ROCK
}
for (let round = 0; round < SMOOTH_ROUNDS; round++) {
  const next = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const count = [0, 0, 0]
      for (let dy = -SMOOTH_R; dy <= SMOOTH_R; dy++) {
        for (let dx = -SMOOTH_R; dx <= SMOOTH_R; dx++) {
          const [xx, yy] = [x + dx, y + dy]
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) count[kind[yy * W + xx]]++
        }
      }
      next[y * W + x] = count[SEA] >= count[PLANT] && count[SEA] >= count[ROCK] ? SEA : count[PLANT] >= count[ROCK] ? PLANT : ROCK
    }
  }
  kind = next
}

const neighbors = (i: number) => {
  const x = i % W
  return [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1].filter((j) => j >= 0)
}
/** 從 seeds 沿著符合 ok 的像素填滿 */
function flood(seeds: number[], ok: (i: number) => boolean): Uint8Array {
  const filled = new Uint8Array(W * H)
  const queue = seeds.filter(ok)
  for (const i of queue) filled[i] = 1
  while (queue.length) {
    for (const j of neighbors(queue.pop()!)) {
      if (!filled[j] && ok(j)) {
        filled[j] = 1
        queue.push(j)
      }
    }
  }
  return filled
}
// 外海：從右邊界（太平洋）開始；其他的水算植物（樹林的陰影）
const sea = flood(
  Array.from({ length: H }, (_, y) => y * W + W - 1),
  (i) => kind[i] === SEA,
)
// 岩石帶：碰到海的岩石
const rock = flood(
  Array.from({ length: W * H }, (_, i) => i).filter((i) => kind[i] === ROCK && neighbors(i).some((j) => sea[j])),
  (i) => kind[i] === ROCK,
)

// 陸地上的植物：從左邊界（陸地）開始連通的植物；島礁上零星的草不算
const landPlant = flood(
  Array.from({ length: H }, (_, y) => y * W),
  (i) => !sea[i] && !rock[i],
)
// 島礁：岩石帶裡互相連通的一塊，不碰到陸地上的植物
const islet = new Uint8Array(W * H)
const visited = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) {
  if (!rock[i] || visited[i]) continue
  const piece = [i]
  visited[i] = 1
  let touchesPlant = false
  for (let k = 0; k < piece.length; k++) {
    for (const j of neighbors(piece[k])) {
      if (rock[j] && !visited[j]) {
        visited[j] = 1
        piece.push(j)
      } else if (landPlant[j]) touchesPlant = true
    }
  }
  if (!touchesPlant) for (const j of piece) islet[j] = 1
}

const toLatLng = (x: number, y: number): [number, number] => {
  const lng = ((x0 + x / 256) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y0 + y / 256)) / n))) * 180) / Math.PI
  return [+lat.toFixed(6), +lng.toFixed(6)]
}
const edges = { sea: [] as [number, number][], vegetation: [] as [number, number][], islet: [] as [number, number][] }
const taken = new Set<string>()
for (let i = 0; i < W * H; i++) {
  if (!rock[i]) continue
  const x = i % W
  const y = (i - x) / W
  const cell = `${Math.floor(x / EDGE_CELL)},${Math.floor(y / EDGE_CELL)}`
  const around = neighbors(i)
  if (around.some((j) => sea[j]) && !taken.has('s' + cell)) {
    taken.add('s' + cell)
    edges.sea.push(toLatLng(x + 0.5, y + 0.5))
    if (islet[i]) edges.islet.push(toLatLng(x + 0.5, y + 0.5))
  }
  if (around.some((j) => !sea[j] && !rock[j]) && !taken.has('v' + cell)) {
    taken.add('v' + cell)
    edges.vegetation.push(toLatLng(x + 0.5, y + 0.5))
  }
}

const source = `臺灣通用正射影像（WMTS PHOTO2，z${Z}），© 內政部國土測繪中心，政府資料開放授權條款第 1 版；${new Date().toISOString().slice(0, 10)} 以 scripts/gen-crag-edges.ts 依顏色分類產生`
writeFileSync(new URL('./data/nlsc-crag-edges.json', import.meta.url), JSON.stringify({ source, ...edges }) + '\n')
console.log(`岩石與海的交界 ${edges.sea.length} 點（島礁 ${edges.islet.length} 點）、岩石與植物的交界 ${edges.vegetation.length} 點`)
