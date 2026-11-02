// mapkit Editor：在地圖上改一個節點的形狀（區域的多邊形、分區的岩壁線……），輸出圖層（kind: layer，on 是地圖畫面）。
// 選一塊（點它）→ 拖曳頂點移動、按邊上的中點加一個頂點、右鍵（或 removeVertex()）刪除頂點（多邊形至少三點、線兩點）；
// draw() 開始畫新的一塊：點地圖加點，finish() 完成、cancel() 放棄；flip() 把線反過來（岩壁面朝向右手邊）；復原、重做。
// 不做任何上傳；資料提交、歷史版本由 App 負責（change 事件的 detail.layer）。
// 移植自龍洞（MIT）src/map/ScaleMap.tsx 的 EditHandles、src/map/aspect.ts 的 faceTrail 與編輯頁的操作。
// English: map shape editor (polygons and lines of one node), wall facing, undo/redo; emits a v2 layer.
import { MapViewer, LINE_HIT_PX } from './view.js';
import { segmentDistance } from './labels.js';
import { toMap, toScreen } from './viewport.js';

/** 點在多邊形裡（射線法） */
function inRing([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 點到線段上最近的位置 */
export function nearestOnSegment(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * 岩壁的朝向由畫線方向決定：沿著點的順序前進，岩壁在左手邊、岩壁面朝右手邊（攀岩者站的那一側）。
 * 新畫的線預設朝向最近的步道：每一段看最近的步道在左邊還是右邊（依長度加權），多數在左邊就把線反過來。
 * line、trails 都是平面座標（y 向南）。
 */
export function faceTrail(line, trails) {
  const segments = trails.flatMap((t) => t.slice(1).map((b, i) => [t[i], b]));
  if (segments.length === 0) return line;
  let score = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const near = segments.map(([p, q]) => nearestOnSegment(mid, p, q)).reduce((best, q) => (Math.hypot(q[0] - mid[0], q[1] - mid[1]) < Math.hypot(best[0] - mid[0], best[1] - mid[1]) ? q : best));
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    score += Math.sign(-dy * (near[0] - mid[0]) + dx * (near[1] - mid[1])) * Math.hypot(dx, dy);
  }
  return score < 0 ? [...line].reverse() : line;
}

/** 岩壁每一段岩壁面的朝向（方位角，正北為 0、順時針）與長度（公尺）；line 是平面座標 */
export function wallFaces(line) {
  return line.slice(1).flatMap((b, i) => {
    const [dx, dy] = [b[0] - line[i][0], b[1] - line[i][1]];
    const length = Math.hypot(dx, dy);
    return length > 0 ? [{ bearing: (((Math.atan2(dx, -dy) * 180) / Math.PI + 360 + 90) % 360), length }] : [];
  });
}

const RANDOM = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** 新的檔案 id：16 碼小寫英數 */
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => RANDOM[b % 36]).join('');

const copy = (rings) => rings.map((r) => r.map((p) => [...p]));
const round6 = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];

