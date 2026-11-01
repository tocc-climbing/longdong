import type { LatLng } from '../geo'
import { sunPosition, sunTimes } from '../sun'
import { project } from './mapData'

/**
 * 岩壁的朝向由牆線的畫線方向決定：沿著點的順序前進，岩壁在左手邊、岩壁面朝右手邊（攀岩者站的那一側）。
 * 新畫的線預設朝向最近的步道（faceTrail），編輯時可以翻轉（把線反過來）。
 */

/** 岩壁的一段：岩壁面的朝向（方位角，正北為 0、順時針）與長度（公尺） */
export interface Face {
  bearing: number
  length: number
}

/** 點到線段上最近的位置（地圖座標） */
export function nearestOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [a[0] + t * dx, a[1] + t * dy]
}

/** 地圖座標的線段（y 向南）→ 前進的方位角 */
const bearingOf = ([dx, dy]: [number, number]) => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360

/** 牆線每一段岩壁面的朝向與長度 */
export function wallFaces(line: LatLng[]): Face[] {
  const pts = line.map(project)
  return pts.slice(1).flatMap((b, i) => {
    const d: [number, number] = [b[0] - pts[i][0], b[1] - pts[i][1]]
    const length = Math.hypot(...d)
    return length > 0 ? [{ bearing: (bearingOf(d) + 90) % 360, length }] : []
  })
}

/** 讓岩壁面朝向最近的步道：每一段看最近的步道在左邊還是右邊（依長度加權），多數在左邊就把線反過來 */
export function faceTrail(line: LatLng[], trails: [number, number][][]): LatLng[] {
  const pts = line.map(project)
  const segments = trails.flatMap((t) => t.slice(1).map((b, i): [[number, number], [number, number]] => [t[i], b]))
  if (segments.length === 0) return line
  let score = 0
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const near = segments
      .map(([p, q]) => nearestOnSegment(mid, p, q))
      .reduce((best, q) => (Math.hypot(q[0] - mid[0], q[1] - mid[1]) < Math.hypot(best[0] - mid[0], best[1] - mid[1]) ? q : best))
    // 地圖座標 y 向南：(dx, dy) 的右手邊是 (-dy, dx)
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    score += Math.sign(-dy * (near[0] - mid[0]) + dx * (near[1] - mid[1])) * Math.hypot(dx, dy)
  }
  return score < 0 ? [...line].reverse() : line
}

/** 整面岩壁的朝向：各段依長度加權的平均方位角；沒有任何一段時 undefined */
export function meanFacing(faces: Face[]): number | undefined {
  const rad = Math.PI / 180
  const x = faces.reduce((s, f) => s + Math.sin(f.bearing * rad) * f.length, 0)
  const y = faces.reduce((s, f) => s + Math.cos(f.bearing * rad) * f.length, 0)
  if (faces.length === 0 || Math.hypot(x, y) === 0) return undefined
  return ((Math.atan2(x, y) / rad) + 360) % 360
}

/** 兩個方位角相差幾度（0–180） */
export const angleBetween = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

/**
 * 回報照片的相機朝向（EXIF）推算的岩壁朝向：相機對著岩壁，岩壁面朝反方向；多張取平均。
 * 磁北（M）與正北的差（台灣約 5 度）不修正：只用來看和牆線是不是相反。
 */
export function photoFacing(cameraHeadings: number[]): number | undefined {
  return meanFacing(cameraHeadings.map((h) => ({ bearing: (h + 180) % 360, length: 1 })))
}

/** 日曬時段取樣的間隔（分鐘） */
export const SUN_STEP_MIN = 5

/**
 * 一天裡岩壁面曬得到太陽的時段：太陽在岩壁面的前方（方位與朝向相差不到 90 度）的部分佔牆長一半以上，
 * 從日出到日落每 SUN_STEP_MIN 分鐘取樣一次。不考慮地形遮蔽與岩壁的傾斜。date：當地的日期 YYYY-MM-DD
 */
export function sunWindows(date: string, faces: Face[], at: LatLng): { from: Date; to: Date }[] {
  const total = faces.reduce((s, f) => s + f.length, 0)
  if (total === 0) return []
  const { rise, set } = sunTimes(date, at)
  const lit = (time: Date) => {
    const { azimuth } = sunPosition(time, at)
    const front = faces.filter((f) => angleBetween(azimuth, f.bearing) < 90)
    return front.reduce((s, f) => s + f.length, 0) >= total / 2
  }
  const windows: { from: Date; to: Date }[] = []
  let open: Date | undefined
  for (let ms = rise.getTime(); ; ms += SUN_STEP_MIN * 60_000) {
    const time = new Date(Math.min(ms, set.getTime()))
    const on = lit(time)
    if (on && !open) open = time
    if (open && (!on || time.getTime() === set.getTime())) {
      windows.push({ from: open, to: time })
      open = undefined
    }
    if (time.getTime() === set.getTime()) break
  }
  return windows
}
