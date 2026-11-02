// mapkit Viewer：向量地圖（原生 SVG）。拖曳平移、雙指縮放與旋轉、滾輪縮放、點兩下放大、羅盤回到北方朝上；
// 點岩壁發 pick、點地圖發 tap、長按（電腦按右鍵）區域發 areapress。底圖圖磚（OSM、航照、等高線）可以開關。
// 不做任何上傳、不連後端（圖磚除外）；資料由呼叫的 App 給（Climbio v2 的地圖畫面＋圖層，經緯度）。
// 所有事件監聽都掛在同一個 AbortController 上，ResizeObserver、計時器也在 destroy() 一起收掉。
// 移植自龍洞（MIT）src/map/ScaleMap.tsx、useMapGestures.ts。
// English: native SVG map viewer with pan/zoom/rotate gestures, toggleable tiles, pick/tap/areapress events.
import { readMap } from './data.js';
import { renderMap } from './render.js';
import { injectStyle } from './style.js';
import { contourTile, SOURCES, tileLevel, visibleTiles } from './tiles.js';
import { clampScale, clampView, fitRectView, focusView, maxScale, MIN_SCALE, panBy, rectOf, rotateAt, STEP, toMap, toScreen, zoomAt } from './viewport.js';
import { segmentDistance } from './labels.js';

/** 介面文字（lang 沒有的用 en）；{n} 換成數字 */
export const TEXT = {
  zh: { aria: '地圖', locate: '回到我的位置', north: '北方朝上', zoomIn: '放大', zoomOut: '縮小', meters: '{n} 公尺', hazard: '危險地形', boat: '船艇接駁點', hoist: '直升機吊掛點', aid: '急救器材 #{n}' },
  en: { aria: 'Map', locate: 'My location', north: 'Face north', zoomIn: 'Zoom in', zoomOut: 'Zoom out', meters: '{n} m', hazard: 'Hazardous terrain', boat: 'Boat rescue point', hoist: 'Helicopter hoist point', aid: 'EMS equipment #{n}' },
  ja: { aria: '地図', locate: '現在地', north: '北を上にする', zoomIn: '拡大', zoomOut: '縮小', meters: '{n} m', hazard: '危険地形', boat: '船舶搬送地点', hoist: 'ヘリコプター吊り上げ地点', aid: '救急用品 #{n}' },
};

/** 比例尺的長度（公尺）：選畫面上不超過 SCALE_BAR_PX 的最長一個 */
const SCALE_BARS = [10, 20, 50, 100, 200, 500];
const SCALE_BAR_PX = 60;
/** 長按多久（毫秒）、手指移動不超過多少像素算長按 */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 12;
/** 點一下：放開前移動不超過這個距離、按住不超過這個時間 */
const TAP_SLOP_PX = 8;
const TAP_MS = 400;
/** 雙指轉動超過這個角度才開始旋轉（弧度） */
const ROTATE_START = 0.15;
/** 點岩壁：離線段這個距離（像素）內都算 */
export const LINE_HIT_PX = 10;
/** 聚焦範圍外留的邊與最小範圍（公尺）；tight：岩壁只有幾十公尺 */
const FOCUS = { pad: 30, min: 200 };
const TIGHT = { pad: 8, min: 50 };
/** 縮放停下多久（毫秒）才換圖磚的層級 */
const TILE_SETTLE_MS = 300;

