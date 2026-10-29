/**
 * 規則網格的高程 → 等高線（marching squares），以及 TWD97 橫麥卡托二度分帶（TM2，中央經線 121 度）→ 經緯度。
 * 網格座標是平面的 [x, y]（x 向東、y 向北）。
 */
type Pt = [number, number]

export interface Grid {
  /** 左下角的格點座標與格距 */
  x0: number
  y0: number
  step: number
  cols: number
  rows: number
  /** 高程（[row * cols + col]，row 由南往北）；沒有資料（海面）是 NaN */
  z: Float64Array
}

/** 每一格的四個角：左下、右下、右上、左上 */
const CORNERS: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
/** 每一條邊連接的兩個角（下、右、上、左） */
const EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]]

/** 某一格（col, row）的第 e 條邊在整個網格裡的代號：相鄰兩格共用的邊代號相同，線才接得起來 */
function edgeKey(col: number, row: number, e: number): string {
  if (e === 0) return `h${col},${row}`
  if (e === 2) return `h${col},${row + 1}`
  if (e === 3) return `v${col},${row}`
  return `v${col + 1},${row}`
}

/**
 * level 的等高線：每一格依四個角高於或低於 level 切出線段，再把共用邊的線段接成折線（封閉的線首尾同一點）。
 * 四個角有一個沒資料的格子不畫（海岸附近的線會斷開）。
 * 鞍點（對角兩個高、兩個低）以四角的平均決定中間是高是低。
 */
export function contourLines(grid: Grid, level: number): Pt[][] {
  const { x0, y0, step, cols, rows, z } = grid
  const at = (c: number, r: number) => z[r * cols + c]
  const points = new Map<string, Pt>()
  const segments: [string, string][] = []
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const h = CORNERS.map(([dc, dr]) => at(c + dc, r + dr))
      if (h.some(Number.isNaN)) continue
      const above = h.map((v) => v >= level)
      const crossed = EDGES.flatMap((pair, e) => (above[pair[0]] === above[pair[1]] ? [] : [e]))
      if (!crossed.length) continue
      for (const e of crossed) {
        const key = edgeKey(c, r, e)
        if (points.has(key)) continue
        const [a, b] = EDGES[e]
        const t = (level - h[a]) / (h[b] - h[a])
        const [ax, ay] = CORNERS[a]
        const [bx, by] = CORNERS[b]
        points.set(key, [x0 + (c + ax + (bx - ax) * t) * step, y0 + (r + ay + (by - ay) * t) * step])
      }
      const keys = crossed.map((e) => edgeKey(c, r, e))
      if (keys.length === 2) segments.push([keys[0], keys[1]])
      else {
        // 鞍點（keys 依序是下、右、上、左四條邊）：中間和左下角同一側時，左下與右上連通，線切開右下、左上兩個角；否則切開左下、右上
        const centerAbove = h.reduce((s, v) => s + v, 0) / 4 >= level
        if (above[0] !== centerAbove) segments.push([keys[3], keys[0]], [keys[1], keys[2]])
        else segments.push([keys[0], keys[1]], [keys[2], keys[3]])
      }
    }
  }
  return joinSegments(segments).map((keys) => keys.map((k) => points.get(k)!))
}

/** 把共用端點的線段接成折線 */
function joinSegments(segments: [string, string][]): string[][] {
  const ends = new Map<string, number[]>()
  segments.forEach(([a, b], i) => {
    for (const k of [a, b]) ends.set(k, [...(ends.get(k) ?? []), i])
  })
  const used = new Set<number>()
  const next = (key: string) => ends.get(key)!.find((i) => !used.has(i))
  const walk = (from: string, line: string[]) => {
    for (let i = next(from); i !== undefined; i = next(from)) {
      used.add(i)
      from = segments[i][0] === from ? segments[i][1] : segments[i][0]
      line.push(from)
    }
  }
  const lines: string[][] = []
  // 先從只有一條線段的端點（線頭）開始，再處理剩下的封閉線
  const order = [...segments.keys()].sort((i, j) => Math.min(...segments[i].map((k) => ends.get(k)!.length)) - Math.min(...segments[j].map((k) => ends.get(k)!.length)))
  for (const i of order) {
    if (used.has(i)) continue
    used.add(i)
    const [a, b] = segments[i]
    const forward = [a, b]
    walk(b, forward)
    const backward: string[] = []
    walk(a, backward)
    lines.push([...backward.reverse(), ...forward])
  }
  return lines
}

/** TWD97 TM2（GRS80、中央經線 121 度、尺度 0.9999、東偏 250000 公尺）→ [緯度, 經度] */
export function tm2ToLatLng([x, y]: Pt): Pt {
  const a = 6378137
  const f = 1 / 298.257222101
  const k0 = 0.9999
  const e2 = f * (2 - f)
  const ep2 = e2 / (1 - e2)
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const mu = y / k0 / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256))
  const phi1 =
    mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const sin = Math.sin(phi1)
  const cos = Math.cos(phi1)
  const n1 = a / Math.sqrt(1 - e2 * sin ** 2)
  const t1 = Math.tan(phi1) ** 2
  const c1 = ep2 * cos ** 2
  const r1 = (a * (1 - e2)) / (1 - e2 * sin ** 2) ** 1.5
  const d = (x - 250000) / (n1 * k0)
  const lat =
    phi1 - ((n1 * Math.tan(phi1)) / r1) * (d ** 2 / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6) / 720)
  const lng = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) / 120) / cos
  return [(lat * 180) / Math.PI, 121 + (lng * 180) / Math.PI]
}
