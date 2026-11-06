// 地圖的 SVG：底圖、區域、道路、步道在平面座標上畫（隨地圖旋轉）；地點、文字、岩壁、編輯中的線畫在螢幕座標上（旋轉後仍然朝上、大小固定）。
// 移植自龍洞（MIT）src/map/ScaleMap.tsx 的畫法。回傳 SVG 的內容（字串）；文字一律跳脫。
// English: SVG markup for the map (vector layers in map space; icons/labels in screen space). Ported from Longdong (MIT).
import { pickName } from './data.js';
import { declutter, HAZARD_R, LABEL_PX, LINE_NAME_PAD_PX, LINE_NAME_PX, placeLineNames, PLACE_PX, SECTOR_LABEL_PX, textWidth } from './labels.js';
import { dashLength, mapTransform, toScreen } from './viewport.js';

/** 道路、步道至少畫成實際的寬度（公尺） */
const ROAD_WIDTH_M = { highway: 8, road: 5, trail: 1.5 };
/** 放大到每像素不到 ICON_GROW_SCALE 公尺時，圖示跟著放大，最多 ICON_MAX_GROW 倍 */
const ICON_GROW_SCALE = 0.5;
const ICON_MAX_GROW = 1.6;
/** 放大到每像素不到這麼多公尺時才顯示分區名稱 */
export const SECTOR_LABEL_SCALE = 0.4;
/** 岩壁面朝向的箭頭長度與離線條的距離（像素） */
const FACE_ARROW_PX = 16;
const FACE_GAP_PX = 3;
/** 建議路線的箭頭：間隔與大小（像素） */
const ARROW_GAP_PX = 60;
const ARROW_PX = 5;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const f1 = (v) => v.toFixed(1);
const d = (pts, close = false) => 'M' + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L') + (close ? 'Z' : '');
/** 區域的顏色用屬性（不是 style）：航照模式的 CSS（只畫邊框）才蓋得過 */
const colorAttrs = (st = {}) => (st.fill ? ` fill="${esc(st.fill)}"` : '') + (st.stroke ? ` stroke="${esc(st.stroke)}"` : '');

/** 兩點的距離（相對值：經度依緯度縮放，只用來比長短、找中點） */
const span = ([lng1, lat1], [lng2, lat2]) => Math.hypot(lat2 - lat1, (lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180));

/** 分區名稱的位置：最長的一段岩壁沿線走到一半的那一點（經緯度）；沒有岩壁時 undefined */
export function wallLabelAt(lines) {
  const length = (l) => l.slice(1).reduce((sum, p, i) => sum + span(l[i], p), 0);
  const longest = lines.filter((l) => l.length > 0).reduce((best, l) => (!best || length(l) > length(best) ? l : best), undefined);
  if (!longest) return undefined;
  let rest = length(longest) / 2;
  for (let i = 1; i < longest.length; i++) {
    const dd = span(longest[i - 1], longest[i]);
    if (dd >= rest && dd > 0) {
      const t = rest / dd;
      return [longest[i - 1][0] + (longest[i][0] - longest[i - 1][0]) * t, longest[i - 1][1] + (longest[i][1] - longest[i - 1][1]) * t];
    }
    rest -= dd;
  }
  return longest[0];
}

/**
 * model：readMap 的結果；v：畫面；frame：框的大小；o：
 *   lang、text（介面文字，見 view.js 的 TEXT）、id（這張地圖的 id，給 clipPath、textPath 用）
 *   dim（區域節點 id：其他區域變淡）、hideAreas、hide（不畫的區域、分區節點 id）、walls（畫岩壁）、sectorLabels（放大後標分區名稱；true 全部，或分區 id 陣列只標這些）、selected（{ node, line }；沒有 line 是整個分區的每一條，不標名稱）
 *   tiles（{ ortho?: 圖磚[], contours?: 圖磚[], osm?: 圖磚[] }，平面座標）、ortho（航照模式：區域只畫邊框）
 *   draft（{ points（經緯度）, closed }）、marks、here、pick、edit（{ rings（經緯度）, closed, selected, faces }）
 * 回傳 { svg（<svg> 的內容）, labels（畫出來的區域、分區、地點，給測試比對）}
 */