export class MapEditor extends MapViewer {
  /**
   * options 同 MapViewer，另外：layer（要接著改的圖層：id、license、attribution 沿用）、license、attribution（新圖層用）。
   * 一次改一個節點：edit({ node, closed?, faces? })。輸出的圖層只放改過的節點的標註（每個節點一個）。
   */
  constructor(host, options = {}) {
    super(host, options);
    this.target = undefined;
    this.shapes = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.drawing = undefined;
    this.listen(this.svg, 'pointerdown', (e) => this.#handleDown(e), { capture: true });
    this.listen(this.svg, 'contextmenu', (e) => this.#handleMenu(e), { capture: true });
    this.listen(this.host.ownerDocument, 'keydown', (e) => this.#key(e));
  }

  setData(data) {
    super.setData(data);
    for (const m of data.layers?.find((l) => l.id === this.options.layer?.id)?.marks ?? []) if (m.node) this.shapes.set(m.node, this.#ringsOf(m.geometry));
  }

  #ringsOf(g) {
    if (g.type === 'Polygon') return [g.coordinates[0].slice(0, -1)];
    if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0].slice(0, -1));
    if (g.type === 'LineString') return [g.coordinates];
    if (g.type === 'MultiLineString') return g.coordinates;
    return [];
  }

  /**
   * 開始改 node 的形狀（經緯度）：沒有改過就從地圖上現在的形狀開始。closed：多邊形（預設看節點的標註），faces：標出岩壁面朝向（預設分區）。
   */
  edit({ node, closed, faces }) {
    const m = this.model;
    const mark = [...(this.data.view.marks ?? []), ...(this.data.layers ?? []).flatMap((l) => l.marks ?? [])].filter((k) => k.node === node).at(-1);
    const type = m.nodes.get(node)?.type;
    this.target = {
      node,
      closed: closed ?? (mark ? /Polygon/.test(mark.geometry.type) : type === 'area'),
      faces: faces ?? type === 'sector',
    };
    if (!this.shapes.has(node)) this.shapes.set(node, mark ? this.#ringsOf(mark.geometry) : []);
    this.selected = this.shapes.get(node).length ? 0 : undefined;
    this.drawing = undefined;
    this.#sync();
  }

  /** 目前這個節點的形狀（經緯度，多邊形不重複第一點） */
  get rings() {
    return this.target ? this.shapes.get(this.target.node) : [];
  }

  select(i) {
    this.selected = i;
    this.#sync();
    this.dispatchEvent(new CustomEvent('select', { detail: { index: i } }));
  }

  /** 開始畫新的一塊：之後點地圖加點 */
  draw() {
    if (!this.target) throw new Error('mapkit：先用 edit() 選要改的節點');
    this.drawing = [];
    this.#sync();
  }

  /** 完成畫的這塊（線至少兩點、多邊形三點，不夠就丟錯）；岩壁預設朝向最近的步道 */
  finish() {
    const pts = this.drawing ?? [];
    const min = this.target.closed ? 3 : 2;
    if (pts.length < min) throw new Error(`mapkit：至少要 ${min} 點`);
    const { proj, lines } = this.model;
    const ring = this.target.faces ? faceTrail(pts.map(proj.project), lines.trail).map(proj.unproject).map(round6) : pts;
    this.#change((rings) => [...rings, ring]);
    this.drawing = undefined;
    this.selected = this.rings.length - 1;
    this.#sync();
  }

  cancel() {
    this.drawing = undefined;
    this.#sync();
  }

  /** 把一塊反過來（岩壁面換到另一側） */
  flip(i = this.selected) {
    if (i === undefined) return;
    this.#change((rings) => rings.map((r, k) => (k === i ? [...r].reverse() : r)));
  }

  /** 刪掉一塊 */
  removeRing(i = this.selected) {
    if (i === undefined) return;
    this.#change((rings) => rings.filter((_, k) => k !== i));
    this.selected = this.rings.length ? Math.min(i, this.rings.length - 1) : undefined;
    this.#sync();
  }

  /** 刪掉選中那塊的第 v 個頂點（多邊形至少留三點、線兩點） */
  removeVertex(v, i = this.selected) {
    const ring = this.rings[i];
    if (!ring || ring.length <= (this.target.closed ? 3 : 2)) return false;
    this.#change((rings) => rings.map((r, k) => (k === i ? r.filter((_, j) => j !== v) : r)));
    return true;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  undo() {
    const last = this.undoStack.pop();
    if (!last) return;
    this.redoStack.push({ node: last.node, rings: copy(this.shapes.get(last.node)) });
    this.shapes.set(last.node, last.rings);
    this.#after();
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ node: next.node, rings: copy(this.shapes.get(next.node)) });
    this.shapes.set(next.node, next.rings);
    this.#after();
  }

  /** 輸出的圖層：改過的節點各一個標註（多邊形 MultiPolygon、線 MultiLineString，經緯度小數六位） */
  get layer() {
    const base = this.options.layer ?? {};
    const marks = [...this.shapes].flatMap(([node, rings]) => {
      if (!rings.length) return [];
      const closed = node === this.target?.node ? this.target.closed : this.closedOf?.get(node);
      const geometry = closed
        ? { type: 'MultiPolygon', coordinates: rings.map((r) => [[...r, r[0]].map(round6)]) }
        : { type: 'MultiLineString', coordinates: rings.map((r) => r.map(round6)) };
      return [{ node, geometry }];
    });
    this.layerId ??= base.id ?? newId();
    return {
      climbio: 2,
      kind: 'layer',
      id: this.layerId,
      on: this.data.view.id,
      t: Date.now(),
      license: base.license ?? this.options.license ?? 'CC-BY-SA-4.0',
      ...(base.attribution ?? this.options.attribution ? { attribution: base.attribution ?? this.options.attribution } : {}),
      marks,
    };
  }

  /** 一次修改：記一個復原點 */
  #change(fn) {
    const node = this.target.node;
    this.undoStack.push({ node, rings: copy(this.rings) });
    this.redoStack = [];
    this.shapes.set(node, fn(this.rings));
    (this.closedOf ??= new Map()).set(node, this.target.closed);
    this.#after();
  }

