// 路線線段、編號與 bolt 的 SVG（回傳字串，不碰 DOM，Node 也能跑）。
// 標記只要幾個點：曲線、編號牌、說明依畫面上的大小自動排——線畫成平滑的曲線，編號牌放在線上空的地方
// （縮小時重疊的先藏起來，選到的路線優先），放大、空間夠了才多顯示難度、名稱、bolt 的材質。
// 座標是照片像素；牌子的大小是螢幕像素乘上 k（一個螢幕像素等於幾個照片像素），所以不論照片放多大，牌子看起來一樣大。
// 兩條路線共用的線段（分岔的前段）只畫一次。移植自龍洞（MIT）src/core/topo/TopoView.tsx 的 TopoLines。
// English: renders routes/labels/bolts to an SVG string. Ported from Longdong (MIT) TopoLines.
import { centeredBox, distanceToLine, overlaps, pathLength, Placer, pointAlong, smoothPath, textWidth, wrapText } from './annotate.js';
import { drawnRuns, ownRuns, sameSpot } from './lines.js';
import { isSketch } from './viewport.js';

// 牌子的大小與字級（螢幕像素）
const PILL_H_BASE = 20, PILL_FONT_BASE = 11.5;
// 看的時候 bolt 是輔助資訊：小的半透明牌子，只有 ×（anchor ××）
const BOLT_VIEW_H_BASE = 12, BOLT_VIEW_FONT_BASE = 9, NOTE_FONT_BASE = 10, NOTE_LINE_BASE = 12.5;
// solo 時其他路線的編號牌縮成這個比例，放在線的下段
const SMALL_PILL = 0.8, SMALL_SPOTS = [0.14, 0.22, 0.08, 0.3];
// 路線多時的排法：牌子倍率 f、帶不帶難度（先縮小，再拿掉難度）。cover：原尺寸的編號牌合計佔畫面面積的比例超過它才用這一級
const DENSITY = [{ f: 1, grade: true, cover: 0 }, { f: 0.8, grade: true, cover: 0.1 }, { f: 0.8, grade: false, cover: 0.2 }];
// 線在畫面上比這個短（螢幕像素）的路線，編號最後才放；選到的路線不受限
const MIN_LABEL_LINE_PX = 40;
// 編輯時線上的點（把手）佔的範圍（半徑，螢幕像素）：牌子不蓋在上面
const EDIT_POINT_PX = 12;
// 示意線終點的向上箭頭：尖端在終點上面幾個圓點半徑
const ARROW_UP = 2.2;
const arrowUp = ([x, y], r) => `M${x} ${y - ARROW_UP * r}L${x + 1.8 * r} ${y + 0.6 * r}L${x - 1.8 * r} ${y + 0.6 * r}Z`;
// 看整張照片時，編號、bolt 離別條路線的線至少這麼遠（螢幕像素）才顯示難度名稱、bolt 種類
const NOTE_ROOM_PX = 90;
// 編號牌放在線上的候選位置（占全長的比例）：先放正中間，不行再往兩邊找
const LABEL_SPOTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
// 分岔出去的路線：編號放在自己那段線靠近分岔點的位置（占那段長度的比例），看得出是哪一支
const BRANCH_SPOTS = [0.2, 0.28, 0.12, 0.36, 0.45, 0.55, 0.65, 0.75];
// 兩條線的第一段相同（分岔的共用前段）
const sameSegment = (a, b) => sameSpot(a[0], b[0]) && sameSpot(a[1], b[1]);
// 說明文字太長時換行的寬度（螢幕像素）：先試一行，再試這些寬度
const WRAP_PX = [90, 60];

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const noteText = (note, fontPx, k, lineH) =>
  `<text class="topo-note" text-anchor="middle" font-size="${fontPx * k}" stroke-width="${2.5 * k}">${note.lines
    .map((t, i) => `<tspan x="${note.box.x + note.box.w / 2}" y="${note.box.y + (i + 0.5) * lineH * k}" dominant-baseline="central">${esc(t)}</tspan>`)
    .join('')}</text>`;

