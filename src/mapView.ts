/**
 * 比例尺地圖的平移、縮放與旋轉（像 Google 地圖：拖曳平移、雙指縮放與旋轉、滾輪縮放）。
 * 畫面狀態用「中心點（公尺）＋每像素幾公尺＋旋轉角度」表示，框的大小改變時比例不變，不會因此重新排版而閃動。
 * 地圖座標：x 向東、y 向南（公尺）；螢幕座標：框的左上角為原點（像素）。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface MapView {
  /** 畫面中心（地圖座標，公尺） */
  cx: number
  cy: number
  /** 每個螢幕像素幾公尺（越小越放大） */
  s: number
  /** 地圖順時針旋轉的角度（弧度）；0 為北方朝上 */
  r: number
}

export interface Size {
  w: number
  h: number
}

type Vec = [number, number]

/** 放到最大時每像素幾公尺 */
export const MIN_SCALE = 0.1

const rotate = ([x, y]: Vec, a: number): Vec => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]

/** 地圖座標 → 螢幕座標 */
export function toScreen(v: MapView, frame: Size, [x, y]: Vec): Vec {
  const [sx, sy] = rotate([x - v.cx, y - v.cy], v.r)
  return [sx / v.s + frame.w / 2, sy / v.s + frame.h / 2]
}

/** 螢幕座標 → 地圖座標 */
export function toMap(v: MapView, frame: Size, [x, y]: Vec): Vec {
  const [mx, my] = rotate([x - frame.w / 2, y - frame.h / 2], -v.r)
  return [v.cx + mx * v.s, v.cy + my * v.s]
}

/** SVG 的 transform：把地圖座標畫到螢幕上 */
export function mapTransform(v: MapView, frame: Size): string {
  return `translate(${frame.w / 2} ${frame.h / 2}) rotate(${(v.r * 180) / Math.PI}) scale(${1 / v.s}) translate(${-v.cx} ${-v.cy})`
}

/** 整個範圍剛好放進框裡、北方朝上 */
export function fitView(bounds: Rect, frame: Size): MapView {
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, s: maxScale(bounds, frame), r: 0 }
}

/** 最多縮小到整個範圍放進框裡 */
export function maxScale(bounds: Rect, frame: Size): number {
  return Math.max(bounds.w / frame.w, bounds.h / frame.h)
}

/** 縮放範圍：放到最大（MIN_SCALE）到整個範圍放進框裡 */
export function clampScale(s: number, bounds: Rect, frame: Size): number {
  return Math.min(maxScale(bounds, frame), Math.max(MIN_SCALE, s))
}

/** 限制縮放範圍，中心點不離開範圍 */
export function clampView(v: MapView, bounds: Rect, frame: Size): MapView {
  return {
    s: clampScale(v.s, bounds, frame),
    r: v.r,
    cx: Math.min(bounds.x + bounds.w, Math.max(bounds.x, v.cx)),
    cy: Math.min(bounds.y + bounds.h, Math.max(bounds.y, v.cy)),
  }
}

/** 拖曳：畫面移動 (dx, dy) 像素，地圖跟著手指走 */
export function panBy(v: MapView, dx: number, dy: number): MapView {
  const [mx, my] = rotate([dx, dy], -v.r)
  return { ...v, cx: v.cx - mx * v.s, cy: v.cy - my * v.s }
}

/**
 * 以框內的某一點為中心縮放到每像素 s 公尺：那一點下面的地圖位置不動（雙指的中點、滑鼠游標）。
 * s 先用 clampScale 限制好，到了極限時中心才不會跟著偏移。
 */
export function zoomAt(v: MapView, frame: Size, at: { x: number; y: number }, s: number): MapView {
  const [mx, my] = toMap(v, frame, [at.x, at.y])
  const [ox, oy] = rotate([at.x - frame.w / 2, at.y - frame.h / 2], -v.r)
  return { ...v, s, cx: mx - ox * s, cy: my - oy * s }
}

/** 以框內的某一點為中心旋轉到角度 r：那一點下面的地圖位置不動（雙指的中點） */
export function rotateAt(v: MapView, frame: Size, at: { x: number; y: number }, r: number): MapView {
  const [mx, my] = toMap(v, frame, [at.x, at.y])
  const [ox, oy] = rotate([at.x - frame.w / 2, at.y - frame.h / 2], -r)
  return { ...v, r, cx: mx - ox * v.s, cy: my - oy * v.s }
}

/**
 * 虛線一段的長度（地圖公尺）：約為 px 個螢幕像素，但只取 2 的次方。
 * 長度若跟著縮放連續改變，虛線會沿著路線滑動（看起來在流動）；只在跨過級距時才換，平常固定在地圖上。
 */
export function dashLength(px: number, metersPerPixel: number): number {
  return 2 ** Math.round(Math.log2(px * metersPerPixel))
}
