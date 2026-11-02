// v2 地圖畫面（kind: view、surface: map，經緯度、經度在前）→ 畫得出來的模型（平面座標，公尺）。
// 詞彙見 format/VOCABULARY.md 的「地圖」：底圖是沒有節點的標註（props.kind：land、building、parking、highway、tunnel、road、trail），
// 區域（type area，多邊形）、分區（type sector，岩壁線）、地點（type poi，props.kind），顏色在標註的 props.style；
// 畫面的 props.bounds（移動範圍）、extent（底圖資料的範圍）、home（一開始的畫面）都是 [西, 南, 東, 北]。
// English: read a v2 map view (plus layers) into a projected drawing model.
import { projection, rectOf } from './viewport.js';

/** 底圖的種類：畫的順序 */
export const BASE_KINDS = ['land', 'building', 'parking', 'highway', 'tunnel', 'road', 'trail'];
/** 沿線排名稱的線（line-name 地點的 props.line） */
export const LINE_KINDS = ['trail', 'road', 'highway', 'tunnel'];

/** 不是 v2 地圖畫面就丟錯 */
export function assertMap(view) {
  if (!view || view.climbio !== 2 || view.kind !== 'view' || view.surface !== 'map') throw new Error('mapkit：需要 Climbio v2 的地圖畫面（kind: view、surface: map）');
}

/** 名稱：字串，或語言 → 字串；lang 沒有就用中文、英文、第一個 */
export function pickName(name, lang) {
  if (!name) return '';
  if (typeof name === 'string') return name;
  const tags = lang === 'zh' ? ['zh-Hant', 'zh'] : [lang];
  for (const t of [...tags, 'zh-Hant', 'en']) if (name[t]) return name[t];
  return Object.values(name)[0] ?? '';
}

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const linesOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
const bboxRect = (b, project) => {
  const [x0, y0] = project([b[0], b[3]]), [x1, y1] = project([b[2], b[1]]);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** SVG path：一串平面座標（公尺，小數兩位：放到最大時每像素 0.05 公尺） */
export const pathOf = (line, close = false) => 'M' + line.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L') + (close ? 'Z' : '');

/** 多邊形的重心與面積（鞋帶公式；最後一點要等於第一點） */
export function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return { at: [cx / (3 * a), cy / (3 * a)], size: Math.abs(a / 2) };
}

/**
 * view：v2 地圖畫面；layers：疊在它上面的圖層；nodes：其他檔案的節點（例如組合裡的區域、分區名稱）。
 * 回傳 { proj, base, lines, areas, walls, pois, bounds, extent, home, nodes }：
 *   base：kind → SVG path；lines：線的種類 → 平面座標的線（排名稱用）
 *   areas：{ id, name, path, rings, label, size, style }；walls：{ id, name, lines, style }
 *   pois：{ id, kind, at, name, label, tone, line }；bounds、extent、home：平面座標的矩形
 */
export function readMap(view, layers = [], extraNodes = []) {
  assertMap(view);
  // 圖層裡有標註的節點：以最後一個圖層的形狀為準（例如改過的岩壁），蓋掉畫面與前面圖層的
  const marks = [view, ...layers].reduce((acc, doc) => {
    const own = doc.marks ?? [];
    const replaced = new Set(own.flatMap((m) => (m.node ? [m.node] : [])));
    return [...acc.filter((m) => !m.node || !replaced.has(m.node)), ...own];
  }, []);
  const nodes = new Map([...extraNodes, ...(view.nodes ?? []), ...layers.flatMap((l) => l.nodes ?? [])].map((n) => [n.id, n]));
  const p = view.props ?? {};
  const all = marks.flatMap((m) => [...polygonsOf(m.geometry).flat(2), ...linesOf(m.geometry).flat(), ...(m.geometry.type === 'Point' ? [m.geometry.coordinates] : [])]);
  const box = p.bounds ?? p.home ?? [Math.min(...all.map((q) => q[0])), Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[0])), Math.max(...all.map((q) => q[1]))];
  const proj = projection([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  const P = (q) => proj.project(q);

  const base = {}, lines = Object.fromEntries(LINE_KINDS.map((k) => [k, []]));
  const areas = [], walls = [], pois = [];
  for (const m of marks) {
    const g = m.geometry, node = m.node ? nodes.get(m.node) : undefined;
    if (!node) {
      const kind = m.props?.kind;
      if (!BASE_KINDS.includes(kind)) continue;
      const polys = polygonsOf(g).map((poly) => poly.map((r) => r.map(P)));
      const ls = linesOf(g).map((l) => l.map(P));
      base[kind] = (base[kind] ?? '') + polys.flatMap((poly) => poly.map((r) => pathOf(r, true))).join('') + ls.map((l) => pathOf(l)).join('');
      if (kind in lines) lines[kind].push(...ls);
      continue;
    }
    if (node.type === 'area') {
      const polys = polygonsOf(g).map((poly) => poly.map((r) => r.map(P)));
      const rings = polys.map((poly) => poly[0]);
      const pieces = rings.map(centroid);
      const largest = pieces.reduce((a, b) => (b.size > a.size ? b : a));
      areas.push({ id: node.id, node, path: polys.flatMap((poly) => poly.map((r) => pathOf(r, true))).join(''), rings, label: largest.at, size: pieces.reduce((s, x) => s + x.size, 0), style: m.props?.style ?? {} });
    } else if (node.type === 'sector') {
      walls.push({ id: node.id, node, lines: linesOf(g).map((l) => l.map(P)), lngLat: linesOf(g), style: m.props?.style ?? {} });
    } else if (node.type === 'poi' && g.type === 'Point') {
      const np = node.props ?? {};
      pois.push({ id: node.id, node, kind: np.kind, at: P(g.coordinates), label: np.label, tone: np.tone, line: np.line });
    }
  }
  const bounds = bboxRect(p.bounds ?? box, P);
  const extent = p.extent ? bboxRect(p.extent, P) : bounds;
  return {
    proj,
    base,
    lines,
    areas,
    walls,
    pois,
    nodes,
    bounds: { ...bounds, maxW: extent.w },
    extent,
    home: p.home ? bboxRect(p.home, P) : areas.length ? rectOf(areas.flatMap((a) => a.rings.flat())) : bounds,
  };
}
