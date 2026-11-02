// 圖示與文字的避讓（都在螢幕座標上算，旋轉後也正確）：重疊時先畫重要的，其他的等放大後空間夠了才出現；
// 道路、步道的名稱沿著線排，位置固定在地圖上。
// 移植自龍洞（MIT）src/map/ScaleMap.tsx 的 declutter、src/map/lineLabels.ts。
// English: label/icon collision avoidance in screen space and names placed along roads/trails. Ported from Longdong (MIT).

export const LABEL_PX = 12;
export const SECTOR_LABEL_PX = 11;
export const PLACE_PX = 11;
export const LINE_NAME_PX = 11;
export const LINE_NAME_PAD_PX = 16;
export const HAZARD_R = 7;

/** 範圍 [左, 上, 右, 下] 是否重疊 */
export const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** 文字在畫面上的寬度（像素，估計值）：中日文字約 1 個字高，英數約 0.6 */
export function textWidth(text, fontPx) {
  return [...text].reduce((w, c) => w + (/[　-鿿＀-￯]/.test(c) ? 1 : 0.6) * fontPx, 0);
}

/** 以 at 為中心、半寬 hw、半高 hh 的範圍；dy 為中心往下移 */
export const around = ([x, y], hw, hh, dy = 0) => [x - hw, y + dy - hh, x + hw, y + dy + hh];

/**
 * 越前面越重要：救援用的（直升機吊掛點、船艇接駁點、紅色的警示）排在區域名稱前面；
 * 其他地名排在區域、分區名稱後面，依顏色種類：一般地名、步道、海面、危險地形、道路。
 */
const KIND_PRIORITY = { helicopter: 0, boat: 1, hazard: 6 };
const TONE_PRIORITY = { warning: 2, place: 3, trail: 4, sea: 5, road: 7 };
const priority = (m) => (m.kind === 'place' ? TONE_PRIORITY[m.tone ?? 'place'] : KIND_PRIORITY[m.kind] ?? 9);
const isRescue = (m) => m.kind === 'helicopter' || m.kind === 'boat' || (m.kind === 'place' && m.tone === 'warning');

/** 一個地點佔的範圍；hazardLabel 是危險地形旁邊的文字 */
export function markerBox(m, at, hazardLabel) {
  if (m.kind === 'place') return around(at, textWidth(m.text, PLACE_PX) / 2 + 2, 7);
  if (m.kind === 'hazard') {
    const w = HAZARD_R + 4 + textWidth(hazardLabel, 10);
    return [at[0] - HAZARD_R - 1, at[1] - HAZARD_R - 1, at[0] + w + 1, at[1] + HAZARD_R + 1];
  }
  // 直升機圖釘的尖端在實際位置，圖示在上方
  if (m.kind === 'helicopter') return around(at, 6.5, 10, -10);
  return around(at, 7.5, 7.5);
}

/** 急救器材被擋住時往旁邊挪的候選位置（螢幕像素）：由近到遠、八個方向 */
const NUDGES = [0, 18, 26, 36].flatMap((d) =>
  d === 0 ? [[0, 0]] : Array.from({ length: 8 }, (_, k) => [Math.round(d * Math.cos((k * Math.PI) / 4)), Math.round(d * Math.sin((k * Math.PI) / 4))]),
);

/**
 * 決定要畫哪些地點與文字：
 *   1. 救援點、停車場一定畫；急救器材也一定畫，和它們重疊時往旁邊空的地方挪（nudged），畫一條細線連回實際位置
 *   2. 其他救援用的地點（直升機吊掛點、船艇接駁點、紅色的地名）
 *   3. 區域名稱（面積大的先）、分區名稱
 *   4. 其他地名、危險地形
 * markers：{ kind, at（平面）, text?, tone? }（不含救援點、道路名稱）；rescue：救援點的平面座標；
 * areas：{ id, text, label（平面）, size }；sectors：{ id, text, at（螢幕）}。occupied 是到這裡為止佔掉的範圍，排道路名稱用。
 */
export function declutter(markers, rescue, areas, sectors, screen, hazardLabel) {
  const occupied = rescue.map((at) => around(screen(at), 8, 8));
  const fits = (box) => {
    if (occupied.some((o) => overlaps(box, o))) return false;
    occupied.push(box);
    return true;
  };
  const always = (m) => m.kind === 'parking';
  const fixed = markers.flatMap((m, i) => (always(m) ? [i] : []));
  for (const i of fixed) occupied.push(markerBox(markers[i], screen(markers[i].at), hazardLabel));
  const nudged = new Map();
  const aid = markers.flatMap((m, i) => (m.kind === 'first-aid' ? [i] : []));
  for (const i of aid) {
    const at = screen(markers[i].at);
    const free = NUDGES.map(([dx, dy]) => [at[0] + dx, at[1] + dy]).find((q) => !occupied.some((o) => overlaps(around(q, 7.5, 7.5), o)));
    const q = free ?? at;
    occupied.push(around(q, 7.5, 7.5));
    if (q[0] !== at[0] || q[1] !== at[1]) nudged.set(i, q);
  }
  const others = markers
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !always(m) && m.kind !== 'first-aid')
    .sort((a, b) => priority(a.m) - priority(b.m));
  const place = (list) => list.filter(({ m }) => fits(markerBox(m, screen(m.at), hazardLabel))).map(({ i }) => i);
  const rescueShown = place(others.filter(({ m }) => isRescue(m)));
  const labels = [...areas]
    .sort((x, y) => y.size - x.size)
    .map((a) => ({ id: a.id, text: a.text, at: screen(a.label) }))
    .filter((l) => fits(around(l.at, textWidth(l.text, LABEL_PX) / 2 + 4, LABEL_PX / 2 + 2)));
  const sectorLabels = sectors.filter((l) => fits(around(l.at, textWidth(l.text, SECTOR_LABEL_PX) / 2 + 2, SECTOR_LABEL_PX / 2 + 2)));
  const shown = new Set([...fixed, ...aid, ...rescueShown, ...place(others.filter(({ m }) => !isRescue(m)))]);
  return { shown, labels, sectorLabels, nudged, occupied };
}