  #after() {
    if (this.selected !== undefined && this.selected >= this.rings.length) this.selected = this.rings.length ? this.rings.length - 1 : undefined;
    this.#sync();
    this.dispatchEvent(new CustomEvent('history', { detail: { canUndo: this.canUndo, canRedo: this.canRedo } }));
    this.dispatchEvent(new CustomEvent('change', { detail: { layer: this.layer, node: this.target?.node } }));
  }

  /** 把編輯狀態交給畫面（編輯中的形狀、正在畫的線） */
  #sync() {
    this.editing = this.target ? { rings: this.rings, closed: this.target.closed, selected: this.drawing ? undefined : this.selected, faces: this.target.faces } : undefined;
    this.options.draft = this.drawing ? { points: this.drawing, closed: this.target.closed } : undefined;
    this.render();
  }

  /** 點一下：畫的時候加點；不然選點到的那塊（多邊形：點在裡面；線：LINE_HIT_PX 內最近的） */
  onTap(p) {
    if (!this.target) return super.onTap(p);
    const at = this.toLngLat([p.x, p.y]);
    if (this.drawing) {
      this.drawing = [...this.drawing, at.map((v) => Math.round(v * 1e6) / 1e6)];
      this.#sync();
      return;
    }
    const v = this.view, f = this.frame, proj = this.model.proj;
    const hit = this.target.closed
      ? this.rings.findIndex((r) => inRing(proj.project(at), r.map(proj.project)))
      : (this.rings
          .map((r, i) => {
            const pts = r.map((q) => toScreen(v, f, proj.project(q)));
            return { i, d: Math.min(...pts.slice(1).map((b, j) => segmentDistance([p.x, p.y], pts[j], b))) };
          })
          .filter((x) => x.d <= LINE_HIT_PX)
          .sort((a, b) => a.d - b.d)[0]?.i ?? -1);
    if (hit >= 0) this.select(hit);
  }

  /** 頂點：拖曳移動；中點：加一個頂點接著拖曳（真的移動才記復原點） */
  #handleDown(e) {
    const el = e.target.closest?.('.mk-handle');
    if (!el || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const i = this.selected;
    let index = Number(el.dataset.vertex ?? Number(el.dataset.mid) + 1);
    const before = copy(this.rings);
    if (el.dataset.mid !== undefined) {
      const ring = this.rings[i];
      const a = ring[index - 1], b = ring[index % ring.length];
      this.shapes.set(this.target.node, this.rings.map((r, k) => (k === i ? [...r.slice(0, index), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ...r.slice(index)] : r)));
    }
    this.dragging = index;
    let moved = el.dataset.mid !== undefined;
    this.svg.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const r = this.box.getBoundingClientRect();
      const at = this.model.proj.unproject(toMap(this.view, this.frame, [ev.clientX - r.left, ev.clientY - r.top])).map((v) => Math.round(v * 1e6) / 1e6);
      moved = true;
      this.shapes.set(this.target.node, this.rings.map((ring, k) => (k === i ? ring.map((q, j) => (j === index ? at : q)) : ring)));
      this.#sync();
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      this.svg.removeEventListener('pointermove', move);
      this.svg.removeEventListener('pointerup', up);
      this.svg.removeEventListener('pointercancel', up);
      this.dragging = undefined;
      if (moved) {
        this.undoStack.push({ node: this.target.node, rings: before });
        this.redoStack = [];
        (this.closedOf ??= new Map()).set(this.target.node, this.target.closed);
        this.#after();
      } else this.#sync();
    };
    this.listen(this.svg, 'pointermove', move);
    this.listen(this.svg, 'pointerup', up);
    this.listen(this.svg, 'pointercancel', up);
    this.#sync();
  }

  #handleMenu(e) {
    const el = e.target.closest?.('.mk-handle');
    if (!el || el.dataset.vertex === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    this.removeVertex(Number(el.dataset.vertex));
  }

  #key(e) {
    if (this.destroyed || !this.target || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    } else if (e.key === 'Enter' && this.drawing) this.finish();
    else if (e.key === 'Escape' && this.drawing) this.cancel();
  }
}
