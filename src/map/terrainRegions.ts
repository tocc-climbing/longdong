import type { Pt } from './heroFit'
import type { Terrain, TerrainRegion } from './terrain'

/** 長巷原深藍在陰影中接近海面底色，3D 圖統一使用較明亮的同色系。 */
export function terrainColor(id: string, color: string) {
  return id.split('/').at(-1) === 'long-lane' ? '#287fc0' : color
}

function gridMapper(t: Terrain) {
  const det = t.u[0]*t.v[1]-t.u[1]*t.v[0]
  return ([x, y]: Pt): Pt => {
    const dx = x-t.origin[0], dy = y-t.origin[1]
    return [(dx*t.v[1]-dy*t.v[0])/det, (dy*t.u[0]-dx*t.u[1])/det]
  }
}

/** 約 2m 的主岸遮罩，只建立一次；島礁另以精細 SVG 輪廓與所屬區色描繪。 */
export function terrainCoastMask(t: Terrain, context = false) {
  const scale = t.coast ? 10 : 1, width = t.columns*scale, height = t.rows*scale
  if (!t.coast) {
    const pixels = new Uint8Array(width*height).fill(255)
    for (const [start, length] of t.waterRuns ?? []) pixels.fill(0, start, start+length)
    return { pixels, width, height, meters: Math.hypot(...t.u) }
  }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!, grid = gridMapper(t)
  ctx.fillStyle = '#fff'; ctx.beginPath()
  for (const ring of context ? t.coast.flat() : t.coast[0]) {
    ring.forEach((p, i) => { const [c, r] = grid(p), x = (c+0.5)*scale-0.5, y = (r+0.5)*scale-0.5; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
    ctx.closePath()
  }
  ctx.fill('evenodd')
  const rgba = ctx.getImageData(0, 0, width, height).data, pixels = new Uint8Array(width*height)
  for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[i*4+3]
  return { pixels, width, height, meters: Math.hypot(...t.u)/scale }
}

/** 海岸圖內獨立的實際島礁；只取攀岩區附近，顏色沿用最近區域。 */
export function coastalIslands(t: Terrain, regions: TerrainRegion[]) {
  const extensions = terrainExtensions(t, regions)
  const distance = (p: Pt, ring: Pt[]) => Math.min(...ring.map((a, i) => {
    const b = ring[(i+1)%ring.length], dx = b[0]-a[0], dy = b[1]-a[1], length = dx*dx+dy*dy
    const u = length ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) : 0
    return Math.hypot(p[0]-a[0]-u*dx, p[1]-a[1]-u*dy)
  }))
  return (t.regionCoast ?? t.coast ?? []).slice(1).flatMap((polygon, i) => {
    const ring = polygon[0]
    const center: Pt = [ring.reduce((n, p) => n+p[0], 0)/ring.length, ring.reduce((n, p) => n+p[1], 0)/ring.length]
    // 依圈選圖指定：鐘塔下方外海一組歸鐘塔，長巷下方近岸礁歸長巷。
    const owner = center[0] >= 330 && center[0] <= 470 && center[1] >= -700 && center[1] <= -480
      ? 'clocktower' : Math.hypot(center[0]-335, center[1]+404.8) < 15 ? 'long-lane' : undefined
    const candidates = regions.map((region) => ({ region, distance: Math.min(...[...region.rings, ...extensions.filter((e) => e.region.id === region.id).map((e) => e.ring)].map((r) => distance(center, r))) })).sort((a, b) => a.distance-b.distance)
    const near = owner ? candidates.find((c) => c.region.id === owner) : candidates[0]
    return near && (owner || near.distance <= 100) ? [{ id: `coast-island-${i}`, ring, color: near.region.color }] : []
  })
}

/** 南北只補端部，不重算整張外框，避免把原有西側邊界一起拉寬。 */
export function terrainExtensions(t: Terrain, regions: TerrainRegion[]) {
  const coast = (t.regionCoast ?? t.coast)?.[0]?.[0] ?? []
  const { mainlands } = terrainIslandParts(regions)
  return mainlands.flatMap((region) => {
    const north = region.id === 'school-gate', south = region.id === 'back-door'
    if ((!north && !south) || !coast.length) return []
    const points = region.rings.flat()
    const edge = north ? Math.min(...points.map((p) => p[1])) : Math.max(...points.map((p) => p[1]))
    const west = Math.min(...points.map((p) => p[0]))
    const atEnd = ([x, y]: Pt) => x >= west && (north ? y <= edge+25 : y >= edge-25)
    const shore = coast.filter(atEnd)
    return shore.some((p) => north ? p[1] < edge-10 : p[1] > edge+10)
      ? [{ region, ring: continuousTerrainOutline([...points.filter(atEnd), ...shore]) }] : []
  })
}

export function terrainDomains(t: Terrain, regions: TerrainRegion[]): Pt[][] {
  const { mainlands } = terrainIslandParts(regions)
  const base = continuousTerrainOutline(mainlands.flatMap((r) => [...r.rings.flat(), ...r.walls.flat()]))
  if (!t.coast || !base.length) return [base]
  // 東側鋪色延至海岸外，西側保持原外框；不能讓舊示意區界再切掉裸岩。
  const ys = [...new Set(base.map((p) => p[1]))].sort((a, b) => a-b)
  const east = ys.map((y): Pt => {
    const xs = base.flatMap((a, i) => {
      const b = base[(i+1)%base.length]
      if (a[1] === y) return [a[0]]
      return (a[1] < y) !== (b[1] < y) ? [a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])] : []
    })
    return [Math.max(...xs), y]
  })
  const farEast = Math.max(...(t.regionCoast ?? t.coast).flat(2).map((p) => p[0]))+20
  const apron: Pt[] = [...east, [farEast, ys.at(-1)!], [farEast, ys[0]]]
  apron.reverse()
  return [base, ...terrainExtensions(t, regions).map((e) => e.ring), apron]
}

