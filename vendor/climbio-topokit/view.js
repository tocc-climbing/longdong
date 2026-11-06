// TopoKit Viewer：照片＋疊在上面的原生 SVG。看圖、縮放（滾輪、雙指、點兩下、按鈕）、平移，點路線發 pick 事件。
// 不做任何上傳、不連後端；資料由呼叫的 App 給（Climbio v2 的照片畫面＋圖層，座標是照片像素）。
// 所有事件監聽都掛在同一個 AbortController 上，ResizeObserver、計時器也在 destroy() 一起收掉。
// English: native SVG topo viewer. Zoom/pan/pick; no network; destroy() releases every listener and observer.
import { readTopo, assertView } from './data.js';
import { esc, naturalEnds, renderLines, renderReveal } from './render.js';
import { clampView, doubleTapView, fitSize, focusView, IDENTITY, isDoubleTap, moveView, MAX_SCALE, swipeStep } from './viewport.js';
import { injectStyle } from './style.js';

/** 滑鼠、手指移動超過這個距離（螢幕像素）才算拖曳，之前都當作點擊 */
export const DRAG_PX = 5;
/** 一次按 ＋／－ 或鍵盤 +／- 的縮放倍率 */
const STEP = 1.5;
/** 灰階遮罩的帶子寬度預設：顯示範圍寬度的這個比例 */
const REVEAL_WIDTH = 0.14;
/** bolts: 'zoom' 時放大幾倍以上才畫全部路線的 bolt */
const BOLT_ZOOM = 1.8;
/** 自動縮放（zoomToRect）的動畫時間（毫秒） */
const GLIDE_MS = 350;
/** 畫面停止移動多久（毫秒）後拿掉 GPU 層、照目前倍率重畫（要比 GLIDE_MS 長） */
const MOVING_MS = GLIDE_MS + 100;
let maskSeq = 0;

export class TopoViewer extends EventTarget {
  /**
   * host：放 Topo 的元素（要有高度）。options：
   *  - highlight：亮色的路線 id；bolts：true（全部）或路線 id 陣列，預設只畫 highlight 的；solo：路線卡片
   *  - editing：編輯中（樣子跟看的時候一樣，只有正在編的 highlight 頭尾照原樣、牌子避開它的點）；TopoEditor 一律開
   *  - lang、gradeSystems：名稱與難度顯示用哪個語言、哪些難度系統（見 readTopo）
   *  - ui：牌子與字的倍率，預設寬螢幕（≥900px）1.5、其他 1
   *  - fit：'contain'（預設完整放入）、'cover'（等比鋪滿）或 'width'（對齊寬度）
   *  - crop：顯示的範圍（照片像素 { x, y, w, h }），預設用畫面的 props.crop，沒有就整張
   *  - interactive：路線可以點（預設 true）；wheel：'ctrl'（預設，按著 Ctrl／⌘ 才縮放，頁面照常捲動）或 'always'
   *  - controls：顯示縮放按鈕（預設 true）；zoom：可以縮放、平移（預設 true；false 時滾輪、雙指、點兩下、按鍵都不縮放）
   *  - reveal：照片灰階，highlight 路線周圍是原色（路線卡片）；revealWidth：原色帶子的寬度（顯示範圍寬度的比例，預設 0.14）
   *  - 舞台上下浮著按鈕時，host 的 CSS scroll-padding-top／bottom 設成按鈕佔的高度：照片的上下緣可以拖到按鈕外面（沒放大也可以）
   *  - swipe：左右滑（照片沒有跟著橫移時）發 swipe 事件，detail.step 是 1（下一條）或 -1（上一條）；'page' 時只有一條路線也發（換前後一張照片）
   *  - bolts：true 是全部路線的 bolt；'zoom' 是放大到 BOLT_ZOOM 倍以上才畫全部（沒放大只畫 highlight 的）
   *  - gradePill：編號牌直接帶難度（renderLines 的 gradePill；預設開，false 關）
   *  - boltCodes：bolt 牌子帶位置（「× B01」，有在管理 bolt 編號的岩場用）；names：false 不顯示路線名稱（預設顯示）
   *  - naturalEnds：線頭線尾自然一點（預設開，false 關）：頭尾不突然橫彎、有確保站就結束在確保站、畫了 bolt 時線尾不畫圓點並停在確保站的牌子前
   *  - text：縮放按鈕的說明 { zoomIn, zoomOut, zoomFit }（aria-label、title），預設是按鈕上的符號
   */
  constructor(host, options = {}) {
    super();
    this.host = host;
    this.options = { interactive: true, controls: true, zoom: true, wheel: 'ctrl', ...options };
    this.maskId = `tk-reveal-${++maskSeq}`;
    this.data = undefined;
    this.model = undefined;
    this.state = { ...IDENTITY };
    this.stageSize = { w: 0, h: 0 };
    this.inset = { top: 0, bottom: 0 };
    this.ac = new AbortController();
    this.pointers = new Map();
    this.destroyed = false;
    this.#mount();
  }

