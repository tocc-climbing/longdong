import { rotate, type Pt } from './heroFit'

export interface Terrain {
  origin: Pt
  u: Pt
  v: Pt
  columns: number
  rows: number
  scale: number
  heights: (number | null)[]
  seaRuns?: [number, number][]
  waterRuns?: [number, number][]
  /** B5000 海陸多邊形，公尺座標；首塊為主岸，後續為獨立島礁。 */
  coast?: Pt[][][]
  /** 全圖的顯色區域仍沿用已確認的攀岩岸段，不隨背景範圍向南北擴張。 */
  regionCoast?: Pt[][][]
  interpolated?: number[]
}

/** 原生 TWD97 的 20m 網格在地圖平面上的位置；海面與內插點另帶來源標記。 */
export function terrainPoint(t: Terrain, column: number, row: number): Pt {
  return [t.origin[0] + column * t.u[0] + row * t.v[0], t.origin[1] + column * t.u[1] + row * t.v[1]]
}

export function elevation(t: Terrain, p: Pt): number | undefined {
  const x = p[0] - t.origin[0], y = p[1] - t.origin[1]
  const det = t.u[0] * t.v[1] - t.u[1] * t.v[0]
  const col = (x * t.v[1] - y * t.v[0]) / det
  const row = (y * t.u[0] - x * t.u[1]) / det
  const i = Math.floor(col), j = Math.floor(row)
  if (i < 0 || j < 0 || i + 1 >= t.columns || j + 1 >= t.rows) return undefined
  const u = col-i, v = row-j
  const at = (c: number, r: number) => t.heights[Math.max(0, Math.min(t.rows-1, r))*t.columns+Math.max(0, Math.min(t.columns-1, c))]
  const patch = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => at(i+c-1, j+r-1)))
  if (patch.every((r) => r.every((h) => h !== null))) {
    const rows = patch.map((r) => monotone(r[0]!, r[1]!, r[2]!, r[3]!, u))
    return monotone(rows[0], rows[1], rows[2], rows[3], v)*t.scale
  }
  const values = [at(i, j), at(i+1, j), at(i, j+1), at(i+1, j+1)]
  // 海岸只使用同一個 20m 網格內有值的樣點，按有效權重內插；全缺值仍不畫。
  const weights = [(1-u)*(1-v), u*(1-v), (1-u)*v, u*v]
  let sum = 0, weight = 0
  values.forEach((value, i) => {
    if (value !== null) { sum += value*weights[i]; weight += weights[i] }
  })
  return weight > 0 ? sum/weight*t.scale : undefined
}

/** 單調三次 Hermite：保留原始樣點及平台高度，平滑坡度且不產生超出兩端的新山峰。 */
function monotone(a: number, b: number, c: number, d: number, t: number): number {
  const before = b-a, middle = c-b, after = d-c
  const m0 = before*middle <= 0 ? 0 : 2*before*middle/(before+middle)
  const m1 = middle*after <= 0 ? 0 : 2*middle*after/(middle+after)
  return (2*t*t*t-3*t*t+1)*b+(t*t*t-2*t*t+t)*m0+(-2*t*t*t+3*t*t)*c+(t*t*t-t*t)*m1
}

/** 正投影，朝向沿用各標題圖的取景方向；高程使用真實公尺，沒有垂直誇張。 */
export function terrainView(p: Pt, z: number, angle: number, pitch = 60): Pt {
  const [x, y] = rotate(p, angle)
  const tilt = pitch*Math.PI/180
  return [x, y*Math.cos(tilt)-z*Math.sin(tilt)]
}

export interface TerrainRegion { id: string; rings: Pt[][]; color: string; walls: Pt[][] }
export interface TerrainWall { lines: Pt[][]; color: string; strong: boolean }

const pair = (p: Pt) => p.map((n) => n.toFixed(1)).join(',')