/* ---------- 道路、步道沿線的名稱 ---------- */

/** 名稱離畫面邊緣至少幾像素 */
const EDGE_PX = 10;
/** 判斷重疊：沿著排字的線每 BOX_STEP_PX 取一個邊長 2 × BOX_HALF_PX 的方塊 */
const BOX_STEP_PX = 6;
const BOX_HALF_PX = 7;
/** 先排步道（攀岩者的路），道路最後 */
const LINE_ORDER = { trail: 0, road: 1, highway: 2, tunnel: 3 };
/** 名稱底下的線偏離直線最多幾像素 */
const STRAIGHT_PX = 5;
/** 在錨點附近找最直的一段：每次移動名稱寬度的這個比例，最多往兩邊各找 SHIFT_STEPS 次 */
const SHIFT_FRACTION = 0.5;
const SHIFT_STEPS = 6;

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** 點到線段的距離 */
export function segmentDistance(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** 折線上從起點量起 s0 到 s1 這一段（含中間的頂點） */
function slice(points, s0, s1) {
  const out = [];
  let at = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const len = dist(a, b);
    const lerp = (s) => [a[0] + ((b[0] - a[0]) * (s - at)) / len, a[1] + ((b[1] - a[1]) * (s - at)) / len];
    if (out.length === 0 && s0 <= at + len) out.push(lerp(Math.max(s0, at)));
    if (out.length && s1 <= at + len) {
      out.push(lerp(s1));
      return out;
    }
    if (out.length) out.push(b);
    at += len;
  }
  return out;
}

function boxesAlong(points) {
  const total = points.slice(1).reduce((s, q, i) => s + dist(points[i], q), 0);
  const n = Math.max(1, Math.ceil(total / BOX_STEP_PX));
  return Array.from({ length: n + 1 }, (_, k) => {
    const [x, y] = slice(points, 0, (total * k) / n).at(-1) ?? points[0];
    return [x - BOX_HALF_PX, y - BOX_HALF_PX, x + BOX_HALF_PX, y + BOX_HALF_PX];
  });
}

function arcAt(points, q) {
  let [best, bestD, at] = [0, Infinity, 0];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const len = dist(a, b);
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / (len * len)));
    const d = Math.hypot(q[0] - a[0] - t * (b[0] - a[0]), q[1] - a[1] - t * (b[1] - a[1]));
    if (d < bestD) [best, bestD] = [at + t * len, d];
    at += len;
  }
  return best;
}

function bend(points) {
  const [a, b] = [points[0], points[points.length - 1]];
  return Math.max(...points.map((q) => segmentDistance(q, a, b)));
}

/**
 * 每個名稱找 line 種類裡離錨點最近的那條線，名稱的中心在錨點投影到線上的位置；那一段彎得太厲害時在附近沿線找夠直的一段。
 * 文字沿著弦排、保持朝上；沒有夠直的一段、超出畫面、或和已排好的名稱、occupied 重疊就不畫；同一條線只排一個名稱。
 * names：{ line, at（平面）, ... }；lines：種類 → 平面座標的線；width(name) 是名稱的寬度（像素）。
 */
export function placeLineNames(names, lines, screen, frame, width, occupied = [], metersPerPx = 1) {
  const inside = ([x, y]) => x >= EDGE_PX && y >= EDGE_PX && x <= frame.w - EDGE_PX && y <= frame.h - EDGE_PX;
  const used = new Set();
  const placed = [];
  const order = names.map((name, n) => ({ name, n })).sort((a, b) => LINE_ORDER[a.name.line] - LINE_ORDER[b.name.line]);
  const taken = [...occupied];
  for (const { name, n } of order) {
    const candidates = lines[name.line] ?? [];
    if (!candidates.length) continue;
    const index = candidates
      .map((l, i) => ({ i, d: Math.min(...l.slice(1).map((b, j) => segmentDistance(name.at, l[j], b))) }))
      .reduce((a, b) => (b.d < a.d ? b : a)).i;
    const key = `${name.line}:${index}`;
    if (used.has(key)) continue;
    const line = candidates[index];
    const total = line.slice(1).reduce((sum, q, i) => sum + dist(line[i], q), 0);
    const half = (width(name) * metersPerPx) / 2;
    if (total < 2 * half) continue;
    const anchor = arcAt(line, name.at);
    const shifts = [0, ...Array.from({ length: SHIFT_STEPS }, (_, k) => [(k + 1) * SHIFT_FRACTION * half * 2, -(k + 1) * SHIFT_FRACTION * half * 2]).flat()];
    for (const shift of shifts) {
      const c = anchor + shift;
      if (c - half < 0 || c + half > total) continue;
      const along = slice(line, c - half, c + half).map(screen);
      if (along.length < 2 || bend(along) > STRAIGHT_PX) continue;
      let points = [along[0], along[along.length - 1]];
      if (points[1][0] < points[0][0]) points = [points[1], points[0]];
      if (!points.every(inside)) break;
      const boxes = boxesAlong(points);
      if (boxes.some((b) => taken.some((o) => overlaps(b, o)))) break;
      used.add(key);
      taken.push(...boxes);
      placed.push({ key: `${key}:${n}`, name, points, boxes });
      break;
    }
  }
  return placed;
}
