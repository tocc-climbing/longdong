// 縮放與平移（座標以舞台中心為原點，單位是螢幕像素），以及路線卡片用的裁切。
// 移植自龍洞（MIT）src/core/topo/viewport.ts；裁切（crop）是照片像素的 { x, y, w, h }。
// English: zoom/pan math and route-focused crop. Ported from Longdong (MIT) viewport.ts.

export const MAX_SCALE = 6;
export const IDENTITY = { scale: 1, x: 0, y: 0 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 照片（寬高比 aspect）在舞台裡縮到剛好放得下的大小 */
export function fitSize(stage, aspect) {
  const w = Math.min(stage.w, stage.h * aspect);
  return { w, h: w / aspect };
}

/** 縮放限制在 1 到 MAX_SCALE；放大後照片的邊緣不能離開舞台的邊緣，沒放滿舞台的方向置中 */
export function clampView(view, stage, content) {
  const scale = clamp(view.scale, 1, MAX_SCALE);
  const lx = Math.max(0, (content.w * scale - stage.w) / 2);
  const ly = Math.max(0, (content.h * scale - stage.h) / 2);
  return { scale, x: clamp(view.x, -lx, lx), y: clamp(view.y, -ly, ly) };
}

/** 手指從 from 移到 to，兩指距離變成 ratio 倍：照片上原本在 from 的那一點跟著手指走到 to。單指拖曳就是 ratio 為 1 */
export function moveView(view, from, to, ratio, stage, content) {
  const scale = clamp(view.scale * ratio, 1, MAX_SCALE);
  const f = scale / view.scale;
  return clampView({ scale, x: to.x - (from.x - view.x) * f, y: to.y - (from.y - view.y) * f }, stage, content);
}

const DOUBLE_TAP_MS = 300, DOUBLE_TAP_PX = 30;
/** 點兩下放大到這個倍率 */
export const DOUBLE_TAP_SCALE = 2.5;

/** 這次點擊和上一次合起來是點兩下：{ at: {x, y}, time } */
export const isDoubleTap = (prev, now) =>
  !!prev && now.time - prev.time <= DOUBLE_TAP_MS && Math.hypot(now.at.x - prev.at.x, now.at.y - prev.at.y) <= DOUBLE_TAP_PX;

/** 點兩下：沒放大時以點的位置為中心放大到 DOUBLE_TAP_SCALE，放大了就回到整張 */
export const doubleTapView = (view, at, stage, content) =>
  view.scale > 1 ? IDENTITY : moveView(view, at, at, DOUBLE_TAP_SCALE / view.scale, stage, content);

const FOCUS_PAD = 0.25, FOCUS_ASPECT = [0.8, 1.5], FOCUS_MAX_ZOOM = 2.2, FOCUS_MARGIN = 0.03;
const SKETCH_EDGE = 0.02, SKETCH_HEIGHT = 0.35;

const pointsOf = (route) => [...(route?.line ?? []), ...Object.values(route?.bolts ?? {}).map((b) => b.at)];

/** 示意的線：只畫了一小段、從照片的裁切範圍邊緣出去，主要的路線不在照片裡 */
export function isSketch(base, route) {
  const pts = pointsOf(route);
  if (pts.length === 0) return false;
  const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y);
  const nearEdge = xs.some((x, i) => Math.min(x - base.x, base.x + base.w - x) < SKETCH_EDGE * base.w || Math.min(ys[i] - base.y, base.y + base.h - ys[i]) < SKETCH_EDGE * base.h);
  return nearEdge && Math.max(...ys) - Math.min(...ys) < SKETCH_HEIGHT * base.h;
}

/**
 * 路線卡片：只顯示照片上這條路線附近的一塊（在 base 裡），路線放大成主角、盡量在畫面中間
 * （路線靠近邊緣時裁掉另一邊讓路線置中，路線本身一定整條看得到）。沒有標記或只是示意的線時就是 base。
 */
export function routeCrop(base, route) {
  const pts = pointsOf(route);
  if (pts.length === 0) return base;
  const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y);
  const { x: bx, y: by, w: bw, h: bh } = base;
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const rw = Math.max(...xs) - minX, rh = Math.max(...ys) - minY;
  const cx = minX + rw / 2, cy = minY + rh / 2;
  if (isSketch(base, route)) return base;
  let w = rw + 2 * Math.max(FOCUS_PAD * rw, 0.1 * bw);
  let h = rh + 2 * Math.max(FOCUS_PAD * rh, 0.1 * bh);
  w = Math.max(w, h * FOCUS_ASPECT[0]);
  h = Math.max(h, w / FOCUS_ASPECT[1]);
  const grow = Math.max(1, bw / FOCUS_MAX_ZOOM / w, bh / FOCUS_MAX_ZOOM / h);
  w = Math.min(bw, w * grow);
  h = Math.min(bh, h * grow);
  const needW = Math.min(bw, rw + 2 * FOCUS_MARGIN * bw), needH = Math.min(bh, rh + 2 * FOCUS_MARGIN * bh);
  w = Math.max(needW, 2 * Math.min(w / 2, cx - bx, bx + bw - cx));
  h = Math.max(needH, 2 * Math.min(h / 2, cy - by, by + bh - cy));
  h = Math.max(needH, Math.min(h, w / FOCUS_ASPECT[0]));
  w = Math.max(needW, Math.min(w, h * FOCUS_ASPECT[1]));
  const x = clamp(cx - w / 2, bx, bx + bw - w), y = clamp(cy - h / 2, by, by + bh - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