/** 面積最大者作主岸參考，同緯度位於主岸東側的分離輪廓保留為島礁。 */
export function terrainIslandParts(regions: TerrainRegion[]) {
  const area = (ring: Pt[]) => Math.abs(ring.reduce((sum, a, i) => {
    const b = ring[(i+1)%ring.length]
    return sum+a[0]*b[1]-b[0]*a[1]
  }, 0))
  const islands: { id: string; ring: Pt[]; color: string }[] = []
  const mainlands = regions.map((region) => {
    const main = region.rings.reduce((best, ring) => area(ring) > area(best) ? ring : best, region.rings[0] ?? [])
    const shore: Pt[][] = []
    region.rings.forEach((ring, i) => {
      if (ring === main) { shore.push(ring); return }
      const x = ring.reduce((n, p) => n+p[0], 0)/ring.length
      const y = ring.reduce((n, p) => n+p[1], 0)/ring.length
      const crossings = main.flatMap((a, j) => {
        const b = main[(j+1)%main.length]
        return (a[1] > y) !== (b[1] > y) ? [a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])] : []
      })
      const east = crossings.length ? Math.max(...crossings) : Math.max(...main.map((p) => p[0]))
      if (x > east) islands.push({ id: `${region.id}-${i}`, ring, color: region.color })
      else shore.push(ring)
    })
    return { ...region, rings: shore }
  })
  return { mainlands, islands }
}