/** 同色、同明暗的三角形合成 path，限制 SVG 節點數；overview 使用 40m LOD。 */
export function terrainMesh(t: Terrain, angle: number, box: [number, number, number, number], stride: 1 | 2) {
  const sea = new Uint8Array(t.heights.length)
  for (const [start, length] of t.waterRuns ?? []) sea.fill(1, start, start+length)
  const paths = new Map<string, string[]>()
  const add = (key: string, d: string) => {
    if (!paths.has(key)) paths.set(key, [])
    paths.get(key)!.push(d)
  }
  const [left, top, width, height] = box
  const { firstCol, lastCol, firstRow, lastRow } = terrainGridBounds(t, angle, box, stride)
  let triangles = 0
  for (let row = firstRow; row <= lastRow; row += stride) {
    for (let col = firstCol; col <= lastCol; col += stride) {
      const indices = [[col, row], [col+stride, row], [col, row+stride], [col+stride, row+stride]]
      const vertices = indices.map(([c, r]) => {
        const h = t.heights[r*t.columns+c]
        const p = terrainPoint(t, c, r)
        return { p, z: h === null ? undefined : h*t.scale, sea: sea[r*t.columns+c] === 1 }
      })
      for (const ids of [[0, 1, 2], [1, 3, 2]]) {
        const vs = ids.map((i) => vertices[i])
        if (vs.some((v) => v.z === undefined)) continue
        const screen = vs.map((v) => terrainView(v.p, v.z!, angle))
        if (screen.every(([x]) => x < left) || screen.every(([x]) => x > left+width)) continue
        if (screen.every(([, y]) => y < top) || screen.every(([, y]) => y > top+height)) continue
        const a = vs[0], b = vs[1], c = vs[2]
        const ux = b.p[0]-a.p[0], uy = b.p[1]-a.p[1], uz = b.z!-a.z!
        const vx = c.p[0]-a.p[0], vy = c.p[1]-a.p[1], vz = c.z!-a.z!
        let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz }
        const light = (nx*-0.45 + ny*-0.55 + nz*0.7)/Math.hypot(nx, ny, nz)
        const shade = Math.round((light+1)*5)
        const key = `${vs.every((v) => v.sea) ? 'sea' : 'land'}|${shade}`
        add(key, `M${screen.map(pair).join('L')}Z`)
        triangles++
      }
    }
  }
  return { triangles, paths: [...paths].map(([key, pieces]) => {
    const [surface, shade] = key.split('|')
    return { sea: surface === 'sea', shade: Number(shade), d: pieces.join('') }
  }) }
}

/** 反投影視窗及全圖高程上下界，保守界定可能出現在畫面裡的原生網格。 */
export function terrainGridBounds(t: Terrain, angle: number, box: [number, number, number, number], stride: 1 | 2, pitch = 60) {
  const [left, top, width, height] = box
  // 小分區只需處理附近幾十到幾百格，避免每次掃過整個龍洞。
  let low = Infinity, high = -Infinity
  for (const h of t.heights) {
    if (h !== null) { low = Math.min(low, h*t.scale); high = Math.max(high, h*t.scale) }
  }
  const det = t.u[0]*t.v[1]-t.u[1]*t.v[0]
  const cells: Pt[] = []
  const tilt = pitch*Math.PI/180
  for (const x of [left, left+width]) for (const y of [top, top+height]) for (const z of [low, high]) {
    const ground = rotate([x, (y+z*Math.sin(tilt))/Math.cos(tilt)], -angle)
    const dx = ground[0]-t.origin[0], dy = ground[1]-t.origin[1]
    cells.push([(dx*t.v[1]-dy*t.v[0])/det, (dy*t.u[0]-dx*t.u[1])/det])
  }
  const firstCol = Math.max(0, Math.floor(Math.min(...cells.map(([c]) => c))/stride)*stride-stride)
  const lastCol = Math.min(t.columns-stride-1, Math.ceil(Math.max(...cells.map(([c]) => c))/stride)*stride+stride)
  const firstRow = Math.max(0, Math.floor(Math.min(...cells.map(([, r]) => r))/stride)*stride-stride)
  const lastRow = Math.min(t.rows-stride-1, Math.ceil(Math.max(...cells.map(([, r]) => r))/stride)*stride+stride)
  return { firstCol, lastCol, firstRow, lastRow }
}