/**
 * routes：{ id, label?, kind: 'sport' | 'other', grade?, name?, line?, bolts?: { 位置: { at, note?, anchor? } }, stroke? }[]
 * opts：
 *  - photo { w, h }、crop { x, y, w, h }（顯示的範圍，沒有就是整張）、k（一個螢幕像素＝幾個照片像素）
 *  - highlight：亮色的路線；bolts：畫哪些路線的 bolt（路線 id 陣列、true 是全部，預設只畫 highlight）
 *  - editing：編輯中：樣子跟看的時候一樣，只有 highlight（正在編的）頭尾照原樣、牌子避開它的點；solo：路線卡片，highlight 標編號與說明，其他只標小的編號
 *  - interactive：路線的線可以點（role=button、可用 Enter）；ui：牌子與字的倍率（電腦版 1.5，預設 1）
 *  - gradePill：編號牌直接帶難度（「3 5.11a」），說明只剩名稱；說明排在 bolt 前面（看全景：編號難度＞名稱＞bolt）；預設開，false 關
 *  - boltCodes：bolt 牌子帶位置（「× B01」，有在管理 bolt 編號的岩場用）；names：false 不顯示路線名稱（預設顯示）
 *  - densityK：判斷路線擠不擠（編號牌要不要縮小、帶不帶難度）用的 k：看圖時傳整張照片放進畫面時的 k，縮放時精簡的程度不變；預設用 k
 *  - memo：Map，記每條路線的編號牌上次放在哪個候選位置；連續重畫（縮放）時傳同一個，位置還放得下就沿用，牌子不跑來跑去
 *  - reserved：不放牌子與說明的範圍（照片像素 { x, y, w, h }[]，例如分享卡片左下角的標誌）
 */
/**
 * 路線卡片的灰階遮罩：照片整張灰階（.tk-gray），選到的路線周圍疊回原色的照片——沿著線一條柔邊的帶子
 * （幾層寬窄不同的半透明線疊出來，不用模糊濾鏡，縮放、拖曳時不吃效能）。width：帶子最寬的寬度（照片像素）；id：mask 的 id（同一頁不重複）。
 * 移植自龍洞（MIT）的 RouteReveal。
 */
