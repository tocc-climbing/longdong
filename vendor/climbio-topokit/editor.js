// TopoKit Editor：在 Viewer 上畫線、加 bolt、移動與刪除節點（線上的點、bolt），分岔，復原／重做，修改事件，手指編輯。
// 編輯的對象是一個圖層（options.editLayer，預設第一個；沒有圖層時建一個空的）：輸出也是圖層（toLayer()）。
// 資料提交、歷史版本不在這裡，由使用的 App 在收到 change 事件後自己存。不連任何後端。
// 只有標註在編輯圖層裡的路線能改（route.layer 等於 editLayer）；畫面或別的圖層的路線只能看、能選，改的時候丟錯。
// 事件：change（detail: { layer, reason }）、history（{ canUndo, canRedo }）、select（{ id }）、selectpoint（{ picked }）、tool（{ tool }）、pick（點到路線）
// English: editor on top of the viewer: draw lines, place bolts, move/delete nodes, fork, undo/redo, change events, touch editing.
import { TopoViewer } from './view.js';
import { newId, writeLayer } from './data.js';
import { addLinePoint, forkLine, moveSharedPoint, removeLinePoint } from './lines.js';
import { IDENTITY } from './viewport.js';
import { smoothPath } from './annotate.js';
import { esc } from './render.js';
import { DRAG_PX } from './view.js';

/** 手指按得到的範圍（半徑，螢幕像素）：比看得到的點大，不必按得很準 */
const HIT_R = 22;
/** 手指點在點旁邊這個距離內（螢幕像素）：選取那個點，不加新的點 */
const NEAR_R = 36;
/** 點在線段中間時插進那一段的距離（照片高度的比例） */
const INSERT_NEAR = 0.015;
const HISTORY_MAX = 200;
/** 點一下加了點之後，這段時間（毫秒）內點兩下回到整張，收回那個點 */
const UNDO_TAP_MS = 500;
/** 滑鼠在照片上按住不動超過這個時間（毫秒），接著拖曳就是平移 */
const LONG_PRESS_MS = 350;
/** 手指按住不動超過這個時間（毫秒）出現放大鏡瞄準，放開才放點 */
const AIM_MS = 250;
/** 放大鏡的大小（螢幕像素）、倍率（比照片目前在畫面上放大幾倍）、下緣離手指的距離 */
const LOUPE_PX = 128;
const LOUPE_ZOOM = 2.5;
const LOUPE_GAP = 36;

