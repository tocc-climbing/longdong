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
  /** 移動範圍用：畫面最寬幾公尺（地圖資料範圍的寬，見 bounds.ts）；寬螢幕縮到最小時左右不露出資料範圍外 */
  maxW?: number
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
export const MIN_SCALE = 0.05

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

/** 縮到最小、北方朝上；左右的中心可以指定（例如岩場），超出範圍時拉回 */
export function fitView(bounds: Rect, frame: Size, cx = bounds.x + bounds.w / 2): MapView {
  return clampView({ cx, cy: bounds.y + bounds.h / 2, s: maxScale(bounds, frame), r: 0 }, bounds, frame)
}

/**
 * 一開始的畫面：把 target（例如 9 個大區域的範圍）置中、北方朝上，上下各留 margin.y（框高的比例）、左右各留 margin.x；
 * 框太窄時以寬度為準。縮放與位置仍限制在 bounds 內。
 */
export function fitRectView(target: Rect, bounds: Rect, frame: Size, margin = { x: 0.05, y: 0.1 }): MapView {
  const s = Math.max(target.h / (frame.h * (1 - 2 * margin.y)), target.w / (frame.w * (1 - 2 * margin.x)))
  return clampView({ cx: target.x + target.w / 2, cy: target.y + target.h / 2, s, r: 0 }, bounds, frame)
}

/** 把 target（例如一個區域、幾個救援點）放進框裡，北方朝上；縮放與位置仍限制在 bounds 內 */
export function focusView(target: Rect, bounds: Rect, frame: Size): MapView {
  const s = Math.max(target.w / frame.w, target.h / frame.h)
  return clampView({ cx: target.x + target.w / 2, cy: target.y + target.h / 2, s, r: 0 }, bounds, frame)
}

/**
 * 最多縮小到範圍的上下剛好填滿框：上下不會露出範圍外的空白（範圍外沒有地圖資料）；
 * 框比較窄（手機直拿）時左右放不下，左右拖曳即可；左右不限制畫面的邊緣（超出的是和海同色的底圖），中心不離開範圍。
 * 有 maxW 時畫面也不比它寬（很寬的螢幕上下就放不下，上下拖曳）。
 */
export function maxScale(bounds: Rect, frame: Size): number {
  return Math.min(bounds.h / frame.h, bounds.maxW ? bounds.maxW / frame.w : Infinity)
}

/** 縮放範圍：放到最大（MIN_SCALE）到整個範圍放進框裡 */
export function clampScale(s: number, bounds: Rect, frame: Size): number {
  return Math.min(maxScale(bounds, frame), Math.max(MIN_SCALE, s))
}

/**
 * 限制縮放範圍，中心點不離開範圍；北方朝上時，畫面的上下緣也不超出範圍（不露出範圍外的空白）。
 * 旋轉後畫面是斜的，只限制中心點。
 */
export function clampView(v: MapView, bounds: Rect, frame: Size): MapView {
  const s = clampScale(v.s, bounds, frame)
  // 北方朝上時畫面的上下緣不超出範圍；左右只限制中心在範圍內（螢幕比範圍寬、直立的 iPad 要把 9 個區域置中時，
  // 左右超出的部分是和海同色的底圖，不用硬把畫面推回範圍內）；旋轉後上下也只限制中心
  const halfH = v.r === 0 ? Math.min(bounds.h / 2, (s * frame.h) / 2) : 0
  return {
    s,
    r: v.r,
    cx: Math.min(bounds.x + bounds.w, Math.max(bounds.x, v.cx)),
    cy: Math.min(bounds.y + bounds.h - halfH, Math.max(bounds.y + halfH, v.cy)),
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

/** 等定位到要移到目前位置的請求：記下提出時聚焦的 key（沒有聚焦時 undefined） */
export interface CenterRequest {
  focus: string | undefined
}

/** 請求還有效：提出後沒有換過聚焦。換了聚焦（例如從清單選了救援點）就以聚焦為準，定位到也不移過去 */
export function centerPending(request: CenterRequest | undefined, focus: string | undefined): boolean {
  return request !== undefined && request.focus === focus
}
