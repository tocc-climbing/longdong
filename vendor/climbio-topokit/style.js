// TopoKit 的樣式（字串）。Viewer 掛載時把它放進所在的 root（shadow root 或 document.head），只放一份。
// 顏色用 CSS 變數，使用的 App 可以在 .tk 或 <climbio-topo> 上覆蓋：--tk-sport、--tk-sport-on、--tk-other、--tk-other-on、--tk-bolt。
// 樣式規則移植自龍洞（MIT）src/styles.css 的 .topo-*。
// English: stylesheet string injected once per root; colours are CSS variables.
export const CSS = `
.tk { display: block; overflow: hidden; --tk-sport: #1565c0; --tk-sport-on: #1e7bff; --tk-other: #c8102e; --tk-other-on: #e11d2e; --tk-bolt: #1ea0e6; }
/* 不受 App 全域樣式影響（例如 App 把所有 svg 圖示設成 stroke: currentColor，會讓 Topo 的字描上外框）；字型固定，各 App 看到同一種字 */
.tk svg { fill: initial; stroke: initial; stroke-width: initial; stroke-linecap: initial; stroke-linejoin: initial; font-family: system-ui, -apple-system, "SF Pro Text", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif; }
.tk-stage { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; background: var(--tk-bg, #222); }
.tk-stage.draggable { cursor: grab; }
.tk-stage.panning { cursor: grabbing; }
.tk-inner { position: absolute; transform-origin: 50% 50%; }
/* 縮放、拖曳的當下交給 GPU（順）；停下來就拿掉，瀏覽器照目前的倍率重畫，線和牌子不會被拉糊 */
.tk-inner.tk-moving { will-change: transform; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
/* 縮放、拖曳時照片外面不留殘影（Android Chrome 縮小後舊的圖塊沒清掉）：舞台自己一層、只在舞台裡重畫 */
.tk-stage { contain: strict; isolation: isolate; }
.tk-inner.tk-glide { transition: transform 0.35s ease; }
@media (prefers-reduced-motion: reduce) { .tk-inner.tk-glide { transition: none; } }
.topo-frame { position: absolute; inset: 0; overflow: hidden; }
.topo-frame img, .topo-frame svg { position: absolute; opacity: 0; transition: opacity 0.4s ease; }
.topo-frame.ready img, .topo-frame.ready svg { opacity: 1; }
.topo-frame svg { inset: 0; width: 100%; height: 100%; }
.topo-frame img { max-width: none; object-fit: fill; user-select: none; -webkit-user-drag: none; }
@media (prefers-reduced-motion: reduce) { .topo-frame img, .topo-frame svg { transition: none; } }
.topo-route { --topo-line: var(--tk-other); --topo-pill: var(--tk-other); }
.topo-route.on { --topo-line: var(--tk-other-on); --topo-pill: var(--tk-other-on); }
.topo-route.kind-sport { --topo-line: var(--tk-sport); --topo-pill: var(--tk-sport); }
.topo-route.kind-sport.on { --topo-line: var(--tk-sport-on); --topo-pill: var(--tk-sport-on); }
.topo-route.dim { opacity: 0.6; }
.tk.tk-gray .topo-frame img { filter: grayscale(1) contrast(0.8); }
.topo-route path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.topo-hit { stroke: transparent; }
.topo-line { stroke: var(--topo-line); }
.topo-route .topo-dot { fill: var(--topo-line); stroke: none; }
g.topo-route.link { cursor: pointer; outline: none; }
g.topo-route.link:is(:hover, :focus-visible) { opacity: 1; outline: none; }
.topo-badge rect { fill: var(--topo-pill); stroke: none; }
.topo-badge text { fill: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }
.topo-badge .topo-grade-bg { fill: #fff; stroke: none; }
.topo-badge .topo-grade { fill: var(--topo-pill); font-style: italic; font-weight: 700; }
.topo-bolt rect { fill: var(--tk-bolt); fill-opacity: 0.6; stroke: none; }
.topo-bolt.anchor rect { fill: var(--topo-pill); }
.topo-bolt text { fill: #fff; font-weight: 700; }
.topo-note { fill: #fff; paint-order: stroke; stroke: rgba(0, 0, 0, 0.7); stroke-linejoin: round; }
.topo-bolt text.topo-note { font-weight: 500; }
.topo-handles { --topo-line: var(--tk-other-on); }
.topo-handles.kind-sport { --topo-line: var(--tk-sport-on); }
.topo-handles circle { fill: #fff; stroke: var(--topo-line); cursor: grab; }
.topo-handles circle.picked { fill: var(--topo-line); stroke: #fff; }
.topo-handles rect.bolt { fill: transparent; stroke: var(--topo-line); stroke-dasharray: 4 3; cursor: grab; }
.topo-handles rect.bolt.picked { stroke-dasharray: none; }
.topo-hits circle { fill: transparent; cursor: grab; }
.topo-fork circle { fill: rgba(255, 255, 255, 0.35); stroke: #fff; cursor: copy; }
.tk-stage.line, .tk-stage.bolt { cursor: crosshair; }
.tk-stage.hand { cursor: grab; }
.topo-crop-dim { fill: rgba(0, 0, 0, 0.55); pointer-events: none; }
.topo-crop-box { fill: transparent; stroke: #fff; cursor: move; }
.topo-crop-handle { fill: #fff; stroke: #ff5a36; }
.tk-zoom button[aria-pressed="true"] { background: rgba(0, 0, 0, 0.85); box-shadow: inset 0 0 0 2px #fff; }
.tk-loupe { position: absolute; z-index: 4; width: 128px; height: 128px; overflow: hidden; border: 2px solid #fff; border-radius: 50%; background: #000; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5); pointer-events: none; --topo-line: var(--tk-other-on); }
.tk-loupe[hidden] { display: none; }
.tk-loupe.kind-sport { --topo-line: var(--tk-sport-on); }
.tk-loupe svg { display: block; width: 100%; height: 100%; }
.tk-loupe-line { fill: none; stroke: var(--topo-line); stroke-linecap: round; }
.tk-loupe-point { fill: var(--topo-line); }
.tk-loupe-cross { stroke: #ffd400; stroke-linecap: round; }
.tk-zoom { position: absolute; right: 8px; bottom: 8px; display: flex; gap: 4px; }
.tk-zoom button { min-width: 32px; height: 32px; padding: 0 8px; border: 0; border-radius: 16px; background: rgba(0, 0, 0, 0.55); color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; }
.tk-zoom button:hover { background: rgba(0, 0, 0, 0.75); }
`;

/** 把樣式放進 el 所在的 root（shadow root 或 document.head），同一個 root 只放一份 */
export function injectStyle(el) {
  const root = el.getRootNode();
  const parent = root instanceof ShadowRoot ? root : root.head ?? root;
  if (parent.querySelector?.('style[data-topokit]')) return;
  const style = el.ownerDocument.createElement('style');
  style.dataset.topokit = '';
  style.textContent = CSS;
  parent.append(style);
}