/** 保留所有原節點，再依間距補取樣貼合曲面；岩壁預設 1m，缺值處斷線。 */
export type TerrainSamples = ({ at: Pt; z: number } | null)[]

/** 先在地面公尺座標切分虛線，傾斜投影不再改變各段所屬的地點。 */
export function terrainDashLines(lines: Pt[][], on: number, off: number): Pt[][] {
  const result: Pt[][] = [], period = on+off
  for (const line of lines) {
    let travelled = 0, dash: Pt[] = []
    for (let i = 1; i < line.length; i++) {
      const a = line[i-1], b = line[i], length = Math.hypot(b[0]-a[0], b[1]-a[1])
      let done = 0
      const at = (d: number): Pt => [a[0]+(b[0]-a[0])*d/length, a[1]+(b[1]-a[1])*d/length]
      while (done < length-1e-8) {
        const phase = (travelled+1e-8)%period, visible = phase < on
        const step = Math.min(length-done, (visible ? on : period)-phase)
        if (visible) { if (!dash.length) dash.push(at(done)); dash.push(at(done+step)) }
        else if (dash.length) { result.push(dash); dash = [] }
        done += step; travelled += step
      }
    }
    if (dash.length) result.push(dash)
  }
  return result
}

/** 只接合入口附近的製圖間隙，不移動遠處道路或修改共用 2D 資料。 */
export function connectTerrainLines(lines: Pt[][], roads: Pt[][], maxGap = 15): Pt[][] {
  const snap = (p: Pt) => {
    let distance = maxGap, nearest = p
    for (const road of roads) for (let i = 1; i < road.length; i++) {
      const a = road[i-1], b = road[i], dx = b[0]-a[0], dy = b[1]-a[1], length = dx*dx+dy*dy
      const u = length ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) : 0
      const point: Pt = [a[0]+u*dx, a[1]+u*dy], d = Math.hypot(point[0]-p[0], point[1]-p[1])
      if (d < distance) { nearest = point; distance = d }
    }
    return nearest
  }
  return lines.map(line => line.map((p, i) => i === 0 || i === line.length-1 ? snap(p) : p))
}

/** 高程只在資料改變時取樣，調整傾角時只重做投影。 */
export function sampleTerrainLines(t: Terrain, lines: Pt[][], offset: number, spacing = 1): TerrainSamples {
  const points: TerrainSamples = []
  for (const line of lines) {
    points.push(null)
    for (let i = 0; i < line.length; i++) {
      const a = line[i], b = line[i+1] ?? a
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1])/spacing))
      for (let j = 0; j < steps; j++) {
        const p: Pt = [a[0]+(b[0]-a[0])*j/steps, a[1]+(b[1]-a[1])*j/steps]
        const z = elevation(t, p)
        points.push(z === undefined ? null : { at: p, z: z+offset })
      }
    }
  }
  return points
}

export function projectTerrainPath(points: TerrainSamples, angle: number, pitch = 60): string {
  const pieces: string[] = []
  const bearing = angle*Math.PI/180, tilt = pitch*Math.PI/180
  const c = Math.cos(bearing), s = Math.sin(bearing), ct = Math.cos(tilt), st = Math.sin(tilt)
  let pen = false
  for (const point of points) {
    if (!point) { pen = false; continue }
    const x = point.at[0]*c-point.at[1]*s, y = (point.at[0]*s+point.at[1]*c)*ct-point.z*st
    pieces.push(`${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    pen = true
  }
  return pieces.join('')
}

export function drape(t: Terrain, lines: Pt[][], angle: number, offset: number, spacing = 1, pitch = 60): string {
  return projectTerrainPath(sampleTerrainLines(t, lines, offset, spacing), angle, pitch)
}