let count = 0;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 點在多邊形裡（射線法） */
function inRing([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export class MapViewer extends EventTarget {
  /**
   * host：放地圖的元素（要有高度）。options：
   *  - lang（'zh'、'en'、'ja'…，名稱用哪個語言）、text（覆蓋介面文字）、attribution（右下角的版權標示，字串或 [{ text, href }]；預設是畫面的 attribution）
   *  - dim（區域節點 id：其他區域變淡）、hideAreas、walls（畫岩壁，預設 true）、sectorLabels（放大後標分區名稱，預設 true）、selected（{ node, line }）
   *  - basemap：{ osm, ortho, contours }（圖磚，預設都關）
   *  - marks（[{ at, picked?, label?, selected? }]）、here（{ at, accuracy }）、pin（經緯度：圖釘）、draft（{ points, closed }）
   *  - controls：羅盤、縮放按鈕、比例尺（預設 true）；locate：「回到我的位置」按鈕（按了發 locate，定位由 App 做、結果放 here）
   * 經緯度一律 [經度, 緯度]。
   */
  constructor(host, options = {}) {
    super();
    this.host = host;
    this.options = { walls: true, sectorLabels: true, controls: true, lang: 'zh', basemap: {}, ...options };
    this.id = `mk${++count}`;
    this.model = undefined;
    this.view = undefined;
    this.frame = undefined;
    this.ac = new AbortController();
    this.pointers = new Map();
    this.timers = new Set();
    this.contours = {};
    this.pending = new Set();
    this.tileZ = undefined;
    this.destroyed = false;
    this.#mount();
  }

  listen(target, type, fn, opts = {}) {
    target.addEventListener(type, fn, { ...opts, signal: this.ac.signal });
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  #mount() {
    const host = this.host;
    host.classList.add('mk');
    injectStyle(host);
    if (host.ownerDocument.defaultView.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.innerHTML = '<div class="mk-frame"><svg></svg></div>';
    this.box = host.querySelector('.mk-frame');
    this.svg = host.querySelector('svg');
    if (this.options.controls) {
      this.box.insertAdjacentHTML(
        'beforeend',
        '<button type="button" class="mk-control mk-compass"><svg viewBox="-12 -12 24 24" width="24" height="24" aria-hidden="true"><path d="M0 -10l4 10h-8z" fill="#d93025"></path><path d="M0 10l4 -10h-8z" fill="currentColor" opacity="0.45"></path></svg></button>' +
          '<div class="mk-bottom-right"><div class="mk-zoom"><button type="button" class="mk-control" data-zoom="in">＋</button><button type="button" class="mk-control" data-zoom="out">－</button></div>' +
          (this.options.locate
            ? '<button type="button" class="mk-control mk-locate"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"></circle></svg></button>'
            : '') +
          '</div>',
      );
      this.listen(this.box.querySelector('.mk-compass'), 'click', () => this.#apply((v, f) => rotateAt(v, f, { x: f.w / 2, y: f.h / 2 }, 0)));
      this.listen(this.box.querySelector('[data-zoom="in"]'), 'click', () => this.zoomBy(1 / STEP));
      this.listen(this.box.querySelector('[data-zoom="out"]'), 'click', () => this.zoomBy(STEP));
      const locate = this.box.querySelector('.mk-locate');
      if (locate) this.listen(locate, 'click', () => this.dispatchEvent(new CustomEvent('locate')));
    }
    this.attributionEl = host.ownerDocument.createElement('p');
    this.attributionEl.className = 'mk-attribution';
    this.box.append(this.attributionEl);
    if (this.options.controls) {
      this.legend = host.ownerDocument.createElement('div');
      this.legend.className = 'mk-legend';
      this.legend.setAttribute('aria-hidden', 'true');
      this.box.append(this.legend);
    }
    this.ro = new ResizeObserver(() => this.#measure());
    this.ro.observe(this.box);
    this.#measure();
    this.listen(this.box, 'pointerdown', (e) => this.#down(e));
    this.listen(this.box, 'pointermove', (e) => this.#move(e));
    this.listen(this.box, 'pointerup', (e) => this.#up(e));
    this.listen(this.box, 'pointercancel', (e) => this.#up(e));
    this.listen(this.box, 'wheel', (e) => this.#wheel(e), { passive: false });
    this.listen(this.box, 'dblclick', (e) => {
      if (this.#onControl(e)) return;
      const at = this.#local(e);
      this.#apply((v, f) => zoomAt(v, f, at, clampScale(v.s / STEP, this.model.bounds, f)));
    });
    this.listen(this.box, 'contextmenu', (e) => {
      if (this.#onControl(e)) return;
      e.preventDefault();
      const type = e.pointerType;
      if (type ? type === 'mouse' : e.button === 2) this.#areaPress(this.#areaAt(this.#local(e)));
    });
    this.listen(this.box, 'touchend', (e) => {
      if (!this.held) return;
      this.held = undefined;
      e.preventDefault();
    }, { passive: false });
  }

  get text() {
    return { ...(TEXT[this.options.lang] ?? TEXT.en), ...this.options.text };
  }

  /** data：{ view（v2 地圖畫面）, layers?, nodes? }；不是 v2 地圖畫面就丟錯。第一次給資料時移到一開始的畫面 */
  setData(data) {
    this.data = data;
    this.model = readMap(data.view, data.layers ?? [], data.nodes ?? []);
    if (this.frame && !this.view) this.view = fitRectView(this.model.home, this.model.bounds, this.frame);
    else if (this.view && this.frame) this.view = clampView(this.view, this.model.bounds, this.frame);
    this.render();
  }

  /** 改選項（同 constructor）並重畫 */
  set(options) {
    Object.assign(this.options, options);
    this.render();
  }

  /** 目前的畫面：{ center: [經度, 緯度], metersPerPixel, rotation（度，順時針）} */
  getView() {
    if (!this.view || !this.model) return undefined;
    return { center: this.model.proj.unproject([this.view.cx, this.view.cy]), metersPerPixel: this.view.s, rotation: (this.view.r * 180) / Math.PI };
  }

  /** 移到這個畫面（同 getView 的格式），限制在移動範圍內 */
  setView({ center, metersPerPixel, rotation = 0 }) {
    const [cx, cy] = this.model.proj.project(center);
    this.#apply(() => ({ cx, cy, s: metersPerPixel, r: (rotation * Math.PI) / 180 }));
  }

  /**
   * 聚焦：node（區域或分區節點 id）或 points（經緯度）放大到剛好放進框裡、北方朝上；tight：只比位置多一點點（岩壁）
   */
  focus({ node, points = [], tight = false }) {
    const m = this.model;
    const xy = [...(m.areas.find((a) => a.id === node)?.rings.flat() ?? []), ...(m.walls.find((w) => w.id === node)?.lines.flat() ?? []), ...points.map(m.proj.project)];
    if (!xy.length) return;
    const r = rectOf(xy);
    const { pad, min } = tight ? TIGHT : FOCUS;
    const w = Math.max(min, r.w + 2 * pad), h = Math.max(min, r.h + 2 * pad);
    const target = { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
    this.#apply((_, f) => focusView(target, m.bounds, f));
  }

  /** 以框的中心縮放 factor 倍（小於 1 放大） */
  zoomBy(factor) {
    this.#apply((v, f) => zoomAt(v, f, { x: f.w / 2, y: f.h / 2 }, clampScale(v.s * factor, this.model.bounds, f)));
  }

  /** 經緯度 → 框內的螢幕座標；反過來 */
  toScreen(lngLat) {
    return toScreen(this.view, this.frame, this.model.proj.project(lngLat));
  }
  toLngLat([x, y]) {
    return this.model.proj.unproject(toMap(this.view, this.frame, [x, y]));
  }

  #measure() {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    if (!w || !h) return;
    this.frame = { w, h };
    if (this.model) this.view = this.view ? clampView(this.view, this.model.bounds, this.frame) : fitRectView(this.model.home, this.model.bounds, this.frame);
    this.render();
  }

  #apply(next) {
    if (!this.view || !this.frame || !this.model) return;
    this.view = clampView(next(this.view, this.frame), this.model.bounds, this.frame);
    this.render();
    this.dispatchEvent(new CustomEvent('view', { detail: this.getView() }));
  }

  /** 底圖圖磚：縮放停下 TILE_SETTLE_MS 才換層級；等高線處理好才畫 */
  #tiles() {
    const b = this.options.basemap ?? {};
    if (!b.osm && !b.ortho && !b.contours) return {};
    const dpr = this.host.ownerDocument.defaultView.devicePixelRatio || 1;
    const want = tileLevel(this.model.proj, this.view, dpr);
    if (this.tileZ === undefined) this.tileZ = want;
    else if (want !== this.tileZ) {
      clearTimeout(this.tileTimer);
      this.tileTimer = this.later(() => {
        this.tileZ = want;
        this.render();
      }, TILE_SETTLE_MS);
    }
    const level = this.tileZ;
    const tiles = {};
    const p = this.model.proj, v = this.view, f = this.frame;
    if (b.osm) tiles.osm = visibleTiles(p, v, f, SOURCES.osm, { dpr, level: Math.min(level, SOURCES.osm.maxZ) });
    if (b.ortho) tiles.ortho = visibleTiles(p, v, f, SOURCES.ortho, { dpr, level });
    if (b.contours) {
      tiles.contours = visibleTiles(p, v, f, SOURCES.contours, { dpr, level, transparent: true }).flatMap((t) => {
        if (this.contours[t.href]) return [{ ...t, href: this.contours[t.href] }];
        // 每張只等一次：處理好了才重畫一次
        if (this.pending.has(t.href)) return [];
        this.pending.add(t.href);
        contourTile(t.href).then(
          (url) => {
            if (this.destroyed) return;
            this.contours[t.href] = url;
            this.render();
          },
          (err) => {
            this.pending.delete(t.href);
            this.dispatchEvent(new CustomEvent('error', { detail: err }));
          },
        );
        return [];
      });
    }
    return tiles;
  }

  render() {
    if (this.destroyed || !this.model || !this.view || !this.frame) return;
    const o = this.options, f = this.frame, v = this.view;
    this.host.classList.toggle('mk-ortho', !!o.basemap?.ortho);
    const { svg, labels } = renderMap(this.model, v, f, {
      id: this.id,
      lang: o.lang,
      text: this.text,
      dim: o.dim,
      hideAreas: o.hideAreas,
      hide: o.hide,
      walls: o.walls,
      sectorLabels: o.sectorLabels,
      selected: o.selected,
      tiles: this.#tiles(),
      draft: o.draft,
      marks: o.marks,
      here: o.here,
      pick: o.pin,
      edit: this.editing,
      dragging: this.dragging,
    });
    this.labels = labels;
    this.svg.setAttribute('width', f.w);
    this.svg.setAttribute('height', f.h);
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', o.aria ?? this.text.aria);
    this.svg.innerHTML = svg;
    const t = this.text;
    if (o.controls) {
      const compass = this.box.querySelector('.mk-compass');
      compass.setAttribute('aria-label', t.north);
      compass.title = t.north;
      compass.querySelector('svg').style.transform = `rotate(${(v.r * 180) / Math.PI}deg)`;
      const [zin, zout] = this.box.querySelectorAll('[data-zoom]');
      zin.setAttribute('aria-label', t.zoomIn);
      zout.setAttribute('aria-label', t.zoomOut);
      zin.disabled = v.s <= MIN_SCALE * 1.0001;
      zout.disabled = v.s >= maxScale(this.model.bounds, f) * 0.9999;
      const locate = this.box.querySelector('.mk-locate');
      if (locate) {
        locate.classList.toggle('on', !!o.here);
        locate.setAttribute('aria-label', t.locate);
        locate.title = t.locate;
      }
      const bar = SCALE_BARS.filter((m) => m / v.s <= SCALE_BAR_PX).pop() ?? SCALE_BARS[0];
      this.legend.innerHTML = `<span class="mk-bar" style="width: ${bar / v.s}px;"></span>${esc(t.meters.replace('{n}', bar))}`;
    }
    const credit = o.attribution ?? this.data.view.attribution;
    const parts = credit === undefined ? [] : typeof credit === 'string' ? [{ text: credit }] : credit;
    this.attributionEl.innerHTML = parts.map((p) => (p.href ? `<a href="${esc(p.href)}" target="_blank" rel="noreferrer">${esc(p.text)}</a>` : esc(p.text))).join(' · ');
  }

  /* ---------- 手勢（同龍洞的 useMapGestures） ---------- */

  #local(e) {
    const r = this.box.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  #onControl(e) {
    return !!e.target.closest('button, a, .mk-handle');
  }
  #pair() {
    const [a, b] = [...this.pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  /** 框內這一點底下最裡面的區域（按下時就決定） */
  #areaAt(p) {
    if (!this.view || !this.model) return undefined;
    const at = toMap(this.view, this.frame, [p.x, p.y]);
    const hits = this.model.areas.filter((a) => a.rings.some((r) => inRing(at, r)));
    return hits.sort((a, b) => a.size - b.size)[0]?.id;
  }
  #areaPress(id) {
    if (id) this.dispatchEvent(new CustomEvent('areapress', { detail: { node: id } }));
  }
  #cancelPress() {
    if (this.press) clearTimeout(this.press.timer);
    this.press = undefined;
  }
  #down(e) {
    if (this.#onControl(e) || !this.view) return;
    this.box.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, this.#local(e));
    this.twist = 0;
    this.rotating = false;
    this.#cancelPress();
    this.tap = this.pointers.size === 1 && e.button === 0 ? { id: e.pointerId, at: this.#local(e), time: e.timeStamp } : undefined;
    if (this.pointers.size === 1 && e.pointerType !== 'mouse') {
      const at = this.#local(e);
      const area = this.#areaAt(at);
      this.press = {
        at,
        timer: this.later(() => {
          this.press = undefined;
          if (!area) return;
          this.held = { id: area, at };
          navigator.vibrate?.(20);
        }, LONG_PRESS_MS),
      };
    }
  }
  #move(e) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    if (this.pointers.size === 1) {
      const p = this.#local(e);
      if (this.tap && Math.hypot(p.x - this.tap.at.x, p.y - this.tap.at.y) > TAP_SLOP_PX) this.tap = undefined;
      const start = this.press?.at ?? this.held?.at;
      if (start && Math.hypot(p.x - start.x, p.y - start.y) > LONG_PRESS_SLOP_PX) {
        this.#cancelPress();
        this.held = undefined;
      }
      this.pointers.set(e.pointerId, p);
      this.#apply((v) => panBy(v, p.x - prev.x, p.y - prev.y));
    } else if (this.pointers.size === 2) {
      this.#cancelPress();
      this.held = undefined;
      this.tap = undefined;
      const before = this.#pair();
      this.pointers.set(e.pointerId, this.#local(e));
      const after = this.#pair();
      if (before.dist === 0 || after.dist === 0) return;
      const turn = Math.atan2(Math.sin(after.angle - before.angle), Math.cos(after.angle - before.angle));
      this.twist += turn;
      if (!this.rotating && Math.abs(this.twist) > ROTATE_START) this.rotating = true;
      this.#apply((v, f) => {
        const moved = panBy(v, after.mid.x - before.mid.x, after.mid.y - before.mid.y);
        const zoomed = zoomAt(moved, f, after.mid, clampScale((v.s * before.dist) / after.dist, this.model.bounds, f));
        return this.rotating ? rotateAt(zoomed, f, after.mid, zoomed.r + turn) : zoomed;
      });
    }
  }
  #up(e) {
    this.pointers.delete(e.pointerId);
    this.#cancelPress();
    if (e.type === 'pointerup' && this.tap?.id === e.pointerId && !this.held && e.timeStamp - this.tap.time <= TAP_MS) this.onTap(this.tap.at);
    this.tap = undefined;
    if (!this.held) return;
    if (e.type === 'pointerup') {
      const { id } = this.held;
      this.later(() => this.#areaPress(id), 0);
    } else this.held = undefined;
  }
  #wheel(e) {
    e.preventDefault();
    const at = this.#local(e);
    this.#apply((v, f) => zoomAt(v, f, at, clampScale(v.s * Math.exp(e.deltaY * 0.002), this.model.bounds, f)));
  }

  /** 點一下：發 tap（經緯度與每像素幾公尺）；點到岩壁（LINE_HIT_PX 內最近的一條）另外發 pick。Editor 覆寫 */
  onTap(p) {
    this.dispatchEvent(new CustomEvent('tap', { detail: { at: this.toLngLat([p.x, p.y]), metersPerPixel: this.view.s } }));
    if (!this.options.walls) return;
    const hidden = new Set(this.options.hide ?? []);
    const hit = this.model.walls
      .filter((w) => !hidden.has(w.id))
      .flatMap((w) => w.lines.map((line, k) => {
        const pts = line.map((q) => toScreen(this.view, this.frame, q));
        return { node: w.id, line: k, d: Math.min(...pts.slice(1).map((b, i) => segmentDistance([p.x, p.y], pts[i], b))) };
      }))
      .filter((x) => x.d <= LINE_HIT_PX)
      .sort((a, b) => a.d - b.d)[0];
    if (hit) this.dispatchEvent(new CustomEvent('pick', { detail: { node: hit.node, line: hit.line } }));
  }

  /** 解除所有事件監聽、ResizeObserver、計時器，清掉畫面 */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ac.abort();
    this.ro.disconnect();
    this.#cancelPress();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.host.innerHTML = '';
    this.host.classList.remove('mk', 'mk-ortho');
  }
}