/** 所有區域共用一個連續外框，沿真實海陸收邊，區與區只分顏色。 */
export function continuousTerrainOutline(points: Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a[0]-b[0] || a[1]-b[1])
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  const half = (list: Pt[]) => {
    const result: Pt[] = []
    for (const p of list) {
      while (result.length >= 2 && cross(result[result.length-2], result[result.length-1], p) <= 0) result.pop()
      result.push(p)
    }
    return result.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

export function terrainRegionField(t: Terrain, regions: TerrainRegion[], scale: 2 | 3, context = false) {
  const width = t.columns*scale, height = t.rows*scale
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const grid = gridMapper(t)
  const trace = (lines: Pt[][]) => {
    ctx.beginPath()
    for (const line of lines) line.forEach((p, i) => {
      const [c, r] = grid(p), x = (c+0.5)*scale-0.5, y = (r+0.5)*scale-0.5
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y)
    })
  }
  const factor = scale/Math.hypot(...t.u)
  const seeds = regions.flatMap((region) => (region.walls.some((line) => line.length) ? region.walls : region.rings).filter((line) => line.length).map((line) => {
    const points = line.map(grid)
    return { c: points.reduce((n, p) => n+p[0], 0)/points.length, r: points.reduce((n, p) => n+p[1], 0)/points.length, color: [1, 3, 5].map((i) => parseInt(region.color.slice(i, i+2), 16)) }
  }))
  ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff'
  const sum = new Float32Array(width*height), red = new Float32Array(sum.length), green = new Float32Array(sum.length), blue = new Float32Array(sum.length)
  for (const region of regions) {
    ctx.clearRect(0, 0, width, height)
    // 岩壁附近實色，向陸側坡面柔和展開；相鄰區的權重正規化，避免覆蓋順序造成接縫。
    ctx.lineWidth = 28*factor; ctx.shadowColor = '#fff'; ctx.shadowBlur = 18*factor
    trace(region.walls); ctx.stroke()
    const mask = ctx.getImageData(0, 0, width, height).data
    const color = [1, 3, 5].map((i) => parseInt(region.color.slice(i, i+2), 16))
    for (let i = 0; i < sum.length; i++) {
      const weight = (mask[i*4+3]/255)**2
      sum[i] += weight; red[i] += color[0]*weight; green[i] += color[1]*weight; blue[i] += color[2]*weight
    }
  }
  ctx.clearRect(0, 0, width, height)
  ctx.shadowBlur = 0; ctx.lineWidth = 40*factor; ctx.fillStyle = '#fff'
  const domains = terrainDomains(t, regions)
  // 陸側邊界以 12m 過渡接回山坡，避免北側延伸的凸包顯成直角色塊；海岸仍由精細遮罩裁切。
  ctx.filter = `blur(${12*factor}px)`
  trace(domains.map((ring) => [...ring, ring[0]])); ctx.fill(); ctx.stroke()
  ctx.filter = 'none'
  const domain = ctx.getImageData(0, 0, width, height).data
  ctx.clearRect(0, 0, width, height)
  // 只有共同外框沿海陸收邊；各區之間不再各自淡出或縮成獨立岩壁色帶。
  trace(regions.flatMap((r) => r.walls)); ctx.stroke()
  const core = ctx.getImageData(0, 0, width, height).data
  let shoreline: Uint8ClampedArray | undefined
  if (t.coast) {
    ctx.clearRect(0, 0, width, height)
    trace(t.coast.flat()); ctx.fill('evenodd')
    shoreline = ctx.getImageData(0, 0, width, height).data
  }
  const water = new Uint8Array(t.heights.length)
  for (const [start, length] of t.waterRuns ?? []) water.fill(1, start, start+length)
  const landAt = (c: number, r: number) => 1-water[Math.max(0, Math.min(t.rows-1, r))*t.columns+Math.max(0, Math.min(t.columns-1, c))]
  const pixels = new Uint8Array(width*height*4)
  let continuousLand = 0, coveredLand = 0
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const i = r*width+c, total = sum[i]
    const gx = (c+0.5)/scale-0.5, gy = (r+0.5)/scale-0.5
    const x = Math.floor(gx), y = Math.floor(gy), u = gx-x, v = gy-y
    const land = shoreline ? shoreline[i*4+3]/255 : (landAt(x, y)*(1-u)+landAt(x+1, y)*u)*(1-v)+(landAt(x, y+1)*(1-u)+landAt(x+1, y+1)*u)*v
    const interior = domain[i*4+3] >= 250 && land >= 0.98
    if (interior) continuousLand++
    // 顯色先完整鋪到輪廓外；精細海陸裁切由 GPU 的獨立海岸遮罩負責，
    // 避免低解析度海陸紋理在岸內挖洞，露出灰色背景。
    const alpha = Math.max(domain[i*4+3]/255, core[i*4+3]/255)
    if (!alpha && !context) continue
    if (!alpha) { pixels.set([117, 151, 123, 255], i*4); continue }
    if (total) {
      pixels[i*4] = Math.round(red[i]/total); pixels[i*4+1] = Math.round(green[i]/total); pixels[i*4+2] = Math.round(blue[i]/total)
    } else {
      // 遠離岩壁的連接坡面仍屬於整張地圖，以最近岩壁區域延續顏色，不留下透明斷段。
      let distance = Infinity, color = seeds[0].color
      for (const seed of seeds) {
        const d = (gx-seed.c)**2+(gy-seed.r)**2
        if (d < distance) { distance = d; color = seed.color }
      }
      pixels.set(color, i*4)
    }
    if (context) {
      for (let c = 0; c < 3; c++) pixels[i*4+c] = Math.round(pixels[i*4+c]*alpha+[117, 151, 123][c]*(1-alpha))
    }
    pixels[i*4+3] = context ? 255 : Math.round(255*alpha)
    if (interior && pixels[i*4+3] >= 245) coveredLand++
  }
  // 量測海岸內的岩壁是否被範圍漏裁。海岸與牆線來自不同圖層，
  // 近海的少數牆線位於岸外，仍由上層獨立描繪，不為了補色改動海岸。
  let wallCoverage = 1
  for (const region of regions) for (const line of region.walls) line.forEach((a, index) => {
    const b = line[index+1] ?? a
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1])/5))
    for (let j = 0; j < steps; j++) {
      const [c, r] = grid([a[0]+(b[0]-a[0])*j/steps, a[1]+(b[1]-a[1])*j/steps])
      const col = Math.round((c+0.5)*scale-0.5), row = Math.round((r+0.5)*scale-0.5)
      if (col >= 0 && row >= 0 && col < width && row < height) {
        const i = row*width+col
        const land = shoreline ? shoreline[i*4+3]/255 : 1
        if (land >= 0.98) wallCoverage = Math.min(wallCoverage, pixels[i*4+3]/255)
      }
      else wallCoverage = 0
    }
  })
  return { pixels, width, height, wallCoverage, continuousCoverage: continuousLand ? coveredLand/continuousLand : 0 }
}
