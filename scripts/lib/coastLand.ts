/**
 * 由 OpenStreetMap 的海岸線（natural=coastline，陸地在線的左側）圍出矩形範圍內的陸地多邊形。
 * 座標是平面的 [x, y]（x 向東、y 向北，例如 [經度, 緯度]）。
 */
type Pt = [number, number]
export interface Box {
  west: number
  south: number
  east: number
  north: number
}

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]

/** 把首尾相接的海岸線段接成長的線（OSM 的 way 方向一致：前一段的終點是下一段的起點） */
export function joinWays(ways: Pt[][]): Pt[][] {
  const rest = ways.map((w) => [...w])
  const out: Pt[][] = []
  while (rest.length) {
    let line = rest.shift()!
    for (let grew = true; grew; ) {
      grew = false
      for (let i = 0; i < rest.length; i++) {
        if (same(line[line.length - 1], rest[i][0])) line = [...line, ...rest.splice(i, 1)[0].slice(1)]
        else if (same(rest[i][rest[i].length - 1], line[0])) line = [...rest.splice(i, 1)[0], ...line.slice(1)]
        else continue
        grew = true
        break
      }
    }
    out.push(line)
  }
  return out
}

const inside = ([x, y]: Pt, b: Box) => x >= b.west && x <= b.east && y >= b.south && y <= b.north

/** 線段 a→b 和矩形邊界的交點參數（0–1，Liang–Barsky）：進入與離開 */
function clipSegment(a: Pt, b: Pt, box: Box): [number, number] | undefined {
  const d: Pt = [b[0] - a[0], b[1] - a[1]]
  let [t0, t1] = [0, 1]
  for (const [p, q] of [
    [-d[0], a[0] - box.west],
    [d[0], box.east - a[0]],
    [-d[1], a[1] - box.south],
    [d[1], box.north - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return undefined
    } else {
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
    }
  }
  return t0 <= t1 ? [t0, t1] : undefined
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** 線在矩形裡的各段（每段從邊界進來、從邊界出去；線的頭尾在矩形裡時那一段的頭尾不在邊界上） */
function clipLine(line: Pt[], box: Box): Pt[][] {
  const pieces: Pt[][] = []
  let current: Pt[] = inside(line[0], box) ? [line[0]] : []
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const hit = clipSegment(a, b, box)
    if (!hit) continue
    const [t0, t1] = hit
    if (t0 > 0 || !current.length) current = [lerp(a, b, t0)]
    current.push(lerp(a, b, t1))
    if (t1 < 1) {
      pieces.push(current)
      current = []
    }
  }
  if (current.length > 1) pieces.push(current)
  return pieces
}

/** 邊界上一點從西南角起逆時針量的距離 */
function perimeter([x, y]: Pt, b: Box): number {
  const [w, h] = [b.east - b.west, b.north - b.south]
  const eps = 1e-12
  if (Math.abs(y - b.south) < eps) return x - b.west
  if (Math.abs(x - b.east) < eps) return w + (y - b.south)
  if (Math.abs(y - b.north) < eps) return w + h + (b.east - x)
  return 2 * w + h + (b.north - y)
}

/** 範圍裡的陸地：穿過範圍的海岸線，出去之後沿著邊界逆時針走到下一段進來的地方；整個在範圍裡的封閉海岸線（島）各自一塊 */
export function coastLand(ways: Pt[][], box: Box): Pt[][] {
  const lines = joinWays(ways)
  const islands = lines.filter((l) => l.length > 3 && same(l[0], l[l.length - 1]) && l.every((p) => inside(p, box)))
  const pieces = lines.filter((l) => !islands.includes(l)).flatMap((l) => clipLine(l, box))
  const onEdge = pieces.filter((p) => !inside(p[0], { west: box.west + 1e-12, south: box.south + 1e-12, east: box.east - 1e-12, north: box.north - 1e-12 }))
  const P = 2 * (box.east - box.west + box.north - box.south)
  const corners: { t: number; p: Pt }[] = [
    { t: box.east - box.west, p: [box.east, box.south] },
    { t: box.east - box.west + box.north - box.south, p: [box.east, box.north] },
    { t: 2 * (box.east - box.west) + box.north - box.south, p: [box.west, box.north] },
    { t: P, p: [box.west, box.south] },
  ]
  const segs = onEdge.map((p) => ({ points: p, tIn: perimeter(p[0], box), tOut: perimeter(p[p.length - 1], box) }))
  const used = new Set<number>()
  const polygons: Pt[][] = []
  for (let start = 0; start < segs.length; start++) {
    if (used.has(start)) continue
    const ring: Pt[] = []
    let i = start
    for (let guard = 0; guard <= segs.length; guard++) {
      used.add(i)
      ring.push(...segs[i].points)
      const from = segs[i].tOut
      const ahead = (t: number) => (t - from + P) % P
      const next = segs.map((s, j) => ({ j, d: ahead(s.tIn) })).reduce((a, b) => (b.d < a.d ? b : a))
      // 沿著邊界逆時針經過的角
      for (const c of [...corners, ...corners.map((c) => ({ t: c.t + P, p: c.p }))].filter((c) => c.t - from > 0 && c.t - from < next.d)) ring.push(c.p)
      if (next.j === start) break
      i = next.j
    }
    ring.push(ring[0])
    polygons.push(ring)
  }
  return [...polygons, ...islands]
}
