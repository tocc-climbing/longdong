// 標記的呈現：依畫面上的大小自動排版牌子（編號、難度名稱、bolt）。座標都是照片像素。
// 移植自龍洞（MIT）src/core/topo/annotate.ts，演算法不變，只改成 JavaScript。
// English: automatic label layout. Coordinates are photo pixels. Ported from Longdong (MIT) annotate.ts.

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** 折線的長度 */
export function pathLength(pts) {
  return pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i], p), 0);
}

/** 通過每個點的平滑曲線（centripetal Catmull–Rom 轉三次貝茲），回傳 SVG 的 path d；少於 3 個點是直線 */
export function smoothPath(pts) {
  if (pts.length === 0) return '';
  const fmt = (n) => +n.toFixed(2);
  const head = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  if (pts.length < 3) return pts.length === 2 ? `${head}L${fmt(pts[1][0])} ${fmt(pts[1][1])}` : head;
  let d = head;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    // centripetal：參數間隔取距離的平方根；重疊的點（距離 0）當成很近，避免除以 0
    const d1 = Math.sqrt(dist(p0, p1)) || 1e-3, d2 = Math.sqrt(dist(p1, p2)) || 1e-3, d3 = Math.sqrt(dist(p2, p3)) || 1e-3;
    const tangent1 = (a) => ((p1[a] - p0[a]) / d1 - (p2[a] - p0[a]) / (d1 + d2) + (p2[a] - p1[a]) / d2) * d2;
    const tangent2 = (a) => ((p2[a] - p1[a]) / d2 - (p3[a] - p1[a]) / (d2 + d3) + (p3[a] - p2[a]) / d3) * d2;
    const b1 = [p1[0] + tangent1(0) / 3, p1[1] + tangent1(1) / 3];
    const b2 = [p2[0] - tangent2(0) / 3, p2[1] - tangent2(1) / 3];
    d += `C${fmt(b1[0])} ${fmt(b1[1])} ${fmt(b2[0])} ${fmt(b2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

/** 折線上，從起點走完全長的 f（0–1）那一點 */
export function pointAlong(pts, f) {
  if (pts.length === 1) return pts[0];
  let want = pathLength(pts) * Math.min(1, Math.max(0, f));
  for (let i = 1; i < pts.length; i++) {
    const len = dist(pts[i - 1], pts[i]);
    if (want <= len || i === pts.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, want / len);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    want -= len;
  }
  return pts[pts.length - 1];
}

export const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** 以 at 為中心、寬 w 高 h 的框 */
export const centeredBox = ([x, y], w, h) => ({ x: x - w / 2, y: y - h / 2, w, h });

/** 點 p 到折線 line 的最短距離 */
export function distanceToLine(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** 線段 a–b 是否穿過框（Liang–Barsky） */
export function segmentHitsBox(a, b, box) {
  const inBox = ([x, y]) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  if (inBox(a) || inBox(b)) return true;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - box.x], [dx, box.x + box.w - a[0]], [-dy, a[1] - box.y], [dy, box.y + box.h - a[1]]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * 依序放牌子：先放的優先。每個牌子給幾個候選位置，取第一個不超出範圍、不和已放的重疊的；都不行就不放（藏起來），
 * force 時（例如選到的路線）放不下也放第一個候選位置。
 */
export class Placer {
  constructor(bounds, gap = 3, lines = []) {
    this.bounds = bounds; this.gap = gap; this.lines = lines; this.placed = [];
  }
  inside(b) {
    const o = this.bounds;
    return b.x >= o.x && b.y >= o.y && b.x + b.w <= o.x + o.w && b.y + b.h <= o.y + o.h;
  }
  /** 這個位置放得下：在範圍內、不和已放的重疊 */
  fits(c) { return this.inside(c) && !this.placed.some((p) => overlaps(c, p, this.gap)); }
  /** 壓到線（except：不算這條，例如說明壓在自己的線上） */
  onLine(c, except) {
    return this.lines.some((line) => line !== except && line.slice(1).some((p, i) => segmentHitsBox(line[i], p, c)));
  }
  /** 回傳放在哪一個候選位置（框）；放不下回傳 undefined */
  place(candidates, force = false) {
    const fit = candidates.find((c) => this.fits(c));
    const chosen = fit ?? (force ? candidates[0] : undefined);
    if (chosen) this.placed.push(chosen);
    return chosen;
  }
  /** 先佔住一塊，後面的牌子避開 */
  reserve(box) { this.placed.push(box); }
}

const CJK = /[　-鿿＀-￯]/;

/** 文字在畫面上的寬度（螢幕像素，估計值）：中日文約 1 個字高，英數約 0.6 */
export function textWidth(text, fontPx) {
  return [...text].reduce((w, c) => w + (CJK.test(c) ? 1 : 0.6) * fontPx, 0);
}

/** 依寬度換行（螢幕像素）：在空白、「·」處斷開；中日文可以在任何字之間斷開；單一個英文字比寬度長時不硬切 */
export function wrapText(text, fontPx, maxWidth) {
  const tokens = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+\s*|\s+/g) ?? [text];
  const lines = [];
  let cur = '';
  for (const tok of tokens) {
    if (cur && textWidth((cur + tok).trimEnd(), fontPx) > maxWidth) {
      lines.push(cur.trim());
      cur = tok.trimStart();
    } else cur += tok;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.map((l) => l.replace(/^·\s*|\s*·$/g, '')).filter(Boolean);
}
