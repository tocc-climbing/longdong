/**
 * 標題卡的地圖要怎麼擺：岩壁是主角，要整個看得到、越大越好；方向不固定北邊朝上，
 * 轉到岩壁在框裡放得最大的角度。地圖本身可以超出框（區域的形狀被框切掉，跨到卡片的上下緣）。
 */

export type Pt = [number, number]

/** 框的大小與四邊要留的空白（px）：上方留給工具列的圖示 */
export interface FitBox {
  w: number
  h: number
  top: number
  right: number
  bottom: number
  left: number
}

/** 和 SVG 的 rotate(deg) 相同：y 軸朝下時順時針 */
export function rotate([x, y]: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [x * c - y * s, x * s + y * c]
}

/** 試的角度：從 0 開始左右交替（0、2、-2、4、-4…到 ±90），差不多大時用比較接近北邊朝上的 */
const ANGLES = [0, ...Array.from({ length: 45 }, (_, i) => [(i + 1) * 2, -(i + 1) * 2]).flat()]
/** 至少大這麼多才轉 */
const BETTER = 1.03

/**
 * 選角度與 viewBox（和框同比例）：points 轉過去後的範圍放進框裡扣掉空白的地方，置中。
 * spread：範圍再放大的倍率（大於 1 時看得到旁邊的岩壁）；minSpan：範圍至少這麼寬、高（地圖單位，公尺）；
 * angle：固定這個角度，不找最大的（首頁）。
 */
export function heroFit(
  points: Pt[],
  box: FitBox,
  { spread = 1, minSpan = 0, angle: fixed }: { spread?: number; minSpan?: number; angle?: number } = {},
): { angle: number; viewBox: [number, number, number, number] } | undefined {
  const innerW = box.w - box.left - box.right
  const innerH = box.h - box.top - box.bottom
  if (points.length === 0 || innerW <= 0 || innerH <= 0) return undefined
  let best: { angle: number; k: number; cx: number; cy: number } | undefined
  for (const angle of fixed === undefined ? ANGLES : [fixed]) {
    const turned = points.map((p) => rotate(p, angle))
    const xs = turned.map((p) => p[0])
    const ys = turned.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const w = Math.max((x1 - x0) * spread, minSpan, 1e-6)
    const h = Math.max((y1 - y0) * spread, minSpan, 1e-6)
    const k = Math.min(innerW / w, innerH / h)
    if (!best || k > best.k * BETTER) best = { angle, k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
  }
  const { angle, k, cx, cy } = best!
  const px = box.left + innerW / 2
  const py = box.top + innerH / 2
  return { angle, viewBox: [cx - px / k, cy - py / k, box.w / k, box.h / k] }
}
