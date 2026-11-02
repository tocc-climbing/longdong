// 地圖的投影與畫面：經緯度 ↔ 平面（公尺，x 向東、y 向南）↔ 螢幕（像素）；平移、縮放、旋轉與範圍限制。
// 畫面狀態是「中心（公尺）＋每像素幾公尺（s）＋旋轉（弧度，順時針）」，框的大小改變時比例不變。
// 移植自龍洞（MIT）src/map/mapView.ts、mapData.ts 的 project。
// English: projection (local equirectangular) and view math: pan/zoom/rotate with bounds. Ported from Longdong (MIT).

const EARTH_R = 6371000;
const RAD = Math.PI / 180;
const M_PER_DEG_LAT = EARTH_R * RAD;

/** 放到最大時每像素幾公尺 */
export const MIN_SCALE = 0.05;
/** 按「＋」「－」、點兩下一次縮放的倍數 */
export const STEP = 2;

/**
 * 以 origin（[經度, 緯度]）為原點的平面投影：幾公里的範圍內誤差可以忽略。
 * project([經度, 緯度]) → [x, y]（公尺，x 向東、y 向南）；unproject 是反過來。
 */
export function projection([lng0, lat0]) {
  const mLng = M_PER_DEG_LAT * Math.cos(lat0 * RAD);
  return {
    origin: [lng0, lat0],
    project: ([lng, lat]) => [(lng - lng0) * mLng, (lat0 - lat) * M_PER_DEG_LAT],
    unproject: ([x, y]) => [lng0 + x / mLng, lat0 - y / M_PER_DEG_LAT],
  };
}

const rotate = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/** 平面 → 螢幕（框的左上角為原點） */
export function toScreen(v, frame, [x, y]) {
  const [sx, sy] = rotate([x - v.cx, y - v.cy], v.r);
  return [sx / v.s + frame.w / 2, sy / v.s + frame.h / 2];
}

/** 螢幕 → 平面 */
export function toMap(v, frame, [x, y]) {
  const [mx, my] = rotate([x - frame.w / 2, y - frame.h / 2], -v.r);
  return [v.cx + mx * v.s, v.cy + my * v.s];
}

/** SVG 的 transform：把平面座標畫到螢幕上 */
export const mapTransform = (v, frame) => `translate(${frame.w / 2} ${frame.h / 2}) rotate(${(v.r * 180) / Math.PI}) scale(${1 / v.s}) translate(${-v.cx} ${-v.cy})`;

/** 最多縮小到範圍的上下剛好填滿框；有 maxW（底圖資料的寬）時畫面也不比它寬 */
export const maxScale = (bounds, frame) => Math.min(bounds.h / frame.h, bounds.maxW ? bounds.maxW / frame.w : Infinity);

/** 縮放範圍：放到最大（MIN_SCALE）到整個範圍放進框裡 */
export const clampScale = (s, bounds, frame) => Math.min(maxScale(bounds, frame), Math.max(MIN_SCALE, s));

/**
 * 限制縮放範圍，中心不離開範圍；畫面（旋轉後取外接矩形）的上下緣與西邊的邊緣也不超出範圍。
 * 東邊只限制中心（岩場外是海，寬螢幕把岩場置中時超出的部分是和海同色的底）。
 */
export function clampView(v, bounds, frame) {
  const s = clampScale(v.s, bounds, frame);
  const [sin, cos] = [Math.abs(Math.sin(v.r)), Math.abs(Math.cos(v.r))];
  const halfW = Math.min(bounds.w / 2, (s * (cos * frame.w + sin * frame.h)) / 2);
  const halfH = Math.min(bounds.h / 2, (s * (sin * frame.w + cos * frame.h)) / 2);
  return {
    s,
    r: v.r,
    cx: Math.min(bounds.x + bounds.w, Math.max(bounds.x + halfW, v.cx)),
    cy: Math.min(bounds.y + bounds.h - halfH, Math.max(bounds.y + halfH, v.cy)),
  };
}

/** 一開始的畫面：target 置中、北方朝上，上下各留 margin.y（框高的比例）、左右各留 margin.x */
export function fitRectView(target, bounds, frame, margin = { x: 0.05, y: 0.1 }) {
  const s = Math.max(target.h / (frame.h * (1 - 2 * margin.y)), target.w / (frame.w * (1 - 2 * margin.x)));
  return clampView({ cx: target.x + target.w / 2, cy: target.y + target.h / 2, s, r: 0 }, bounds, frame);
}

/** 把 target 剛好放進框裡、北方朝上 */
export function focusView(target, bounds, frame) {
  const s = Math.max(target.w / frame.w, target.h / frame.h);
  return clampView({ cx: target.x + target.w / 2, cy: target.y + target.h / 2, s, r: 0 }, bounds, frame);
}

/** 拖曳：畫面移動 (dx, dy) 像素，地圖跟著手指走 */
export function panBy(v, dx, dy) {
  const [mx, my] = rotate([dx, dy], -v.r);
  return { ...v, cx: v.cx - mx * v.s, cy: v.cy - my * v.s };
}

/** 以框內一點為中心縮放到每像素 s 公尺：那一點下面的地圖位置不動 */
export function zoomAt(v, frame, at, s) {
  const [mx, my] = toMap(v, frame, [at.x, at.y]);
  const [ox, oy] = rotate([at.x - frame.w / 2, at.y - frame.h / 2], -v.r);
  return { ...v, s, cx: mx - ox * s, cy: my - oy * s };
}

/** 以框內一點為中心旋轉到角度 r */
export function rotateAt(v, frame, at, r) {
  const [mx, my] = toMap(v, frame, [at.x, at.y]);
  const [ox, oy] = rotate([at.x - frame.w / 2, at.y - frame.h / 2], -r);
  return { ...v, r, cx: mx - ox * v.s, cy: my - oy * v.s };
}

/** 虛線一段的長度（公尺）：約 px 個螢幕像素，只取 2 的次方，縮放時虛線才不會沿線滑動 */
export const dashLength = (px, metersPerPixel) => 2 ** Math.round(Math.log2(px * metersPerPixel));

/** 一串平面座標的外接矩形 */
export function rectOf(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
