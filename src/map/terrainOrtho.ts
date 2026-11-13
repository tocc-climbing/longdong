import { projection, SOURCES, tileLevel, visibleTiles } from '../../vendor/climbio-mapkit/index.js'
import { unproject } from './mapData'
import { terrainGridBounds, terrainPoint, terrainView, type Terrain } from './terrain'
import type { Pt } from './heroFit'

export interface TerrainOrtho {
  canvas: HTMLCanvasElement
  z: number
  x: number
  y: number
  columns: number
  rows: number
}

/** 以同一份 DTM 的可見網格決定航照範圍，每次最多 8×8 張、2048×2048 像素。 */
export function terrainOrthoPlan(t: Terrain, box: [number, number, number, number], width: number, dpr: number, maxSpan = 8, pitch = 60) {
  const b = terrainGridBounds(t, 0, box, 1, pitch)
  const ps = [terrainPoint(t, b.firstCol, b.firstRow), terrainPoint(t, b.lastCol+1, b.firstRow), terrainPoint(t, b.firstCol, b.lastRow+1), terrainPoint(t, b.lastCol+1, b.lastRow+1)]
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1])
  const left = Math.min(...xs), top = Math.min(...ys), w = Math.max(...xs)-left, h = Math.max(...ys)-top
  const proj = projection([121.92, 25.107]), view = { cx: left+w/2, cy: top+h/2, s: box[2]/width, r: 0 }
  const frame = { w: w/view.s, h: h/view.s }
  let level = tileLevel(proj, view, dpr, SOURCES.ortho)
  for (;;) {
    const tiles = visibleTiles(proj, view, frame, SOURCES.ortho, { level, transparent: true })
    const ids = tiles.map((tile) => tile.key.split('/').map(Number))
    const x = Math.min(...ids.map((p) => p[1])), y = Math.min(...ids.map((p) => p[2]))
    const columns = Math.max(...ids.map((p) => p[1]))-x+1, rows = Math.max(...ids.map((p) => p[2]))-y+1
    if (columns <= maxSpan && rows <= maxSpan) return { tiles, z: ids[0][0], x, y, columns, rows }
    level--
  }
}

/** 全域低解析航照固定鋪底，縮小或移出細圖範圍時仍有完整影像。 */
export function terrainOrthoOverview(t: Terrain, pitch = 60): [number, number, number, number] {
  const heights = t.heights.filter((h): h is number => h !== null)
  const low = Math.min(...heights)*t.scale, high = Math.max(...heights)*t.scale
  const points: Pt[] = []
  for (const c of [0, t.columns-1]) for (const r of [0, t.rows-1]) for (const z of [low, high]) points.push(terrainView(terrainPoint(t, c, r), z, 0, pitch))
  const left = Math.min(...points.map((p) => p[0])), top = Math.min(...points.map((p) => p[1]))
  return [left, top, Math.max(...points.map((p) => p[0]))-left, Math.max(...points.map((p) => p[1]))-top]
}

/** CPU 使用雙精度把每個地形頂點對回原始 WMTS 像素，避免經緯度在 GPU 上失去精度。 */
export function terrainOrthoUV(p: Pt, atlas: Pick<TerrainOrtho, 'z' | 'x' | 'y' | 'columns' | 'rows'>): Pt {
  const [lat, lng] = unproject(p), n = 2**atlas.z
  return [((lng+180)/360*n-atlas.x)/atlas.columns, ((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n-atlas.y)/atlas.rows]
}

export async function loadTerrainOrtho(plan: ReturnType<typeof terrainOrthoPlan>, signal: AbortSignal): Promise<TerrainOrtho> {
  const canvas = document.createElement('canvas')
  canvas.width = plan.columns*256; canvas.height = plan.rows*256
  const ctx = canvas.getContext('2d')!
  let next = 0
  await Promise.all(Array.from({ length: Math.min(6, plan.tiles.length) }, async () => {
    while (next < plan.tiles.length) {
      signal.throwIfAborted()
      const tile = plan.tiles[next++], [, x, y] = tile.key.split('/').map(Number)
      const response = await fetch(tile.href, { mode: 'cors', signal })
      if (!response.ok) throw Error(`航照 HTTP ${response.status}`)
      const image = await createImageBitmap(await response.blob())
      try { ctx.drawImage(image, (x-plan.x)*256, (y-plan.y)*256, 256, 256) } finally { image.close() }
    }
  }))
  return { canvas, z: plan.z, x: plan.x, y: plan.y, columns: plan.columns, rows: plan.rows }
}