const TOOLS = ['select', 'line', 'bolt', 'crop'];
const KEYS = { v: 'select', l: 'line', b: 'bolt', c: 'crop' };
/** 裁切框的八個把手：四個角與四個邊（-1 左／上、0 不動、1 右／下） */
const CROP_HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
/** 裁切框最小的寬、高（照片寬、高的比例） */
const MIN_CROP = 0.05;
/** 裁切框把手的大小（螢幕像素；手指大一點） */
const CROP_HANDLE_PX = 12, CROP_HANDLE_TOUCH_PX = 22;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sameRect = (a, b) => (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

export class TopoEditor extends TopoViewer {
  /**
   * options 同 TopoViewer，另外：
   *  - editLayer：編輯哪個圖層（預設 0）；tool：'select'、'line'、'bolt'、'crop'（裁切：顯示整張照片與裁切框，結果在 cropRect、crop 事件）
   *  - keys：鍵盤快捷鍵，true（預設）、false，或 { window, modifiers, backspace }：
   *    window 整個視窗都收（預設只在游標停在照片上或焦點在照片裡）；modifiers：Ctrl／⌘＋Z、Y 復原重做（預設 true）；backspace：Backspace 也刪除（預設 true）
   *  - positions(routeId)：這條路線可以放的 bolt 位置（例如路線資料的 B01…、A01…）；有給時只放這些，放完自動換下一個空位，沒有空位就不放
   *  - aim：手指按住不動一下出現放大鏡，滑動對準，放開才放點（點一下照樣直接放）；拖曳點時也顯示放大鏡（手機版）
   *  - text.hand：「移動」按鈕的說明（縮放按鈕旁邊；開啟後左鍵拖曳就是平移）
   *  - transform(routes, before, id)：每次修改寫進圖層前改寫路線（例如共用的 bolt 讓另一條路線跟著動）；before 是修改前、id 是改的路線。拖曳的每一步都套用，仍然只記一個復原點
   */
  constructor(host, options = {}) {
    super(host, { wheel: 'always', ...options });
    this.tool = TOOLS.includes(options.tool) ? options.tool : 'line';
    this.boltPos = undefined;
    this.forking = false;
    this.picked = undefined;
    this.layers = [];
    this.editIndex = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.stubs = new Map();
    this.dragging = undefined;
    this.space = false;
    this.stage.classList.add(this.tool);
    this.hand = false;
    const zoom = this.host.querySelector('.tk-zoom');
    if (zoom) {
      const label = esc(this.options.text?.hand ?? '✋');
      zoom.insertAdjacentHTML('afterbegin', `<button type="button" data-zoom="hand" aria-pressed="false" aria-label="${label}" title="${label}">✋</button>`);
    }
    this.loupe = this.host.ownerDocument.createElement('div');
    this.loupe.className = 'tk-loupe';
    this.loupe.hidden = true;
    this.loupe.setAttribute('aria-hidden', 'true');
    this.host.append(this.loupe);
    this.listen(this.stage, 'pointerdown', (e) => this.#aimStart(e), { capture: true });
    this.listen(this.stage, 'pointermove', (e) => this.#aimMove(e));
    this.listen(this.stage, 'pointerup', (e) => this.#aimEnd(e, true));
    this.listen(this.stage, 'pointercancel', (e) => this.#aimEnd(e, false));
    this.listen(this.stage, 'pointerdown', (e) => this.#grab(e), { capture: true });
    this.listen(this.stage, 'pointermove', (e) => this.#drag(e));
    this.listen(this.stage, 'pointerup', () => this.#drop());
    this.listen(this.stage, 'pointercancel', () => this.#drop());
    this.listen(this.stage, 'lostpointercapture', () => this.#drop());
    this.listen(this.stage, 'contextmenu', (e) => this.#contextmenu(e));
    // 一律監聽，options.keys 在按鍵時才讀（可以隨時改）
    const doc = this.host.ownerDocument;
    this.listen(doc, 'keydown', (e) => this.#keydown(e));
    this.listen(doc, 'keyup', (e) => e.key === ' ' && (this.space = false));
    this.listen(doc.defaultView, 'blur', () => (this.space = false));
  }

  // ── 資料 ──
  setData(data) {
    const layers = structuredClone(data.layers ?? []);
    if (!layers.length) {
      const v = data.view;
      layers.push({ climbio: 2, kind: 'layer', id: newId(), on: v.id, t: Date.now(), license: v.license, ...(v.attribution ? { attribution: v.attribution } : {}), ...(v.author ? { author: v.author } : {}) });
    }
    const index = this.options.editLayer ?? 0;
    if (!layers[index]) throw new Error(`沒有第 ${index} 個圖層可以編輯`);
    this.layers = layers;
    this.editIndex = index;
    this.undoStack = [];
    this.redoStack = [];
    this.stubs = new Map();
    this.picked = undefined;
    this.cropRect = this.options.crop ?? data.view.props?.crop;
    super.setData({ ...data, layers });
    this.#historyEvent();
  }

  /** 加上還沒有任何標記的新路線（第一次畫線或放 bolt 才寫進圖層） */
  read() {
    const model = super.read();
    for (const s of this.stubs.values()) {
      const m = model.routes.find((r) => r.id === s.id);
      if (!m) model.routes.push({ ...s });
      else if (s.line && !m.line) m.line = s.line;
    }
    return model;
  }

  /** 編輯後的圖層（一份複本）；App 收到 change 事件後存它 */
  toLayer() {
    return structuredClone(this.layers[this.editIndex]);
  }

  get selected() {
    return this.options.highlight;
  }

  /** 顯示範圍：裁切時是整張照片（看得到裁切框外面），其他時候是裁切的結果 */
  get crop() {
    const { photo } = this.model;
    if (this.tool === 'crop' || !this.cropRect) return { x: 0, y: 0, w: photo.w, h: photo.h };
    return this.cropRect;
  }

  get editable() {
    const r = this.routes.find((x) => x.id === this.selected);
    return !!r && r.layer === this.editIndex;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  linesOptions() {
    return { ...super.linesOptions(), editing: true, solo: false, interactive: this.tool === 'select' && !this.forking };
  }

  // ── 編輯的核心：所有修改都走 commit，一次記一個復原點、發一個 change ──
  #snapshot() {
    return { layer: structuredClone(this.layers[this.editIndex]), stubs: structuredClone([...this.stubs.entries()]), selected: this.selected, crop: this.cropRect && { ...this.cropRect } };
  }

  #restore(s) {
    this.layers[this.editIndex] = structuredClone(s.layer);
    this.stubs = new Map(structuredClone(s.stubs));
    this.picked = undefined;
    this.options.highlight = s.selected;
    const cropChanged = !sameRect(this.cropRect, s.crop);
    this.cropRect = s.crop && { ...s.crop };
    this.model = this.read();
    this.schedule();
    if (cropChanged) this.#cropEvent();
  }

  #cropEvent() {
    this.dispatchEvent(new CustomEvent('crop', { detail: { crop: this.cropRect && { ...this.cropRect } } }));
  }

  #record() {
    this.undoStack.push(this.#snapshot());
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
  }

  #historyEvent() {
    this.dispatchEvent(new CustomEvent('history', { detail: { canUndo: this.canUndo, canRedo: this.canRedo } }));
  }

  /** 範圍內路線的修改：change(routes) → 新的路線陣列。record 為 false 時不記復原點（拖曳中，起點已經記過） */
  #commit(change, reason, { record = true, silent = false } = {}) {
    if (!this.editable) throw new Error('這條路線的標註不在編輯的圖層裡，不能修改');
    if (record) this.#record();
    const before = this.model.routes.map((r) => ({ ...r }));
    const changed = change(before.map((r) => ({ ...r })));
    this.#apply(this.options.transform ? this.options.transform(changed, before, this.selected) : changed);
    if (silent) return;
    this.#historyEvent();
    this.dispatchEvent(new CustomEvent('change', { detail: { layer: this.toLayer(), reason } }));
  }

  #apply(routes) {
    const idx = this.editIndex, outside = new Set();
    const v = this.data.view;
    for (const n of [...(this.data.nodes ?? []), ...(v.nodes ?? []), ...this.layers.flatMap((l, i) => (i === idx ? [] : l.nodes ?? []))]) if (n.type === 'route') outside.add(n.id);
    this.layers[idx] = writeLayer(this.layers[idx], routes, idx, outside);
    // 圖層裡留不住的狀態（還沒有任何標記的新路線、只有一個點的線）記在 stubs：選得到、畫得下去，有兩個點的線或 bolt 才寫進圖層
    for (const r of routes) {
      if (r.layer !== idx) continue;
      const saved = r.line?.length >= 2 || Object.keys(r.bolts ?? {}).length > 0;
      if (saved && r.line?.length !== 1) this.stubs.delete(r.id);
      else this.stubs.set(r.id, { id: r.id, kind: r.kind, layer: idx, ...(r.label != null ? { label: r.label } : {}), ...(r.name != null ? { name: r.name } : {}), ...(r.line?.length === 1 ? { line: r.line } : {}) });
    }
    this.model = this.read();
    this.schedule();
  }

  // ── 公開的操作 ──
  /** 裁切範圍換成 rect（照片像素；undefined 是整張）：記一個復原點、發 crop 事件 */
  setCrop(rect) {
    if (sameRect(rect, this.cropRect)) return;
    this.#record();
    this.cropRect = rect && { ...rect };
    this.schedule();
    this.#historyEvent();
    this.#cropEvent();
  }

  /** 「移動」：開啟後左鍵拖曳就是平移（不加點） */
  setHand(on) {
    this.hand = on;
    this.stage.classList.toggle('hand', on);
    this.host.querySelector('[data-zoom="hand"]')?.setAttribute('aria-pressed', String(on));
  }

  setTool(tool) {
    if (!TOOLS.includes(tool)) throw new Error(`不認得的工具：${tool}`);
    if (tool === 'crop' && this.tool !== 'crop') this.toolBeforeCrop = this.tool;
    // 進出裁切換了顯示範圍（整張 ↔ 裁切後）：回到沒放大
    if ((tool === 'crop') !== (this.tool === 'crop')) this.state = { ...IDENTITY };
    this.tool = tool;
    this.#setForking(false);
    this.stage.classList.remove(...TOOLS);
    this.stage.classList.add(tool);
    this.dispatchEvent(new CustomEvent('tool', { detail: { tool } }));
    this.schedule();
  }

  /** 選一條路線（換路線時取消分岔、選取的點、bolt 位置） */
  select(id) {
    this.options.highlight = id;
    this.boltPos = undefined;
    this.#setForking(false);
    this.picked = undefined;
    this.schedule();
    this.dispatchEvent(new CustomEvent('select', { detail: { id } }));
  }

  /** 新增一條路線並選起來：{ id?, label?, name?, kind?: 'sport' | 'other' }；回傳 id。第一次畫線或放 bolt 才寫進圖層 */
  addRoute({ id = newId(), label, name, kind = 'other' } = {}) {
    if (this.routes.some((r) => r.id === id)) throw new Error(`路線 ${id} 已經存在`);
    this.stubs.set(id, { id, kind, layer: this.editIndex, ...(label != null ? { label: String(label) } : {}), ...(name != null ? { name } : {}) });
    this.model = this.read();
    this.select(id);
    return id;
  }

  /** 選 bolt 要放的位置（例如 B03、A01）；放了就回到自動（下一個空位） */
  setBoltPos(pos) {
    this.boltPos = pos;
    this.schedule();
  }

  /** 下一個要放的 bolt 位置：選了的優先；有 positions 時是第一個還沒放的（都放了是 undefined），沒有時是下一個空的 B 位置 */
  get nextBoltPos() {
    const r = this.routes.find((x) => x.id === this.selected);
    if (this.boltPos) return this.boltPos;
    if (this.options.positions) return r ? this.options.positions(r.id).find((pos) => !r.bolts?.[pos]) : undefined;
    for (let i = 1; ; i++) {
      const pos = `B${String(i).padStart(2, '0')}`;
      if (!r?.bolts?.[pos]) return pos;
    }
  }

  /** 在照片上的這一點（照片像素）加線上的點，或放 bolt，看目前的工具 */
  placeAt(p) {
    if (!this.selected) throw new Error('先選一條路線');
    if (this.tool === 'line') {
      this.#commit((routes) => addLinePoint(routes, this.selected, p, INSERT_NEAR * this.model.photo.h), 'line');
    } else if (this.tool === 'bolt') {
      const pos = this.nextBoltPos;
      if (!pos) return;
      this.#commit((routes) => routes.map((r) => (r.id === this.selected ? { ...r, bolts: { ...r.bolts, [pos]: { ...r.bolts?.[pos], at: p, anchor: pos.startsWith('A') } } } : r)), 'bolt');
      this.boltPos = undefined;
    }
    this.lastAdd = performance.now();
  }

  /** 選取線上的點或 bolt（{ kind: 'line', index } 或 { kind: 'bolt', pos }；undefined 取消），發 selectpoint */
  pickPoint(p) {
    this.picked = p;
    this.schedule();
    this.dispatchEvent(new CustomEvent('selectpoint', { detail: { picked: p } }));
  }

  /** 刪掉選取的點或 bolt */
  deletePicked() {
    const t = this.picked;
    if (!t) return;
    this.picked = undefined;
    if (t.kind === 'line') this.#commit((routes) => removeLinePoint(routes, this.selected, t.index), 'delete');
    else
      this.#commit((routes) => routes.map((r) => {
        if (r.id !== this.selected) return r;
        const bolts = { ...r.bolts };
        delete bolts[t.pos];
        return { ...r, bolts };
      }), 'delete');
    this.dispatchEvent(new CustomEvent('selectpoint', { detail: { picked: undefined } }));
  }

  /**
   * 整個編輯圖層換成 layer（例如從舊版本繼續）：記一個復原點、發 change（reason 'replace'），復原紀錄保留。
   * 只有一個點的線、還沒有標記的新路線照舊留著。
   */
  setLayer(layer) {
    if (layer.kind !== 'layer' || layer.on !== this.data.view.id) throw new Error(`圖層 ${layer.id} 不是疊在這個畫面（${this.data.view.id}）上`);
    this.#record();
    this.layers[this.editIndex] = structuredClone(layer);
    this.picked = undefined;
    this.model = this.read();
    this.schedule();
    this.#changed('replace');
  }

  /** 把選取路線的線段整條換成 points（照片像素，第一點是起攀點）；一次復原 */
  setLine(points) {
    if (!this.selected) throw new Error('先選一條路線');
    if (points.length < 2) throw new Error('線段至少要兩個點');
    const id = this.selected;
    this.picked = undefined;
    this.#commit((routes) => routes.map((r) => (r.id === id ? { ...r, line: points.map((p) => [p[0], p[1]]) } : r)), 'line');
  }

  /** 清掉選取路線的線段與 bolt（路線留著，回到還沒有標記的新路線） */
  clearRoute() {
    const id = this.selected;
    this.picked = undefined;
    this.#commit((routes) => routes.map((r) => (r.id === id ? { ...r, line: undefined, bolts: undefined } : r)), 'clear');
  }

  /** 開始分岔（再呼叫一次取消）：點別條路線的一個點，把選取的路線設成到那個點為止的前段 */
  fork(on = !this.forking) {
    this.#setForking(on && this.canFork);
  }

  #setForking(on) {
    if (this.forking === on) return;
    this.forking = on;
    this.schedule();
    this.dispatchEvent(new CustomEvent('fork', { detail: { on } }));
  }

  /** 清掉復原紀錄（例如 App 提交了一個版本） */
  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.#historyEvent();
  }

  /** 可以分岔：選取的路線還沒畫線、而且別條路線有線 */
  get canFork() {
    const r = this.routes.find((x) => x.id === this.selected);
    return this.editable && !r?.line?.length && this.routes.some((x) => x.id !== this.selected && x.line?.length);
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.#snapshot());
    this.#restore(s);
    this.#changed('undo');
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.#snapshot());
    this.#restore(s);
    this.#changed('redo');
  }

  #changed(reason) {
    this.#historyEvent();
    this.dispatchEvent(new CustomEvent('change', { detail: { layer: this.toLayer(), reason } }));
  }

  // ── 畫出把手 ──
  extras(k) {
    if (this.tool === 'crop') return this.#cropBox(k);
    const r = this.routes.find((x) => x.id === this.selected);
    if (!r) return '';
    const coarse = !!this.host.ownerDocument.defaultView.matchMedia?.('(pointer: coarse)').matches;
    const p = this.picked;
    let out = `<g class="topo-handles kind-${r.kind}">`;
    (r.line ?? []).forEach(([x, y], i) => {
      const on = p?.kind === 'line' && p.index === i;
      out += `<circle class="${on ? 'picked' : ''}" data-handle="line:${i}" cx="${x}" cy="${y}" r="${(on ? 6 : 4) * k}" stroke-width="${2 * k}"${coarse ? ' pointer-events="none"' : ''}/>`;
    });
    for (const [pos, b] of Object.entries(r.bolts ?? {})) {
      const on = p?.kind === 'bolt' && p.pos === pos, h = (coarse ? 22 : 14) * k;
      out += `<rect class="bolt${on ? ' picked' : ''}" data-handle="bolt:${pos}" x="${b.at[0] - 32 * k}" y="${b.at[1] - h}" width="${64 * k}" height="${2 * h}" rx="${h}" stroke-width="${2 * k}"/>`;
    }
    out += '</g>';
    if (coarse) out += `<g class="topo-hits">${(r.line ?? []).map(([x, y], i) => `<circle data-handle="line:${i}" cx="${x}" cy="${y}" r="${HIT_R * k}"/>`).join('')}</g>`;
    if (this.forking) {
      out += '<g class="topo-fork">';
      for (const o of this.routes) if (o.id !== r.id) (o.line ?? []).forEach(([x, y], i) => (out += `<circle data-fork="${o.id}:${i}" cx="${x}" cy="${y}" r="${7 * k}" stroke-width="${2 * k}"/>`));
      out += '</g>';
    }
    return out;
  }

  /** 裁切框：框外變暗；拖曳框內移動，拖曳邊或角調整大小（把手畫在框內，框貼著照片邊緣時才點得到）。移植自龍洞（MIT）的 CropBox */
  #cropBox(k) {
    const { photo } = this.model, c = this.cropRect ?? { x: 0, y: 0, w: photo.w, h: photo.h };
    const coarse = !!this.host.ownerDocument.defaultView.matchMedia?.('(pointer: coarse)').matches;
    const size = (coarse ? CROP_HANDLE_TOUCH_PX : CROP_HANDLE_PX) * k;
    const cursor = (dx, dy) => (dx && dy ? (dx === dy ? 'nwse-resize' : 'nesw-resize') : dx ? 'ew-resize' : 'ns-resize');
    return `<g class="topo-crop"><path class="topo-crop-dim" fill-rule="evenodd" d="M0 0H${photo.w}V${photo.h}H0Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z"></path>` +
      `<rect class="topo-crop-box" data-crop="move" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" stroke-width="${2 * k}"></rect>` +
      CROP_HANDLES.map(([dx, dy]) => `<rect class="topo-crop-handle" data-crop="${dx},${dy}" style="cursor:${cursor(dx, dy)}" x="${c.x + ((dx + 1) * (c.w - size)) / 2}" y="${c.y + ((dy + 1) * (c.h - size)) / 2}" width="${size}" height="${size}" stroke-width="${2 * k}"></rect>`).join('') +
      '</g>';
  }

  #cropDrag(at) {
    const d = this.cropping, { photo } = this.model, s = d.start;
    const [mw, mh] = [MIN_CROP * photo.w, MIN_CROP * photo.h];
    let next;
    if (!d.axis) next = { ...s, x: clamp(s.x + at[0] - d.from[0], 0, photo.w - s.w), y: clamp(s.y + at[1] - d.from[1], 0, photo.h - s.h) };
    else {
      let { x, y, w, h } = s;
      const [dx, dy] = d.axis;
      if (dx === -1) [x, w] = [clamp(at[0], 0, s.x + s.w - mw), s.x + s.w - clamp(at[0], 0, s.x + s.w - mw)];
      else if (dx === 1) w = clamp(at[0], s.x + mw, photo.w) - s.x;
      if (dy === -1) [y, h] = [clamp(at[1], 0, s.y + s.h - mh), s.y + s.h - clamp(at[1], 0, s.y + s.h - mh)];
      else if (dy === 1) h = clamp(at[1], s.y + mh, photo.h) - s.y;
      next = { x, y, w, h };
    }
    // 整張照片就是沒有裁切
    this.cropRect = next.x === 0 && next.y === 0 && next.w === photo.w && next.h === photo.h ? undefined : next;
    this.schedule();
  }

  // ── 指標 ──
  ownsPointer(e) {
    return !!e.target.closest?.('[data-handle], [data-fork], [data-crop]');
  }

  /** 平移：手指在放大後（或有上下留白）的空白處拖曳（瞄準時不算）；空白鍵、中鍵、「移動」開著；滑鼠按住不動一下再拖曳 */
  canPan(e) {
    if (e.pointerType === 'touch') return this.movable && !this.aim?.on;
    return this.space || (e.buttons & 4) !== 0 || this.hand || (this.pressAt !== undefined && e.timeStamp - this.pressAt >= LONG_PRESS_MS);
  }

  tapsWith(e) {
    return e.pointerType === 'touch';
  }

  /** 手指點兩下回到整張；第一下若才加了點，收回來 */
  doubleTapped() {
    if (performance.now() - (this.lastAdd ?? -Infinity) < UNDO_TAP_MS && this.canUndo) this.undo();
    this.lastAdd = undefined;
    this.setView(IDENTITY);
  }

  #grab(e) {
    this.grabbed = false;
    this.pressAt = e.pointerType !== 'touch' && e.button === 0 ? e.timeStamp : undefined;
    const crop = e.target.closest?.('[data-crop]')?.dataset.crop;
    if (crop && e.button === 0) {
      e.stopPropagation();
      const { photo } = this.model;
      this.cropping = { axis: crop === 'move' ? undefined : crop.split(',').map(Number), from: this.pointAt(e), start: this.cropRect ?? { x: 0, y: 0, w: photo.w, h: photo.h }, moved: false };
      this.stage.setPointerCapture?.(e.pointerId);
      this.grabbed = true;
      this.pressAt = undefined;
      return;
    }
    const h = e.target.closest?.('[data-handle]')?.dataset.handle;
    if (!h || e.button !== 0 || !this.editable) return;
    e.stopPropagation();
    const [kind, key] = h.split(':');
    const r = this.routes.find((x) => x.id === this.selected);
    this.picked = kind === 'line' ? { kind, index: Number(key) } : { kind, pos: key };
    this.dragging = { ...this.picked, at: kind === 'line' ? r.line[Number(key)] : r.bolts[key].at, moved: false };
    this.stage.setPointerCapture?.(e.pointerId);
    // 按下就重畫（選到的點變大）：放開時原來的元素已經換掉，點擊會落在別處，所以這一輪的點擊不當作加點
    this.grabbed = true;
    this.pressAt = undefined;
    if (this.options.aim && e.pointerType === 'touch') this.#showLoupe(e);
    this.dispatchEvent(new CustomEvent('selectpoint', { detail: { picked: this.picked } }));
    this.schedule();
  }

  /** 拖曳點或 bolt：真的移動了才記一次復原點；分岔出來的路線與原路線共用的點一起移動 */
  #drag(e) {
    if (this.cropping) {
      const at = this.pointAt(e);
      if (!this.cropping.moved) {
        if (at[0] === this.cropping.from[0] && at[1] === this.cropping.from[1]) return;
        this.cropping.moved = true;
        this.dragged = true;
        this.#record();
      }
      this.#cropDrag(at);
      return;
    }
    const d = this.dragging;
    if (!d) return;
    const to = this.pointAt(e);
    if (!this.loupe.hidden) this.#showLoupe(e);
    if (to[0] === d.at[0] && to[1] === d.at[1]) return;
    if (!d.moved) {
      d.moved = true;
      this.dragged = true;
      this.#record();
    }
    if (d.kind === 'line') this.#commit((routes) => moveSharedPoint(routes, d.at, to), 'move', { record: false, silent: true });
    else this.#commit((routes) => routes.map((r) => (r.id === this.selected ? { ...r, bolts: { ...r.bolts, [d.pos]: { ...r.bolts[d.pos], at: to } } } : r)), 'move', { record: false, silent: true });
    d.at = to;
  }

  #drop() {
    const c = this.cropping;
    this.cropping = undefined;
    if (c?.moved) {
      this.#historyEvent();
      this.#cropEvent();
    }
    const d = this.dragging;
    this.dragging = undefined;
    this.pressAt = undefined;
    if (d) this.#hideLoupe();
    if (d?.moved) this.#changed('move');
  }

  #contextmenu(e) {
    e.preventDefault();
    const h = e.target.closest?.('[data-handle]')?.dataset.handle;
    if (!h || !this.editable) return;
    const [kind, key] = h.split(':');
    this.picked = kind === 'line' ? { kind, index: Number(key) } : { kind, pos: key };
    this.deletePicked();
  }

  clicked(e) {
    if (this.grabbed || this.aimed) {
      this.grabbed = false;
      this.aimed = false;
      return;
    }
    const t = e.target;
    const fork = t.closest?.('[data-fork]')?.dataset.fork;
    if (fork) {
      const [id, index] = [fork.slice(0, fork.lastIndexOf(':')), Number(fork.slice(fork.lastIndexOf(':') + 1))];
      const from = this.routes.find((r) => r.id === id).line;
      this.#setForking(false);
      this.#commit((routes) => routes.map((r) => (r.id === this.selected ? { ...r, line: forkLine(from, index) } : r)), 'fork');
      return;
    }
    if (t.closest?.('[data-handle]') || this.tool === 'crop') return;
    // 手指點在選取路線的點旁邊：選取那個點，不加新的點、不換路線
    if (e.pointerType === 'touch' && (this.tool === 'line' || this.tool === 'select') && !this.forking && this.editable) {
      const near = this.#nearPoint(e);
      if (near >= 0) {
        this.picked = { kind: 'line', index: near };
        this.dispatchEvent(new CustomEvent('selectpoint', { detail: { picked: this.picked } }));
        this.schedule();
        return;
      }
    }
    if (this.tool === 'select') {
      const id = t.closest?.('[data-route]')?.dataset.route;
      if (id) {
        this.select(id);
        this.pick(id);
      } else if (this.picked) {
        this.picked = undefined;
        this.schedule();
      }
      return;
    }
    if (this.forking || !this.selected || !this.editable) return;
    this.picked = undefined;
    this.placeAt(this.pointAt(e));
  }

  // ── 手機：按住瞄準、放大鏡 ──
  #aimable() {
    return !!this.options.aim && !this.forking && this.editable && (this.tool === 'line' || (this.tool === 'bolt' && !!this.nextBoltPos));
  }

  #aimStart(e) {
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) {
      this.fingers = new Set();
      this.aimed = false;
    }
    (this.fingers ??= new Set()).add(e.pointerId);
    this.#stopAim();
    // 第二根手指（捏合）、按在點或把手上（拖曳它們）、縮放按鈕：不瞄準
    if (this.fingers.size > 1 || !this.#aimable() || e.target.closest?.('[data-handle], [data-fork], .tk-zoom')) return;
    const win = this.host.ownerDocument.defaultView, at = { clientX: e.clientX, clientY: e.clientY }, id = e.pointerId;
    const aim = { id, x: e.clientX, y: e.clientY, on: false };
    aim.timer = win.setTimeout(() => {
      if (this.aim !== aim) return;
      aim.on = true;
      this.#showLoupe(at);
    }, AIM_MS);
    this.aim = aim;
  }

  #aimMove(e) {
    const a = this.aim;
    if (!a || a.id !== e.pointerId) return;
    if (a.on) this.#showLoupe(e);
    else if (Math.hypot(e.clientX - a.x, e.clientY - a.y) > DRAG_PX) this.#stopAim();
  }

  #aimEnd(e, placed) {
    this.fingers?.delete(e.pointerId);
    const a = this.aim;
    if (!a || a.id !== e.pointerId) return;
    if (placed && a.on) {
      this.placeAt(this.pointAt(e));
      // 放開後瀏覽器送來的那次點擊不再加一個點
      this.aimed = true;
    }
    this.#stopAim();
  }

  #stopAim() {
    if (this.aim) this.host.ownerDocument.defaultView.clearTimeout(this.aim.timer);
    this.aim = undefined;
    if (!this.dragging) this.#hideLoupe();
  }

  /** 放大鏡顯示在手指正上方（上面放不下時放在旁邊）；十字中心就是點會放的位置，也畫出這條路線目前的線與點 */
  #showLoupe(e) {
    const host = this.host.getBoundingClientRect(), box = this.svg.getBoundingClientRect(), c = this.crop, { photo } = this.model;
    const fx = e.clientX - host.left, fy = e.clientY - host.top;
    const clampX = (x) => Math.max(4, Math.min(host.width - LOUPE_PX - 4, x));
    const above = fy - LOUPE_GAP - LOUPE_PX;
    const [x, y] = above >= 4 ? [clampX(fx - LOUPE_PX / 2), above] : [clampX(fx < host.width / 2 ? fx + LOUPE_GAP : fx - LOUPE_GAP - LOUPE_PX), Math.max(4, fy - LOUPE_PX / 2)];
    const [cx, cy] = this.pointAt(e), span = (LOUPE_PX * c.w) / box.width / LOUPE_ZOOM, k = span / LOUPE_PX;
    const r = this.routes.find((o) => o.id === this.selected), pts = r?.line ?? [];
    this.loupe.className = `tk-loupe kind-${r?.kind ?? 'other'}`;
    Object.assign(this.loupe.style, { left: `${x}px`, top: `${y}px` });
    this.loupe.innerHTML =
      `<svg viewBox="${cx - span / 2} ${cy - span / 2} ${span} ${span}" width="${LOUPE_PX}" height="${LOUPE_PX}">` +
      `<image href="${esc(photo.href)}" x="0" y="0" width="${photo.w}" height="${photo.h}" preserveAspectRatio="none"></image>` +
      (pts.length >= 2 ? `<path class="tk-loupe-line" d="${smoothPath(pts)}" stroke-width="${2 * k}"></path>` : '') +
      pts.map(([px, py]) => `<circle class="tk-loupe-point" cx="${px}" cy="${py}" r="${4 * k}"></circle>`).join('') +
      `<path class="tk-loupe-cross" d="M${cx - 14 * k} ${cy}h${10 * k}M${cx + 4 * k} ${cy}h${10 * k}M${cx} ${cy - 14 * k}v${10 * k}M${cx} ${cy + 4 * k}v${10 * k}" stroke-width="${1.5 * k}"></path></svg>`;
    this.loupe.hidden = false;
  }

  #hideLoupe() {
    this.loupe.hidden = true;
    this.loupe.replaceChildren();
  }

  #nearPoint(e) {
    const r = this.routes.find((x) => x.id === this.selected), box = this.svg.getBoundingClientRect(), c = this.crop;
    let best = -1, bestDistance = NEAR_R;
    (r?.line ?? []).forEach(([x, y], i) => {
      const d = Math.hypot(box.left + ((x - c.x) / c.w) * box.width - e.clientX, box.top + ((y - c.y) / c.h) * box.height - e.clientY);
      if (d <= bestDistance) [best, bestDistance] = [i, d];
    });
    return best;
  }

  /** 鍵盤設定：每次按鍵時讀 options.keys（setOptions 可以隨時改，例如預覽舊版本時關掉） */
  get keyOptions() {
    const keys = this.options.keys;
    return keys === false ? undefined : { window: false, modifiers: true, backspace: true, ...(typeof keys === 'object' ? keys : {}) };
  }

  #keydown(e) {
    const doc = this.host.ownerDocument, k = this.keyOptions;
    if (!k) return;
    if (!(k.window || this.hover || this.host.contains(doc.activeElement) || this.host.getRootNode().host?.contains?.(doc.activeElement))) return;
    if (e.target.closest?.('input, textarea, select') || e.target.isContentEditable) return;
    const key = e.key.toLowerCase();
    if (k.modifiers && (e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === 'z') this.undo();
    else if (key === 'y') this.redo();
    else if (key === 'delete' || (key === 'backspace' && k.backspace)) this.deletePicked();
    else if (key === 'escape') {
      this.#setForking(false);
      if (this.picked) {
        this.picked = undefined;
        this.dispatchEvent(new CustomEvent('selectpoint', { detail: { picked: undefined } }));
      }
      this.schedule();
    } else if (key === 'enter' && this.tool === 'crop') this.setTool(this.toolBeforeCrop ?? 'line');
    else if (key === 'f') this.fork();
    else if (key === ' ' && this.hover) {
      e.preventDefault();
      this.space = true;
    } else if (KEYS[key]) this.setTool(KEYS[key]);
  }

  cleanup() {
    this.#stopAim();
    this.dragging = undefined;
    this.cropping = undefined;
    this.undoStack = [];
    this.redoStack = [];
  }
}

