/** 點到線段上最近的位置（地圖座標） */
export function nearestOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [a[0] + t * dx, a[1] + t * dy]
}