export function renderMap(model, v, frame, o) {
  const hidden = new Set(o.hide ?? []);
  model = { ...model, areas: model.areas.filter((a) => !hidden.has(a.id)), walls: model.walls.filter((w) => !hidden.has(w.id)) };
  const { proj } = model;
  const id = o.id;
  const screen = (p) => toScreen(v, frame, p);
  const ll = (q) => screen(proj.project(q));
  const px = v.s;
  const name = (n) => pickName(n?.name, o.lang);
  const T = o.text;
  const out = [];

  const trailDash = Math.max(dashLength(3, px), 2 * ROAD_WIDTH_M.trail);
  const tunnelDash = Math.max(dashLength(6, px), 3 * ROAD_WIDTH_M.highway);
  const grow = Math.min(ICON_MAX_GROW, Math.max(1, ICON_GROW_SCALE / v.s));
  const grown = (x, y) => (grow === 1 ? '' : ` transform="translate(${x} ${y}) scale(${grow}) translate(${-x} ${-y})"`);
  const cover = Math.hypot(frame.w, frame.h) * px;

  // 平面座標的圖層
  const B = model.base;
  out.push(`<g transform="${mapTransform(v, frame)}">`);
  out.push(`<defs><clipPath id="${id}-extent"><rect x="${model.extent.x}" y="${model.extent.y}" width="${model.extent.w}" height="${model.extent.h}"></rect></clipPath></defs>`);
  out.push(`<rect class="mk-sea" x="${v.cx - cover}" y="${v.cy - cover}" width="${cover * 2}" height="${cover * 2}"></rect>`);
  if (o.tiles?.osm?.length) out.push(`<g clip-path="url(#${id}-extent)">${tilesSvg(o.tiles.osm)}</g>`);
  else {
    if (B.land) out.push(`<path class="mk-land" d="${B.land}"></path>`);
    out.push(`<path class="mk-building" d="${B.building ?? ''}"></path>`);
  }
  if (o.tiles?.ortho?.length) out.push(`<g clip-path="url(#${id}-extent)">${tilesSvg(o.tiles.ortho)}</g>`);
  if (o.tiles?.contours?.length) out.push(`<g class="mk-topo" clip-path="url(#${id}-extent)">${tilesSvg(o.tiles.contours)}</g>`);
  if (!o.hideAreas) for (const a of model.areas) out.push(`<path class="mk-area${o.dim && a.id !== o.dim ? ' mk-dim' : ''}" data-node="${esc(a.id)}" d="${a.path}" stroke-width="${px}"${colorAttrs(a.style)}></path>`);
  if (!o.tiles?.osm?.length) {
    out.push('<g class="mk-roads">');
    out.push(`<path class="mk-highway" d="${B.highway ?? ''}" stroke-width="${Math.max(5 * px, ROAD_WIDTH_M.highway)}"></path>`);
    out.push(`<path class="mk-tunnel" d="${B.tunnel ?? ''}" stroke-width="${Math.max(5 * px, ROAD_WIDTH_M.highway)}" stroke-dasharray="${tunnelDash / 3} ${tunnelDash}"></path>`);
    out.push(`<path class="mk-road" d="${B.road ?? ''}" stroke-width="${Math.max(2.5 * px, ROAD_WIDTH_M.road)}"></path>`);
    out.push(`<path class="mk-parking-area" d="${B.parking ?? ''}"></path>`);
    out.push('</g>');
    out.push(`<path class="mk-trail" d="${B.trail ?? ''}" stroke-width="${Math.max(2 * px, ROAD_WIDTH_M.trail)}" stroke-dasharray="${trailDash} ${trailDash}"></path>`);
  }
  // 建議路線：疊在道路上的粗線（箭頭在螢幕座標畫）
  if (model.routes?.length) out.push(`<path class="mk-route" d="${model.routes.map((l) => d(l)).join('')}" stroke-width="${Math.max(5 * px, ROAD_WIDTH_M.road)}"></path>`);
  // 石頭：石塊的形狀（在步道上面畫，看得出一顆一顆）
  for (const r of model.rocks ?? []) out.push(`<path class="mk-rock${o.selected?.node === r.id ? ' selected' : ''}" data-node="${esc(r.id)}" d="${r.path}" stroke-width="${1.5 * px}"${colorAttrs(r.style)}></path>`);
  const me = o.here && proj.project(o.here.at);
  if (me) out.push(`<circle class="mk-me-accuracy" cx="${me[0]}" cy="${me[1]}" r="${o.here.accuracy}"></circle>`);
  out.push('</g>');

  // 螢幕座標：地點與文字（避讓）
  const markers = model.pois.filter((p) => p.kind !== 'rescue' && p.kind !== 'line-name').map((p) => ({ ...p, text: p.kind === 'place' ? name(p.node) : undefined }));
  const rescue = model.pois.filter((p) => p.kind === 'rescue');
  const areas = o.hideAreas ? [] : model.areas.map((a) => ({ ...a, text: name(a.node) }));
  const sectorTexts =
    o.sectorLabels && !o.hideAreas && v.s < SECTOR_LABEL_SCALE
      ? model.walls.flatMap((w) => {
          if (Array.isArray(o.sectorLabels) && !o.sectorLabels.includes(w.id)) return [];
          const at = wallLabelAt(w.lngLat);
          return at ? [{ id: w.id, text: name(w.node), at: ll(at) }] : [];
        })
      : [];
  const { shown, labels, sectorLabels, nudged, occupied } = declutter(markers, rescue.map((r) => r.at), areas, sectorTexts, screen, T.hazard);

  out.push(`<g font-size="${LABEL_PX}">`);
  markers.forEach((m, i) => {
    if (!shown.has(i)) return;
    const [x, y] = screen(m.at);
    if (m.kind === 'place') out.push(`<text class="mk-place mk-place-${m.tone ?? 'place'}" x="${x}" y="${y}" font-size="${PLACE_PX}" text-anchor="middle" dominant-baseline="central">${esc(m.text)}</text>`);
    else if (m.kind === 'hazard')
      out.push(
        `<g class="mk-hazard"${grown(x, y)}><circle cx="${x}" cy="${y}" r="${HAZARD_R}"></circle><text x="${x}" y="${y}" font-size="10" text-anchor="middle" dominant-baseline="central">!</text>` +
          `<text class="mk-hazard-label" x="${x + HAZARD_R + 4}" y="${y}" font-size="10" dominant-baseline="central">${esc(T.hazard)}</text></g>`,
      );
    else if (m.kind === 'boat')
      out.push(`<g class="mk-boat"${grown(x, y)}><title>${esc(T.boat)}</title><circle cx="${x}" cy="${y}" r="6" stroke-width="1"></circle><circle cx="${x}" cy="${y}" r="3.5" stroke-width="1.5"></circle><circle class="mk-boat-dot" cx="${x}" cy="${y}" r="1.6"></circle></g>`);
    else if (m.kind === 'helicopter')
      out.push(`<g class="mk-hoist"${grown(x, y)}><title>${esc(T.hoist)}</title><path d="M${x} ${y}l-5.5 -9a6.4 6.4 0 1 1 11 0z"></path><text x="${x}" y="${y - 12.5}" font-size="8" text-anchor="middle" dominant-baseline="central">H</text></g>`);
    else if (m.kind === 'first-aid') {
      const moved = nudged.get(i);
      const [ex, ey] = moved ?? [x, y];
      out.push(
        `<g class="mk-aid"><title>${esc(T.aid.replace('{n}', m.label ?? ''))}</title>` +
          (moved ? `<line class="mk-aid-link" x1="${x}" y1="${y}" x2="${ex}" y2="${ey}"></line><circle class="mk-aid-dot" cx="${x}" cy="${y}" r="2"></circle>` : '') +
          `<g${grown(ex, ey)}><rect x="${ex - 6}" y="${ey - 7}" width="12" height="14" rx="4"></rect><path d="M${ex - 3.5} ${ey}h7M${ex} ${ey - 3.5}v7" stroke-width="2"></path></g></g>`,
      );
    }
  });

  // 道路、步道的名稱沿著線排
  const lineNames = model.pois.filter((p) => p.kind === 'line-name').map((p) => ({ ...p, text: name(p.node) }));
  const names = placeLineNames(lineNames, model.lines, screen, frame, (n) => textWidth(n.text, LINE_NAME_PX) + LINE_NAME_PAD_PX, occupied, v.s);
  out.push(`<defs>${names.map((p, i) => `<path id="${id}-${i}" d="${d(p.points)}"></path>`).join('')}</defs>`);
  names.forEach((p, i) =>
    out.push(`<text class="mk-place mk-place-${p.name.tone ?? 'road'} mk-line-name" font-size="${LINE_NAME_PX}" dominant-baseline="central"><textPath href="#${id}-${i}" startOffset="50%" text-anchor="middle">${esc(p.name.text)}</textPath></text>`),
  );
  for (const l of labels) {
    const a = model.areas.find((x) => x.id === l.id);
    out.push(`<text class="mk-label" x="${l.at[0]}" y="${l.at[1]}" text-anchor="middle" dominant-baseline="central" ${a.style.stroke ? ` style="fill:${esc(a.style.stroke)}"` : ''}>${esc(l.text)}</text>`);
  }

  // 岩壁與正在畫的線
  const lines = [
    ...(o.walls ? model.walls.flatMap((w) => w.lngLat.map((pts, k) => ({ key: `${w.id}#${k}`, pts, stroke: w.style.stroke, label: name(w.node), selected: o.selected?.node === w.id && (o.selected.line === undefined || o.selected.line === k), named: o.selected?.line === k }))) : []),
    ...(o.draft ? [{ key: 'draft', pts: o.draft.points, draft: true, closed: o.draft.closed }] : []),
  ];
  for (const l of lines) {
    const pts = l.pts.map(ll);
    const path = d(pts);
    const mid = pts[Math.floor(pts.length / 2)];
    const preview = l.draft && l.closed && pts.length >= 3;
    out.push(`<g class="mk-line${l.draft ? ' draft' : ''}${l.selected ? ' selected' : ''}" data-line="${esc(l.key)}"${l.stroke ? ` style="stroke:${esc(l.stroke)}"` : ''}>`);
    if (preview) out.push(`<path class="mk-line-fill" d="${path}Z"></path><path class="mk-line-close" d="M${f1(pts.at(-1)[0])} ${f1(pts.at(-1)[1])}L${f1(pts[0][0])} ${f1(pts[0][1])}"></path>`);
    if (pts.length > 1) out.push(`<path class="mk-line-stroke" d="${path}"></path>`);
    if (l.draft) for (const [x, y] of pts) out.push(`<circle class="mk-line-vertex" cx="${x}" cy="${y}" r="4"></circle>`);
    if (l.selected && l.named && l.label && mid) out.push(`<text class="mk-line-label" x="${mid[0]}" y="${mid[1] - 10}" font-size="12" text-anchor="middle"${l.stroke ? ` style="fill:${esc(l.stroke)}"` : ''}>${esc(l.label)}</text>`);
    out.push('</g>');
  }

  // 建議路線的箭頭：沿線每隔一段畫一個 ›，指向畫線的方向（位置釘在地圖上，縮放不會滑動）
  for (const l of model.routes ?? []) out.push(...routeArrows(l, arrowGap(v.s)).map(([at, a, b]) => {
    const [x, y] = screen(at), [ax, ay] = screen(a), [bx, by] = screen(b);
    return [x, y, (Math.atan2(by - ay, bx - ax) * 180) / Math.PI];
  }).map(([x, y, a]) => `<path class="mk-route-arrow" d="M-${ARROW_PX / 2} -${ARROW_PX}L${ARROW_PX / 2} 0L-${ARROW_PX / 2} ${ARROW_PX}" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(a)})"></path>`));

  // 石頭的名稱：寫在石塊下面（放大到看得到才寫，互相蓋到的跳過）
  if (v.s < SECTOR_LABEL_SCALE * 2) {
    const taken = [];
    for (const r of model.rocks ?? []) {
      const ys = r.rings[0].map((q) => q[1]), [cx] = r.label, [x, y] = screen([cx, Math.max(...ys)]), text = name(r.node), w = textWidth(text, 12) + 4;
      const box = { x: x - w / 2, y: y + 2, w, h: 15 };
      if (taken.some((b) => b.x < box.x + box.w && box.x < b.x + b.w && b.y < box.y + box.h && box.y < b.y + b.h)) continue;
      taken.push(box);
      out.push(`<text class="mk-rock-label" x="${x}" y="${y + 9}" font-size="12" text-anchor="middle" dominant-baseline="central">${esc(text)}</text>`);
    }
  }
  for (const r of rescue) {
    const [x, y] = screen(r.at);
    out.push(`<g class="mk-rescue"${grown(x, y)}><circle cx="${x}" cy="${y}" r="7"></circle><text x="${x}" y="${y}" font-size="9" text-anchor="middle" dominant-baseline="central">${esc(r.label ?? '')}</text></g>`);
  }
  for (const m of markers) {
    if (m.kind !== 'parking') continue;
    const [x, y] = screen(m.at);
    out.push(`<text class="mk-parking" x="${x}" y="${y}" font-size="12" text-anchor="middle" dominant-baseline="central"${grown(x, y)}>P</text>`);
  }

  // 回報：GPS 位置（圓點）、在地圖上點的位置（菱形），兩點之間連一條虛線
  for (const m of [...(o.marks ?? [])].sort((a, b) => Number(!!a.selected) - Number(!!b.selected))) {
    const [x, y] = ll(m.at);
    const p = m.picked && ll(m.picked);
    const r = (m.label ? 9 : 5) + (m.selected ? 3 : 0);
    const dd = m.label ? 6 : r + 1;
    out.push(`<g class="mk-mark${m.selected ? ' selected' : ''}">`);
    if (p) out.push(`<line class="mk-mark-link" x1="${x}" y1="${y}" x2="${p[0]}" y2="${p[1]}"></line><path class="mk-mark-picked" d="M${p[0]} ${p[1] - dd}l${dd} ${dd}l${-dd} ${dd}l${-dd} ${-dd}z"></path>`);
    out.push(`<circle class="mk-mark-gps" cx="${x}" cy="${y}" r="${r}"></circle>`);
    if (m.label) out.push(`<text x="${x}" y="${y}" font-size="${m.selected ? 12 : 10}" text-anchor="middle" dominant-baseline="central">${esc(m.label)}</text>`);
    out.push('</g>');
  }

  // 編輯中的多邊形或線段：選中的那塊顯示頂點與邊的中點；岩壁標出右手邊（岩壁面）的箭頭
  const e = o.edit;
  e?.rings.forEach((ring, i) => {
    const pts = ring.map(ll);
    out.push(`<g><path class="mk-edit-ring${e.closed ? '' : ' open'}${i === e.selected ? ' selected' : ''}" d="${d(pts, e.closed)}"></path>`);
    if (e.faces)
      pts.slice(1).forEach((b, j) => {
        const a = pts[j];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 2 * FACE_ARROW_PX) return;
        const [nx, ny] = [(a[1] - b[1]) / len, (b[0] - a[0]) / len];
        const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const [bx, by] = [mx + nx * FACE_GAP_PX, my + ny * FACE_GAP_PX];
        const [tx, ty] = [bx + nx * FACE_ARROW_PX, by + ny * FACE_ARROW_PX];
        const [hx, hy] = [(-ny * FACE_ARROW_PX) / 2, (nx * FACE_ARROW_PX) / 2];
        out.push(`<path class="mk-edit-face" d="M${bx + hx} ${by + hy}L${tx} ${ty}L${bx - hx} ${by - hy}Z"></path>`);
      });
    out.push('</g>');
  });
  for (const l of sectorLabels) out.push(`<text class="mk-sector-label" x="${l.at[0]}" y="${l.at[1]}" font-size="${SECTOR_LABEL_PX}" text-anchor="middle" dominant-baseline="central">${esc(l.text)}</text>`);
  if (e?.selected !== undefined && e.rings[e.selected]) {
    const ring = e.rings[e.selected];
    const pts = ring.map(ll);
    out.push('<g class="mk-edit-handles">');
    pts.slice(0, e.closed ? pts.length : pts.length - 1).forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      out.push(`<circle class="mk-handle mk-handle-mid" data-mid="${i}" cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" r="4"></circle>`);
    });
    pts.forEach(([x, y], i) => out.push(`<circle class="mk-handle${o.dragging === i ? ' dragging' : ''}" data-vertex="${i}" cx="${x}" cy="${y}" r="6"></circle>`));
    out.push('</g>');
  }
  if (o.pick) {
    const [x, y] = ll(o.pick);
    out.push(`<g class="mk-pick"><path d="M${x} ${y}l-9 -22a10 10 0 1 1 18 0z"></path><circle cx="${x}" cy="${y - 22}" r="3.5"></circle></g>`);
  }
  if (me) {
    const [x, y] = screen(me);
    out.push(`<circle class="mk-me" cx="${x}" cy="${y}" r="7" stroke-width="2.5"></circle>`);
  }
  out.push('</g>');
  return {
    svg: out.join(''),
    labels: { areas: labels.map((l) => ({ id: l.id, at: l.at })), sectors: sectorLabels.map((l) => ({ id: l.id, at: l.at })), markers: [...shown].map((i) => ({ kind: markers[i].kind, at: nudged.get(i) ?? screen(markers[i].at) })), lineNames: names.map((n) => n.name.text) },
  };
}

/** 箭頭的間隔（公尺）：螢幕上約 ARROW_GAP_PX 像素，取 2 的次方，縮放時箭頭釘在地圖上不滑動（放大一倍才多出中間的一個） */
export const arrowGap = (s) => 2 ** Math.ceil(Math.log2(ARROW_GAP_PX * s));

/** 建議路線的箭頭：平面座標的線上每隔 gap 公尺一個（從線頭量起），回傳 [位置, 所在線段的起點, 終點]（平面座標） */
export function routeArrows(pts, gap) {
  const out = [];
  let next = gap;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], len = Math.hypot(x1 - x0, y1 - y0);
    while (len > 0 && next <= walked + len) {
      const t = (next - walked) / len;
      out.push([[x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], pts[i - 1], pts[i]]);
      next += gap;
    }
    walked += len;
  }
  return out;
}

function tilesSvg(tiles) {
  return tiles.map((t) => `<image href="${esc(t.href)}" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" preserveAspectRatio="none" crossorigin="anonymous"></image>`).join('');
}