export function renderReveal(line, { photo, width, id }) {
  if (!line || line.length < 2) return '';
  const d = smoothPath(line);
  const bands = [1, 0.7, 0.45].map((f) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="${width * f}" stroke-linecap="round" stroke-linejoin="round"></path>`).join('');
  return `<g class="topo-reveal" aria-hidden="true"><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${photo.w}" height="${photo.h}">${bands}</mask><image href="${esc(photo.href)}" x="0" y="0" width="${photo.w}" height="${photo.h}" preserveAspectRatio="none" mask="url(#${id})"></image></g>`;
}

export function renderLines(routes, opts) {
  const { photo, k, highlight, editing, solo, interactive, ui: u = 1 } = opts;
  const c = opts.crop ?? { x: 0, y: 0, w: photo.w, h: photo.h };
  const boltIds = opts.bolts === true ? routes.map((r) => r.id) : Array.isArray(opts.bolts) ? opts.bolts : highlight ? [highlight] : [];
  const byId = new Map(routes.map((r) => [r.id, r]));
  const labels = new Map(routes.filter((r) => r.label != null).map((r) => [r.id, String(r.label)]));
  const gradePill = opts.gradePill !== false;
  // gradePill 的牌子分兩段：左邊路線色底的編號，右邊白色小膠囊裡的難度（沒有編號就只有難度那段）；寬度以畫面像素算
  const numW = (id, f) => (labels.get(id) ? textWidth(labels.get(id), PILL_FONT * f) + 12 * f : 3 * f);
  const gradePart = (id, f) => (gradePill && byId.get(id).grade ? textWidth(byId.get(id).grade, PILL_FONT * f) + 14 * f : 0);
  // 這塊牌子帶不帶難度：路線多到拿掉難度那一級只留編號（沒有編號的還是標難度；solo 的小牌子照舊）
  const withGrade = (id, f, small) => !!gradePart(id, f) && (small || dense.grade || !labels.get(id));
  // 數字、英文用字母基線置中（dominant-baseline: central 在中文字型會偏上）：基線在中線往下 0.36 個字高
  const midY = (box, size) => box.y + box.h / 2 + size * 0.36;
  // gradePill：沒有編號的路線也用難度當牌子
  const pillText = (id) => (gradePill ? [labels.get(id), byId.get(id).grade].filter((x) => x != null && x !== '').join(' ') : labels.get(id)) || undefined;
  const [PILL_H, PILL_FONT, NOTE_FONT, NOTE_LINE, ROOM] = [PILL_H_BASE, PILL_FONT_BASE, NOTE_FONT_BASE, NOTE_LINE_BASE, NOTE_ROOM_PX].map((v) => v * u);
  const [BOLT_H, BOLT_FONT] = [BOLT_VIEW_H_BASE, BOLT_VIEW_FONT_BASE].map((v) => v * u);
  // 亮色的畫在最上面
  const ids = routes.map((r) => r.id).sort((a, b) => Number(a === highlight) - Number(b === highlight));
  // 排版優先的路線：編輯與路線卡片是選到的那條；看整張照片時沒有（換路線不重排）
  const lead = editing || solo ? highlight : undefined;
  // 先放的優先：lead，其次依編號
  const priority = [...ids].sort((a, b) => Number(b === lead) - Number(a === lead) || Number(labels.get(a)) - Number(labels.get(b)) || a.localeCompare(b));
  const drawn = priority.filter((id) => byId.get(id).line).map((id) => [id, byId.get(id).line]);
  const runs = drawnRuns(drawn), own = ownRuns(drawn), drawnOf = new Map(drawn);
  // 這個位置旁邊夠寬，可以多顯示說明（路線卡片已經放大到這條路線，一律可以）
  const roomy = (at, id) => solo || drawn.every(([other, line]) => other === id || distanceToLine(at, line) >= ROOM * k);
  // 起點、終點圓點的半徑（畫面像素）
  const dotSize = (id) => (id === lead ? 4 : 3.2);
  const lineOf = (id) => byId.get(id).line;
  // 編號牌放的線：獨有線段中最長的一段；整條都和別的路線共用時用整條
  const labelLine = (id, line) => own.get(id).reduce((a, b) => (!a || pathLength(b) > pathLength(a) ? b : a), undefined) ?? line;

  // ── 自動排版：同一張 Topo 的所有牌子、說明一起排，互不重疊；依優先順序放，放不下的藏起來 ──
  const placer = new Placer({ x: c.x, y: c.y, w: c.w, h: c.h }, 3 * k, drawn.filter(([id]) => !solo || id === highlight).map(([, line]) => line));
  for (const r of opts.reserved ?? []) placer.reserve(r);
  if (editing && highlight) {
    const r = EDIT_POINT_PX * k;
    for (const [x, y] of byId.get(highlight)?.line ?? []) placer.reserve({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
  }
  const plan = new Map(priority.map((id) => [id, { bolts: [] }]));
  const mains = priority.filter((id) => !solo || id === highlight);
  // 路線多時：編號牌（原尺寸）合計佔整張照片（densityK 的大小）的比例超過門檻，就先縮小牌子，再多就拿掉難度只留編號。
  // 用整張照片的大小算、不看目前的縮放倍率：放大縮小時牌子的大小、帶不帶難度都不變，不會跑來跑去
  const fitK = opts.densityK ?? k;
  const cover = mains.filter((id) => pillText(id)).reduce((sum, id) => sum + (gradePart(id, 1) ? numW(id, 1) + gradePart(id, 1) : textWidth(pillText(id), PILL_FONT) + 14) * PILL_H, 0) / ((c.w / fitK) * (c.h / fitK));
  const dense = solo ? DENSITY[0] : DENSITY.findLast((d) => cover >= d.cover);
  const length = new Map(priority.map((id) => [id, (lineOf(id) ? pathLength(lineOf(id)) : 0) / k]));
  // 編號是主要的資訊，先放；bolt 是輔助的。編號先避開 bolt 的位置，真的沒地方才蓋在 bolt 上。
  const boltPills = routes
    .map((r) => r.id)
    .filter((id) => boltIds.includes(id))
    .sort((a, b) => priority.indexOf(a) - priority.indexOf(b))
    .flatMap((id) =>
      Object.entries(byId.get(id).bolts ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pos, b]) => {
          const anchor = b.anchor ?? pos.startsWith('A');
          // 管理 bolt 編號的岩場（boltCodes）標出是哪一顆，其他只標位置
          const label = anchor ? '××' : opts.boltCodes ? `× ${pos}` : '×';
          return { id, pos, at: b.at, anchor, label, note: b.note, box: centeredBox(b.at, (textWidth(label, BOLT_FONT) + 12) * k, BOLT_H * k) };
        }),
    );
  const onBolt = (b) => boltPills.some((p) => overlaps(b, p.box, 3 * k));
  // 難度、名稱的各種版本：一行、名稱換行、只留難度
  const noteVersions = (id) => {
    const i = byId.get(id);
    const name = opts.names === false ? undefined : i.name;
    if (!(i.grade || name)) return [];
    if (gradePill) return name ? [[name], ...WRAP_PX.map((wpx) => wrapText(name, NOTE_FONT, wpx))].filter((v, j, all) => all.findIndex((o) => o.join('|') === v.join('|')) === j) : [];
    return [[i.grade, name], ...WRAP_PX.map((wpx) => [i.grade, ...(name ? wrapText(name, NOTE_FONT, wpx) : [])]), [i.grade]]
      .map((v) => v.filter((x) => !!x))
      .filter((v, j, all) => v.length > 0 && all.findIndex((o) => o.join('|') === v.join('|')) === j);
  };
  // 說明貼著編號的位置：上面、下面（在自己的線上；gradePill 先下面），其次右邊、左邊
  const besidePill = (pill, lines) => {
    const g = 4 * k, nw = Math.max(...lines.map((t) => textWidth(t, NOTE_FONT))) * k, nh = lines.length * NOTE_LINE * k;
    const above = { x: pill.x + pill.w / 2 - nw / 2, y: pill.y - nh - g, w: nw, h: nh }, below = { x: pill.x + pill.w / 2 - nw / 2, y: pill.y + pill.h + g, w: nw, h: nh };
    return [
      ...(gradePill ? [below, above] : [above, below]),   // gradePill：名稱優先放在牌子下面
      { x: pill.x + pill.w + g, y: pill.y + pill.h / 2 - nh / 2, w: nw, h: nh },
      { x: pill.x - nw - g, y: pill.y + pill.h / 2 - nh / 2, w: nw, h: nh },
    ];
  };
  const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  // 示意的線（主要的路線不在照片裡）：編號緊貼在終點的箭頭正上方
  const sketch = new Set(ids.filter((id) => (byId.get(id).line?.length ?? 0) >= 2 && isSketch(c, byId.get(id))));
  // 線在畫面上很短的路線：其他編號都放好之後才放，放得下才標
  const short = (id) => id !== lead && !sketch.has(id) && !!lineOf(id) && lineOf(id).length >= 2 && length.get(id) < MIN_LABEL_LINE_PX;
  const memoKey = (id, small) => `${small ? 'small:' : ''}${id}`;
  // 1. 路線編號：沿著線找空位，優先不壓到別條線、不蓋住 bolt
  const placePill = (id, small) => {
    const text = pillText(id);
    if (!text) return;
    const f = small ? SMALL_PILL : dense.f, line = lineOf(id);
    const h = PILL_H * f * k, w = withGrade(id, f, small) ? (numW(id, f) + gradePart(id, f)) * k : (textWidth(labels.get(id) ?? text, PILL_FONT * f) + 14 * f) * k;
    let spots, bottom = [];
    if (line && sketch.has(id)) {
      const [ex, ey] = line[line.length - 1];
      spots = [centeredBox([ex, ey - ARROW_UP * dotSize(id) * k - 4 * k - h / 2], w, h)];
    } else if (line && line.length >= 2) {
      const on = labelLine(id, line);
      const along = (small ? SMALL_SPOTS : LABEL_SPOTS).map((s) => pointAlong(on, s));
      spots = along.map((p) => centeredBox(p, w, h));
      // gradePill（看全景）：編號照一般路線書的習慣放在路線最下面（起點的正下方），放不下才沿著線往上找。
      // 分岔出去的路線（第一段線和排在前面的路線共用）：起點下面留給主線，編號標在自己分岔出去那段線上、靠近分岔點
      const forked = gradePill && !small && line.length >= 2 && drawn.some(([other, o]) => other !== id && priority.indexOf(other) < priority.indexOf(id) && o.length >= 2 && sameSegment(o, line));
      if (forked) spots = BRANCH_SPOTS.map((s) => centeredBox(pointAlong(own.get(id)[0] ?? line, s), w, h));
      else if (gradePill && !small) {
        const [sx, sy] = line[0];
        // 起點相同（共用起攀、沒有共用線段）的路線：編號在起點下面一個接一個往下排
        const below = sy + h / 2 + dotSize(id) * k + 2 * k;
        bottom = [centeredBox([sx, below], w, h), centeredBox([sx, below + h + 4 * k], w, h), centeredBox([sx, below + 2 * (h + 4 * k)], w, h), centeredBox([sx, sy], w, h), ...[0.06, 0.12, 0.2].map((f) => centeredBox(pointAlong(line, f), w, h))];
      }
      // 很短的線：線上放不下時，放在線的終點上面或旁邊
      if (short(id)) {
        const [ex, ey] = line[line.length - 1];
        spots.push(centeredBox([ex, ey - h * 0.9], w, h), centeredBox([ex + w / 2 + h / 3, ey], w, h), centeredBox([ex - w / 2 - h / 3, ey], w, h));
      }
      // 選到的路線一定要標：線上都沒空位時放在線的旁邊
      if (id === lead) spots.push(...along.flatMap(([x, y]) => [centeredBox([x + w / 2 + h / 2, y], w, h), centeredBox([x - w / 2 - h / 2, y], w, h)]));
    } else {
      // 沒有線段：標在最下面的 bolt 旁邊
      const low = Object.values(byId.get(id).bolts ?? {}).map((b) => b.at).reduce((a, b) => (!a || b[1] > a[1] ? b : a), undefined);
      if (!low) return;
      spots = [centeredBox([low[0], low[1] + h], w, h), centeredBox([low[0], low[1] - h], w, h)];
    }
    const mine = drawnOf.get(id);
    // 完整的說明（難度＋名稱一行）也放得下的位置優先
    const full = small || sketch.has(id) ? undefined : noteVersions(id)[0];
    const clear = (b) => placer.fits(b) && !placer.onLine(b, mine) && !onBolt(b);
    // 上一次畫的時候放在哪個位置（memo，縮放時連續重畫）：那個位置還放得下就沿用，牌子不會跑來跑去
    const all = [...bottom, ...spots], keyOf = (b) => (bottom.includes(b) ? `b${bottom.indexOf(b)}` : `s${spots.indexOf(b)}`);
    const last = opts.memo && all.find((b) => keyOf(b) === opts.memo.get(memoKey(id, small)));
    const pill =
      (last && placer.fits(last) && !onBolt(last) ? last : undefined) ??
      // 最下面的位置：蓋到自己的線也可以（編號就是標在起點），只要不壓到別的牌子、bolt
      bottom.find((b) => placer.fits(b) && !onBolt(b)) ??
      (full && spots.find((b) => clear(b) && roomy(center(b), id) && besidePill(b, full).some(clear))) ??
      spots.find(clear) ??
      spots.find((b) => placer.fits(b) && !onBolt(b)) ??
      spots.find((b) => placer.fits(b)) ??
      // 路線卡片的主角一定要標：放不下也放在第一個位置
      (id === lead ? spots[0] : undefined);
    if (!pill) return;
    opts.memo?.set(memoKey(id, small), keyOf(pill));
    placer.reserve(pill);
    const entry = plan.get(id);
    entry.pill = pill;
    entry.small = small;
    entry.f = f;
    entry.grade = withGrade(id, f, small);
  };
  for (const id of mains) if (!short(id)) placePill(id, false);
  for (const id of mains) if (short(id)) placePill(id, false);
  // 2. bolt、anchor 的牌子（位置固定）；gradePill 時名稱比 bolt 優先，排完名稱才放
  const placeBolts = () => {
    for (const b of boltPills) {
      const pill = placer.place([b.box], editing);
      if (pill) plan.get(b.id).bolts.push({ pos: b.pos, at: b.at, anchor: b.anchor, label: b.label, pill, text: b.note });
    }
  };
  if (!gradePill) placeBolts();
  // 3. 難度、名稱：緊貼在編號旁邊；編號旁邊夠寬才顯示，先試完整的，放不下才少一點
  for (const id of mains) {
    const entry = plan.get(id), pill = entry.pill;
    if (!pill || !roomy(center(pill), id)) continue;
    const mine = drawnOf.get(id);
    found: for (const lines of noteVersions(id)) {
      for (const avoid of [true, false]) {
        const note = besidePill(pill, lines).find((n) => placer.fits(n) && (!avoid || !placer.onLine(n, mine)));
        if (note) {
          placer.reserve(note);
          entry.note = { box: note, lines };
          break found;
        }
      }
    }
  }
  if (gradePill) placeBolts();
  // 4. bolt 旁邊的種類（材質）：這顆 bolt 旁邊、或這條路線沿線有地方夠寬（離別條線夠遠，放大到看得清楚）才顯示，而且不壓到別條線
  const roomAlong = (id) => !!lineOf(id) && lineOf(id).length >= 2 && LABEL_SPOTS.some((s) => roomy(pointAlong(labelLine(id, lineOf(id)), s), id));
  for (const id of priority) {
    const entry = plan.get(id);
    for (const b of entry.bolts) {
      if (!b.text || (!solo && !roomy(b.at, id) && !roomAlong(id))) continue;
      const g = 4 * k, w = textWidth(b.text, NOTE_FONT) * k, h = NOTE_LINE * k;
      const y = b.at[1] - h / 2, cx = b.at[0] - w / 2;
      const box = [
        { x: b.pill.x + b.pill.w + g, y, w, h },
        { x: b.pill.x - w - g, y, w, h },
        { x: cx, y: b.pill.y + b.pill.h + g, w, h },
        { x: cx, y: b.pill.y - h - g, w, h },
      ].find((q) => placer.fits(q) && !placer.onLine(q, drawnOf.get(id)));
      if (box) {
        placer.reserve(box);
        b.note = { box, lines: [b.text] };
      }
    }
  }
  // 5. solo：其他路線的編號（小、淡），放得下才標，不帶說明
  if (solo && !editing) {
    const others = priority.filter((id) => id !== highlight);
    for (const id of others) if (!short(id)) placePill(id, true);
    for (const id of others) if (short(id)) placePill(id, true);
  }

  const clsOf = (id) => `topo-route kind-${byId.get(id).kind ?? 'other'}${id === highlight ? ' on' : highlight ? ' dim' : ''}`;
  const styleOf = (id) => (byId.get(id).stroke ? ` style="--topo-line:${esc(byId.get(id).stroke)};--topo-pill:${esc(byId.get(id).stroke)}"` : '');
  // 先畫所有路線的線，再畫所有的牌子：編號、bolt 不會被別條路線的線蓋住
  let out = '';
  // 線尾停在確保站的牌子前面：線的最後一點在牌子（外擴一點）裡面，就沿著最後一段往回縮到牌子外
  const inBox = ([x, y], b, m) => x >= b.x - m && x <= b.x + b.w + m && y >= b.y - m && y <= b.y + b.h + m;
  const stopBefore = (run, box) => {
    const m = 2 * k, last = run[run.length - 1], prev = run[run.length - 2];
    if (!prev || !inBox(last, box, m)) return run;
    let t = 1;
    for (let i = 1; i <= 24 && inBox([prev[0] + (last[0] - prev[0]) * t, prev[1] + (last[1] - prev[1]) * t], box, m); i++) t = 1 - i / 24;
    return [...run.slice(0, -1), [prev[0] + (last[0] - prev[0]) * t, prev[1] + (last[1] - prev[1]) * t]];
  };
  for (const id of ids) {
    const line = lineOf(id), start = line?.[0];
    // 終點（看的時候）：和起點一樣的實心圓點；編輯時每個點都有把手，不另外畫；
    // 畫了這條路線的 bolt、確保站時不畫：線自然停在確保站（的牌子前面）
    // （naturalEnds 才這樣：看路線的 TopoViewer 預設開；直接呼叫 renderLines 的排版照舊；線的頭尾不改，照資料畫）
    // 編輯中的那條頭尾照原樣：每個點都有把手
    const on = id === lead, dotR = dotSize(id) * k, raw = editing && on;
    const placed = opts.naturalEnds && !raw ? plan.get(id)?.bolts ?? [] : [], anchorBox = placed.filter((b) => b.anchor).map((b) => b.pill).find((b) => line && inBox(line[line.length - 1], b, b.h));
    const end = !raw && !placed.length && line && line.length >= 2 ? line[line.length - 1] : undefined;
    const lastPt = line?.[line.length - 1];
    const body =
      (runs.get(id) ?? [])
        .map((run) => (anchorBox && run[run.length - 1] === lastPt ? stopBefore(run, anchorBox) : run))
        .map((run) => {
          const d = smoothPath(run);
          return `<g><path class="topo-hit" d="${d}" stroke-width="${18 * k}"/><path class="topo-line" d="${d}" stroke-width="${(on ? 4 : 2.8) * k}"/></g>`;
        })
        .join('') +
      (start && !(editing && on) ? `<circle class="topo-dot" cx="${start[0]}" cy="${start[1]}" r="${dotR}"/>` : '') +
      (end && sketch.has(id) ? `<path class="topo-dot" d="${arrowUp(end, dotR)}"/>` : '') +
      (end && !sketch.has(id) ? `<circle class="topo-dot" cx="${end[0]}" cy="${end[1]}" r="${dotR}"/>` : '');
    const link = interactive ? ` link" role="button" tabindex="0" aria-label="${esc(labels.get(id) ?? byId.get(id).name ?? id)}` : '';
    out += `<g class="${clsOf(id)}${link}" data-route="${esc(id)}"${styleOf(id)}>${body}</g>`;
  }
  // 牌子裡的字：一般是置中的編號；gradePill 是左段編號、右段白色小膠囊裡的難度
  const badgeText = (id, p) => {
    const f = p.f, size = PILL_FONT * f * k, b = p.pill;
    if (!p.grade) return `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2}" font-size="${size}" dominant-baseline="central" text-anchor="middle">${esc(labels.get(id))}</text>`;
    const nw = numW(id, f) * k, inset = 2.5 * f * k, g = { x: b.x + nw, y: b.y + inset, w: b.w - nw - inset, h: b.h - 2 * inset };
    return (labels.get(id) ? `<text class="topo-num" x="${b.x + nw / 2 + 1 * k}" y="${midY(b, size)}" font-size="${size}" text-anchor="middle">${esc(labels.get(id))}</text>` : '') +
      `<rect class="topo-grade-bg" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${g.h / 2}"/>` +
      `<text class="topo-grade" x="${g.x + g.w / 2}" y="${midY(g, size)}" font-size="${size}" text-anchor="middle">${esc(byId.get(id).grade)}</text>`;
  };
  for (const id of ids) {
    const p = plan.get(id);
    if (!p.pill && !p.note && p.bolts.length === 0) continue;
    out += `<g class="${clsOf(id)}${interactive ? ' link' : ''}" data-route="${esc(id)}"${styleOf(id)}>`;
    for (const b of p.bolts) {
      out +=
        `<g class="topo-bolt${b.anchor ? ' anchor' : ''}"><rect x="${b.pill.x}" y="${b.pill.y}" width="${b.pill.w}" height="${b.pill.h}" rx="${b.pill.h / 2}"/>` +
        `<text x="${b.pill.x + b.pill.w / 2}" y="${b.pill.y + b.pill.h / 2}" font-size="${BOLT_FONT * k}" dominant-baseline="central" text-anchor="middle">${esc(b.label)}</text>` +
        (b.note ? noteText(b.note, NOTE_FONT, k, NOTE_LINE) : '') +
        '</g>';
    }
    if (p.pill && pillText(id)) {
      out +=
        `<g class="topo-badge${p.small ? ' small' : ''}"><rect x="${p.pill.x}" y="${p.pill.y}" width="${p.pill.w}" height="${p.pill.h}" rx="${p.pill.h / 2}" stroke-width="${1.5 * k}"/>` +
        badgeText(id, p) + '</g>';
    }
    if (p.note) out += noteText(p.note, NOTE_FONT, k, NOTE_LINE);
    out += '</g>';
  }
  return out;
}
