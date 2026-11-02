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

/** 手指按得到的範圍（半徑，螢幕像素）：比看得到的點大，不必按得很準 */
const HIT_R = 22;
/** 手指點在點旁邊這個距離內（螢幕像素）：選取那個點，不加新的點 */
const NEAR_R = 36;
/** 點在線段中間時插進那一段的距離（照片高度的比例） */
const INSERT_NEAR = 0.015;
const HISTORY_MAX = 200;
/** 點一下加了點之後，這段時間（毫秒）內點兩下回到整張，收回那個點 */
const UNDO_TAP_MS = 500;

const TOOLS = ['select', 'line', 'bolt'];
const KEYS = { v: 'select', l: 'line', b: 'bolt' };

export class TopoEditor extends TopoViewer {
  /** options 同 TopoViewer，另外：editLayer（編輯哪個圖層，預設 0）、tool（'select'、'line'、'bolt'）、keys（鍵盤快捷鍵，預設 true） */
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
    this.listen(this.stage, 'pointerdown', (e) => this.#grab(e), { capture: true });
    this.listen(this.stage, 'pointermove', (e) => this.#drag(e));
    this.listen(this.stage, 'pointerup', () => this.#drop());
    this.listen(this.stage, 'pointercancel', () => this.#drop());
    this.listen(this.stage, 'lostpointercapture', () => this.#drop());
    this.listen(this.stage, 'contextmenu', (e) => this.#contextmenu(e));
    if (this.options.keys !== false) {
      const doc = this.host.ownerDocument;
      this.listen(doc, 'keydown', (e) => this.#keydown(e));
      this.listen(doc, 'keyup', (e) => e.key === ' ' && (this.space = false));
      this.listen(doc.defaultView, 'blur', () => (this.space = false));
    }
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
    return { layer: structuredClone(this.layers[this.editIndex]), stubs: structuredClone([...this.stubs.entries()]), selected: this.selected };
  }

  #restore(s) {
    this.layers[this.editIndex] = structuredClone(s.layer);
    this.stubs = new Map(structuredClone(s.stubs));
    this.picked = undefined;
    this.options.highlight = s.selected;
    this.model = this.read();
    this.schedule();
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
    const routes = change(this.model.routes.map((r) => ({ ...r })));
    this.#apply(routes);
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
  setTool(tool) {
    if (!TOOLS.includes(tool)) throw new Error(`不認得的工具：${tool}`);
    this.tool = tool;
    this.forking = false;
    this.stage.classList.remove(...TOOLS);
    this.stage.classList.add(tool);
    this.dispatchEvent(new CustomEvent('tool', { detail: { tool } }));
    this.schedule();
  }

  /** 選一條路線（換路線時取消分岔、選取的點、bolt 位置） */
  select(id) {
    this.options.highlight = id;
    this.boltPos = undefined;
    this.forking = false;
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

  /** 選 bolt 要放的位置（例如 B03、A01）；放了就回到自動（下一個空的 B 位置） */
  setBoltPos(pos) {
    this.boltPos = pos;
    this.schedule();
  }

  get nextBoltPos() {
    const r = this.routes.find((x) => x.id === this.selected);
    if (this.boltPos) return this.boltPos;
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
      this.#commit((routes) => routes.map((r) => (r.id === this.selected ? { ...r, bolts: { ...r.bolts, [pos]: { ...r.bolts?.[pos], at: p, anchor: pos.startsWith('A') } } } : r)), 'bolt');
      this.boltPos = undefined;
    }
    this.lastAdd = performance.now();
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

  /** 清掉選取路線的線段與 bolt（路線留著，回到還沒有標記的新路線） */
  clearRoute() {
    const id = this.selected;
    this.picked = undefined;
    this.#commit((routes) => routes.map((r) => (r.id === id ? { ...r, line: undefined, bolts: undefined } : r)), 'clear');
  }

  /** 開始分岔（再呼叫一次取消）：點別條路線的一個點，把選取的路線設成到那個點為止的前段 */
  fork(on = !this.forking) {
    this.forking = on && this.canFork;
    this.schedule();
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

  // ── 指標 ──
  ownsPointer(e) {
    return !!e.target.closest?.('[data-handle], [data-fork]');
  }

  canPan(e) {
    return (e.pointerType === 'touch' && this.state.scale > 1) || this.space || (e.buttons & 4) !== 0;
  }

  /** 手指點兩下回到整張；第一下若才加了點，收回來 */
  doubleTapped() {
    if (performance.now() - (this.lastAdd ?? -Infinity) < UNDO_TAP_MS && this.canUndo) this.undo();
    this.lastAdd = undefined;
    this.setView(IDENTITY);
  }

  #grab(e) {
    this.grabbed = false;
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
    this.dispatchEvent(new CustomEvent('selectpoint', { detail: { picked: this.picked } }));
    this.schedule();
  }

  /** 拖曳點或 bolt：真的移動了才記一次復原點；分岔出來的路線與原路線共用的點一起移動 */
  #drag(e) {
    const d = this.dragging;
    if (!d) return;
    const to = this.pointAt(e);
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
    const d = this.dragging;
    this.dragging = undefined;
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
    if (this.grabbed) {
      this.grabbed = false;
      return;
    }
    const t = e.target;
    const fork = t.closest?.('[data-fork]')?.dataset.fork;
    if (fork) {
      const [id, index] = [fork.slice(0, fork.lastIndexOf(':')), Number(fork.slice(fork.lastIndexOf(':') + 1))];
      const from = this.routes.find((r) => r.id === id).line;
      this.forking = false;
      this.#commit((routes) => routes.map((r) => (r.id === this.selected ? { ...r, line: forkLine(from, index) } : r)), 'fork');
      return;
    }
    if (t.closest?.('[data-handle]')) return;
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
    // 手指點在點旁邊：選取那個點，不加新的點
    if (e.pointerType === 'touch' && this.tool === 'line') {
      const near = this.#nearPoint(e);
      if (near >= 0) {
        this.picked = { kind: 'line', index: near };
        this.dispatchEvent(new CustomEvent('selectpoint', { detail: { picked: this.picked } }));
        this.schedule();
        return;
      }
    }
    this.picked = undefined;
    this.placeAt(this.pointAt(e));
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

  #keydown(e) {
    const doc = this.host.ownerDocument;
    if (!(this.hover || this.host.contains(doc.activeElement) || this.host.getRootNode().host?.contains?.(doc.activeElement))) return;
    if (e.target.closest?.('input, textarea, select') || e.target.isContentEditable) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === 'z') this.undo();
    else if (key === 'y') this.redo();
    else if (key === 'delete' || key === 'backspace') this.deletePicked();
    else if (key === 'escape') {
      this.forking = false;
      this.picked = undefined;
      this.schedule();
    } else if (key === 'f') this.fork();
    else if (key === ' ' && this.hover) {
      e.preventDefault();
      this.space = true;
    } else if (KEYS[key]) this.setTool(KEYS[key]);
  }

  cleanup() {
    this.dragging = undefined;
    this.undoStack = [];
    this.redoStack = [];
  }
}