  /** 所有監聽都經過這裡，destroy() 時一次解除 */
  listen(target, type, fn, opts = {}) {
    target.addEventListener(type, fn, { ...opts, signal: this.ac.signal });
  }

  #mount() {
    const host = this.host;
    host.classList.add('tk');
    injectStyle(host);
    // 舞台是 absolute 鋪滿 host：host 沒有定位就讓它成為定位的基準
    if (host.ownerDocument.defaultView.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.innerHTML =
      '<div class="tk-stage"><div class="tk-inner"><div class="topo-frame"><img alt="" draggable="false"><svg></svg></div></div>' +
      (this.options.controls ? `<div class="tk-zoom">${this.#zoomButton('out', '−', 'zoomOut')}${this.#zoomButton('fit', '100%', 'zoomFit')}${this.#zoomButton('in', '+', 'zoomIn')}</div>` : '') +
      '</div>';
    this.stage = host.querySelector('.tk-stage');
    this.inner = host.querySelector('.tk-inner');
    this.frame = host.querySelector('.topo-frame');
    this.img = host.querySelector('img');
    this.svg = host.querySelector('svg');
    this.fitButton = host.querySelector('[data-zoom="fit"]');
    this.hover = false;

    const ro = new ResizeObserver(() => this.#measure());
    ro.observe(this.stage);
    this.ro = ro;
    this.#measure();
    this.listen(this.img, 'load', () => this.#loaded());
    this.listen(this.img, 'error', () => this.#loaded());
    this.listen(this.stage, 'pointerenter', () => (this.hover = true));
    this.listen(this.stage, 'pointerleave', () => (this.hover = false));
    this.listen(this.stage, 'pointerdown', (e) => this.#down(e), { capture: true });
    this.listen(this.stage, 'pointermove', (e) => this.#move(e));
    this.listen(this.stage, 'pointerup', (e) => this.#up(e));
    this.listen(this.stage, 'pointercancel', (e) => this.#up(e));
    // 要能 preventDefault（不讓頁面捲動），所以不用被動監聽
    this.listen(this.stage, 'wheel', (e) => this.#wheel(e), { passive: false });
    // 拖曳、縮放之後放開，不要當作點了一下（選到路線、多出一個點）：旗標留到下一次按下才清
    this.listen(this.stage, 'click', (e) => this.#click(e), { capture: true });
    this.listen(this.stage, 'keydown', (e) => this.#key(e));
    this.listen(this.host.ownerDocument, 'keydown', (e) => this.#hotkey(e));
    if (this.options.controls) {
      this.listen(this.host.querySelector('.tk-zoom'), 'click', (e) => {
        const z = e.target.closest('[data-zoom]')?.dataset.zoom;
        if (z === 'in') this.zoomBy(STEP);
        else if (z === 'out') this.zoomBy(1 / STEP);
        else if (z === 'fit') this.setView(IDENTITY);
        else if (z === 'hand') this.setHand?.(!this.hand);
      });
    }
    // 寬螢幕牌子放大：視窗寬度跨過 900px 時重畫
    const mq = this.host.ownerDocument.defaultView?.matchMedia?.('(min-width: 900px)');
    if (mq && this.options.ui == null) this.listen(mq, 'change', () => this.render());
    this.mq = mq;
  }

  #zoomButton(zoom, sign, key) {
    const label = esc(this.options.text?.[key] ?? sign);
    return `<button type="button" data-zoom="${zoom}" aria-label="${label}" title="${label}">${sign}</button>`;
  }

  /** 換資料：{ view, layers, nodes }（見 readTopo）。不是 v2 照片畫面就丟錯 */
  setData(data) {
    assertView(data.view);
    this.data = data;
    this.model = this.read();
    this.ready = false;
    delete this.host.dataset.ready;
    if (this.img.getAttribute('src') !== this.model.photo.href) this.img.setAttribute('src', this.model.photo.href);
    else queueMicrotask(() => this.#loaded());
    this.state = { ...IDENTITY };
    this.afterData();
    this.render();
  }

  /** 改選項（highlight、bolts、solo、crop、ui、lang…）後重畫；換 lang 會重新讀資料 */
  setOptions(next) {
    const lang = this.options.lang;
    Object.assign(this.options, next);
    if (this.data && (next.lang !== undefined && next.lang !== lang || next.gradeSystems)) this.model = this.read();
    this.render();
  }

  /** 亮色的路線（選到的路線） */
  select(id) {
    this.setOptions({ highlight: id });
  }

  get routes() {
    return this.model?.routes ?? [];
  }

  /** 從目前的資料讀出路線模型（編輯器覆蓋，加上還沒有標記的新路線） */
  read() {
    return readTopo(this.data, { lang: this.options.lang, gradeSystems: this.options.gradeSystems });
  }

  afterData() {}

  #loaded() {
    if (this.ready || !this.model) return;
    this.ready = true;
    this.frame.classList.add('ready');
    this.host.dataset.ready = '1';
    this.dispatchEvent(new CustomEvent('ready'));
  }

  #measure() {
    // 換頁動畫會縮放祖先；版面尺寸不能跟著動畫縮小，否則照片會縮到左上角。
    this.stageSize = { w: this.stage.clientWidth, h: this.stage.clientHeight };
    const css = this.host.ownerDocument.defaultView.getComputedStyle(this.host);
    this.inset = { top: parseFloat(css.scrollPaddingTop) || 0, bottom: parseFloat(css.scrollPaddingBottom) || 0 };
    this.schedule();
  }

  /** 顯示範圍（照片像素） */
  get crop() {
    const { photo, crop } = this.model;
    return this.options.crop ?? crop ?? { x: 0, y: 0, w: photo.w, h: photo.h };
  }

  get content() {
    const c = this.crop;
    return fitSize(this.stageSize, c.w / c.h, this.options.fit);
  }

  /** 一個螢幕像素等於幾個照片像素 */
  get k() {
    return this.crop.w / (this.content.w * this.state.scale);
  }

  get ui() {
    return this.options.ui ?? (this.mq?.matches ? 1.5 : 1);
  }

  /** 排到下一個畫面重畫（縮放、拖曳連續變動時合併成一次） */
  schedule() {
    if (this.destroyed || this.raf) return;
    const win = this.host.ownerDocument.defaultView;
    this.raf = win.requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** 額外要畫在線上面的 SVG（編輯器的把手等） */
  extras() {
    return '';
  }

  /** 傳給 renderLines 的選項（編輯器覆蓋） */
  linesOptions() {
    const { highlight, solo, editing, gradePill, boltCodes, names } = this.options, naturalEndsOn = this.options.naturalEnds !== false;
    const bolts = this.options.bolts === 'zoom' ? this.state.scale >= BOLT_ZOOM || undefined : this.options.bolts;
    return { highlight, bolts, solo, editing, gradePill, boltCodes, names, naturalEnds: naturalEndsOn, interactive: this.options.interactive };
  }

  render() {
    if (this.destroyed || !this.model || this.stageSize.w === 0) return;
    const { photo } = this.model, c = this.crop, size = this.content, s = this.state;
    const next = clampView(s, this.stageSize, size, this.inset);
    if (next.x !== s.x || next.y !== s.y || next.scale !== s.scale) this.state = next;
    const transform = `translate(${this.state.x}px, ${this.state.y}px) scale(${this.state.scale})`;
    if (this.inner.style.transform && transform !== this.inner.style.transform) this.#moving();
    Object.assign(this.inner.style, {
      width: `${size.w}px`, height: `${size.h}px`,
      left: `${(this.stageSize.w - size.w) / 2}px`, top: `${(this.stageSize.h - size.h) / 2}px`,
      transform,
    });
    Object.assign(this.img.style, {
      width: `${(photo.w / c.w) * 100}%`, height: `${(photo.h / c.h) * 100}%`,
      left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%`,
    });
    this.svg.setAttribute('viewBox', `${c.x} ${c.y} ${c.w} ${c.h}`);
    const k = this.k;
    this.host.classList.toggle('tk-gray', !!this.options.reveal);
    const reveal = this.options.reveal ? renderReveal(this.routes.find((r) => r.id === this.options.highlight)?.line, { photo, width: (this.options.revealWidth ?? REVEAL_WIDTH) * c.w, id: this.maskId }) : '';
    const lo = this.linesOptions();
    // 線頭線尾自然一點（naturalEnds；資料照原樣，只影響畫面）：編輯時除了正在編的那條（點都有把手）
    const ends = lo.naturalEnds ? naturalEnds(this.routes, photo.h) : this.routes;
    const routes = lo.editing ? ends.map((r, i) => (r.id === lo.highlight ? this.routes[i] : r)) : ends;
    this.svg.innerHTML = reveal + renderLines(routes, { photo, crop: c, k, ui: this.ui, ...lo }) + this.extras(k);
    this.stage.classList.toggle('draggable', this.movable);
    this.host.dataset.scale = String(Math.round(this.state.scale * 100) / 100);
    if (this.fitButton) this.fitButton.textContent = `${Math.round(this.state.scale * 100)}%`;
  }

  /** 畫面在動：照片層交給 GPU，停下來 MOVING_MS 後拿掉（之後照目前倍率重畫，向量不糊） */
  #moving() {
    this.inner.classList.add('tk-moving');
    const win = this.host.ownerDocument.defaultView;
    win.clearTimeout(this.movingTimer);
    this.movingTimer = win.setTimeout(() => this.inner.classList.remove('tk-moving'), MOVING_MS);
  }

  // ── 縮放與平移 ──
  /** 滑鼠位置換成以舞台中心為原點的座標 */
  rel(e) {
    const r = this.stage.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  }

  setView(v) {
    if (!this.options.zoom) return;
    this.state = clampView(v, this.stageSize, this.content, this.inset);
    this.schedule();
    this.dispatchEvent(new CustomEvent('zoom', { detail: { scale: this.state.scale } }));
  }

  /**
   * 平滑地縮放到照片上的一塊（照片像素 { x, y, w, h }）：放到整塊剛好看得到；keepZoom 時只放大不縮小；
   * 那一塊已經整個看得到、放得夠大時不動。動畫只在這一次（手指一按下就停掉）。
   */
  zoomToRect(rect, { keepZoom = false, animate = true } = {}) {
    if (!this.model || !this.options.zoom) return;
    const c = this.crop, size = this.content;
    const box = { x: ((rect.x - c.x) / c.w - 0.5) * size.w, y: ((rect.y - c.y) / c.h - 0.5) * size.h, w: (rect.w / c.w) * size.w, h: (rect.h / c.h) * size.h };
    const next = focusView(this.state, box, this.stageSize, size, { keepZoom, inset: this.inset });
    if (next === this.state) return;
    if (animate) this.#glide();
    this.setView(next);
  }

  #glide() {
    const win = this.host.ownerDocument.defaultView;
    this.inner.classList.add('tk-glide');
    win.clearTimeout(this.glideTimer);
    this.glideTimer = win.setTimeout(() => this.inner.classList.remove('tk-glide'), GLIDE_MS);
  }

  /** 可以平移：放大了，或照片的上下緣能拖到按鈕外面 */
  get movable() {
    return this.state.scale > 1 || this.content.w > this.stageSize.w + 1 || this.content.h > this.stageSize.h + 1 || this.inset.top > 0 || this.inset.bottom > 0;
  }

  zoomBy(ratio, at = { x: 0, y: 0 }) {
    this.setView(moveView(this.state, at, at, ratio, this.stageSize, this.content, this.inset));
  }

  #wheel(e) {
    if (!this.options.zoom || (this.options.wheel === 'ctrl' && !(e.ctrlKey || e.metaKey))) return;
    e.preventDefault();
    this.zoomBy(Math.exp((-e.deltaY * (e.deltaMode === 1 ? 16 : 1)) / 500), this.rel(e));
  }

  #hotkey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
    if (this.options.wheel === 'ctrl' && !this.hover) return;
    if (e.key === '+' || e.key === '=') this.zoomBy(STEP);
    else if (e.key === '-') this.zoomBy(1 / STEP);
    else if (e.key === '0') this.setView(IDENTITY);
  }

  /** 照片上這個位置的拖曳是不是留給別的東西（編輯器的把手）；有的話不平移 */
  ownsPointer() {
    return false;
  }

  #down(e) {
    if (e.target.closest('.tk-zoom')) return;
    this.inner.classList.remove('tk-glide');
    if (e.pointerType === 'touch' && e.isPrimary) this.pointers.clear();
    // 第一根手指（或滑鼠）是新的一輪；gesture 記起點與當時照片的橫向位置（判斷左右滑），第二根手指放下就不算滑動
    if (this.pointers.size === 0) {
      this.dragged = false;
      this.gesture = { from: this.rel(e), x: this.state.x, pinched: false };
    } else if (this.gesture) this.gesture.pinched = true;
    this.pointers.set(e.pointerId, this.rel(e));
    this.owned = this.ownsPointer(e);
    if (this.pointers.size >= 2) {
      // 第二根手指放下：改成捏合，放開時不當作點了一下
      this.dragged = true;
      this.press = undefined;
      this.pan = undefined;
      for (const id of this.pointers.keys()) this.stage.setPointerCapture?.(id);
      return;
    }
    if (e.button === 0 || e.pointerType === 'touch') this.press = this.rel(e);
  }

  #move(e) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const now = this.rel(e);
    if (this.pointers.size >= 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)[1];
      this.pointers.set(e.pointerId, now);
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      this.setView(moveView(this.state, mid(prev, other), mid(now, other), dist(now, other) / (dist(prev, other) || 1), this.stageSize, this.content, this.inset));
      return;
    }
    this.pointers.set(e.pointerId, now);
    if (this.press && !this.pan && !this.owned && this.canPan(e) && Math.hypot(now.x - this.press.x, now.y - this.press.y) > DRAG_PX) {
      this.pan = this.press;
      this.dragged = true;
      this.stage.setPointerCapture?.(e.pointerId);
      this.stage.classList.add('panning');
    }
    if (this.press && !this.pan && Math.hypot(now.x - this.press.x, now.y - this.press.y) > DRAG_PX) this.dragged = true;
    if (this.pan) {
      this.setView(moveView(this.state, this.pan, now, 1, this.stageSize, this.content, this.inset));
      this.pan = now;
    }
  }

  /** 這次拖曳可以平移：放大了（或有上下留白）才能平移（編輯器再多加條件） */
  canPan() {
    // 多條路線的起始視角留給左右換線；放大後再拖曳照片。
    if (this.options.swipe && (this.routes.length > 1 || this.options.swipe === 'page') && this.state.scale <= 1) return false;
    return this.movable;
  }

  #up(e) {
    this.pointers.delete(e.pointerId);
    if (this.tapsWith(e) && this.pointers.size === 0 && this.press && !this.dragged) this.tapped(e);
    if (this.pointers.size === 0) {
      const g = this.gesture;
      this.gesture = undefined;
      const step = this.options.swipe && g && !g.pinched && e.type === 'pointerup' ? swipeStep(g.from, this.rel(e), this.state.x - g.x) : undefined;
      if (step) this.dispatchEvent(new CustomEvent('swipe', { detail: { step } }));
      this.pan = undefined;
      this.press = undefined;
      this.stage.classList.remove('panning');
    }
  }

  /** 這種指標的點兩下要放大或回到整張：看圖時手指與滑鼠都是（編輯器只有手指，滑鼠點兩下是加兩個點） */
  tapsWith() {
    return true;
  }

  /** 點一下（沒拖、沒捏合）：連續兩下就是點兩下，放大或回到整張 */
  tapped(e) {
    const now = { at: this.rel(e), time: e.timeStamp };
    if (isDoubleTap(this.lastTap, now)) {
      this.lastTap = undefined;
      this.dragged = true;
      this.doubleTapped(now.at);
    } else this.lastTap = now;
  }

  doubleTapped(at) {
    this.setView(doubleTapView(this.state, at, this.stageSize, this.content, this.inset));
  }

  #click(e) {
    if (e.target.closest('.tk-zoom')) return;
    if (this.dragged && e.detail !== 0) {
      this.dragged = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    this.clicked(e);
  }

  /** 沒被擋掉的點擊（編輯器覆蓋）：預設點到路線就發 pick */
  clicked(e) {
    const id = e.target.closest?.('[data-route]')?.dataset.route;
    if (id && this.options.interactive) this.pick(id);
  }

  #key(e) {
    if (e.key !== 'Enter') return;
    const id = e.target.closest?.('[data-route]')?.dataset.route;
    if (id && this.options.interactive) this.pick(id);
  }

  pick(id) {
    this.dispatchEvent(new CustomEvent('pick', { detail: { id } }));
  }

  /** 螢幕座標換成照片像素（取整數，限制在照片內） */
  pointAt(e) {
    const r = this.svg.getBoundingClientRect(), c = this.crop, { photo } = this.model;
    const x = c.x + ((e.clientX - r.left) / r.width) * c.w, y = c.y + ((e.clientY - r.top) / r.height) * c.h;
    return [Math.round(Math.min(photo.w, Math.max(0, x))), Math.round(Math.min(photo.h, Math.max(0, y)))];
  }

  /** 解除所有事件監聽、ResizeObserver、計時器，並清空 host；呼叫之後不能再用 */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ac.abort();
    this.ro.disconnect();
    if (this.raf) this.host.ownerDocument.defaultView.cancelAnimationFrame(this.raf);
    this.host.ownerDocument.defaultView.clearTimeout(this.glideTimer);
    this.host.ownerDocument.defaultView.clearTimeout(this.movingTimer);
    delete this.host.dataset.scale;
    this.cleanup();
    this.host.classList.remove('tk');
    this.host.replaceChildren();
    this.dispatchEvent(new CustomEvent('destroy'));
  }

  /** 子類別額外要收的東西 */
  cleanup() {}
}

export { MAX_SCALE };
