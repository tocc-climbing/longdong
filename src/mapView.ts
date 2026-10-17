/**
 * 比例尺地圖的平移與縮放（像 Google 地圖：拖曳平移、雙指或滾輪縮放）。
 * 畫面狀態用「中心點（公尺）＋每像素幾公尺」表示，框的大小改變時比例不變，不會因此重新排版而閃動。
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
}

export interface Size {
  w: number
  h: number
}

/** 放到最大時每像素幾公尺 */
export const MIN_SCALE = 0.1

/** 整個範圍剛好放進框裡 */
export function fitView(bounds: Rect, frame: Size): MapView {
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, s: maxScale(bounds, frame) }
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
    cx: Math.min(bounds.x + bounds.w, Math.max(bounds.x, v.cx)),
    cy: Math.min(bounds.y + bounds.h, Math.max(bounds.y, v.cy)),
  }
}

/** SVG 的 viewBox */
export function viewBox(v: MapView, frame: Size): Rect {
  const w = v.s * frame.w
  const h = v.s * frame.h
  return { x: v.cx - w / 2, y: v.cy - h / 2, w, h }
}

/** 拖曳：畫面移動 (dx, dy) 像素，地圖跟著手指走 */
export function panBy(v: MapView, dx: number, dy: number): MapView {
  return { ...v, cx: v.cx - dx * v.s, cy: v.cy - dy * v.s }
}

/**
 * 以框內的某一點為中心縮放到每像素 s 公尺：那一點下面的地圖位置不動（雙指的中點、滑鼠游標）。
 * s 先用 clampScale 限制好，到了極限時中心才不會跟著偏移。
 */
export function zoomAt(v: MapView, frame: Size, at: { x: number; y: number }, s: number): MapView {
  const ox = at.x - frame.w / 2
  const oy = at.y - frame.h / 2
  // 那一點的地圖座標：cx + ox * s，縮放前後要相同
  return { s, cx: v.cx + ox * (v.s - s), cy: v.cy + oy * (v.s - s) }
}

/**
 * 虛線一段的長度（地圖公尺）：約為 px 個螢幕像素，但只取 2 的次方。
 * 長度若跟著縮放連續改變，虛線會沿著路線滑動（看起來在流動）；只在跨過級距時才換，平常固定在地圖上。
 */
export function dashLength(px: number, metersPerPixel: number): number {
  return 2 ** Math.round(Math.log2(px * metersPerPixel))
}
