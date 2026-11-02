// mapkit 的樣式（字串）。Viewer 掛載時把它放進所在的 root（shadow root 或 document.head），只放一份。
// 顏色用 CSS 變數，使用的 App 可以在 .mk 或 <climbio-map> 上覆蓋：--mk-brand（正在畫、編輯中的線）、--mk-sea、--mk-land。
// 樣式規則移植自龍洞（MIT）src/map/map.css 的 .scale-map-frame、.sm-*。
// English: stylesheet string injected once per root; colours are CSS variables. Ported from Longdong (MIT).
export const CSS = `
.mk { --mk-brand: #119db3; --mk-sea: #ffffff; --mk-land: #efefef; }
.mk-frame { position: absolute; inset: 0; overflow: hidden; background: var(--mk-sea); touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.mk-frame:active { cursor: grabbing; }
.mk-frame > svg { display: block; }
.mk-control { display: inline-grid; place-items: center; min-width: 44px; height: 44px; padding: 0 14px; border: 0; border-radius: 999px; background: #ffffff; color: #3c4043; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); font: inherit; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
.mk-control:disabled { color: #b0b4b8; cursor: default; }
.mk-compass { position: absolute; top: 12px; right: 12px; width: 44px; padding: 0; }
.mk-compass svg { transition: transform 0.1s; }
.mk-bottom-right { position: absolute; right: 12px; bottom: var(--mk-bottom, 16px); display: grid; justify-items: end; gap: 10px; }
.mk-bottom-right .mk-locate { width: 52px; height: 52px; padding: 0; }
.mk-control.on { color: var(--mk-brand); }
.mk-zoom { display: grid; gap: 6px; }
.mk-zoom .mk-control { width: 44px; padding: 0; font-size: 1.2rem; }
@media (hover: none) { .mk-zoom { display: none; } }
.mk-legend { position: absolute; left: 12px; bottom: calc(var(--mk-bottom, 16px) + 18px); display: flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.8); font-size: 0.6875rem; line-height: 1.5; color: #3c4043; pointer-events: none; }
.mk-attribution { position: absolute; bottom: var(--mk-bottom, 16px); left: 12px; right: 72px; width: fit-content; margin: 0; padding: 0 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.75); color: #5f6368; font-size: 0.625rem; line-height: 1.4; }
.mk-attribution a { color: inherit; text-decoration: none; }
.mk-attribution a:hover { text-decoration: underline; }
.mk-bar { height: 2px; background: #3c4043; }
.mk-sea { fill: var(--mk-sea); }
.mk-land { fill: var(--mk-land); }
.mk.mk-ortho, .mk-ortho .mk-frame, .mk-ortho .mk-sea { background: #2c415a; fill: #2c415a; }
.mk-building { fill: #dcdddd; }
.mk-highway, .mk-road, .mk-tunnel { fill: none; stroke: #003f7e; stroke-linecap: round; stroke-linejoin: round; }
.mk-trail { fill: none; stroke: #356507; stroke-linecap: round; }
.mk-label { font-weight: 700; paint-order: stroke; stroke: #ffffff; stroke-width: 0.3em; stroke-linejoin: round; }
.mk-place { fill: #898989; font-weight: 600; paint-order: stroke; stroke: #ffffff; stroke-width: 0.3em; stroke-linejoin: round; }
.mk-parking-area { fill: #003f7e; }
.mk-parking { fill: #ffffff; font-weight: 700; paint-order: stroke; stroke: #003f7e; stroke-width: 3px; stroke-linejoin: round; }
.mk-boat circle { fill: #ffffff; stroke: #5dc2d0; }
.mk-boat .mk-boat-dot { fill: #5dc2d0; stroke: none; }
.mk-hoist path { fill: #309dc5; }
.mk-hoist text { fill: #ffffff; font-weight: 700; }
.mk-aid rect { fill: #0c4f8b; }
.mk-aid-link { stroke: #0c4f8b; stroke-width: 1.5; }
.mk-aid-dot { fill: #0c4f8b; }
.mk-aid path { stroke: #ffffff; fill: none; }
.mk-rescue circle { fill: #b60005; }
.mk-rescue text { fill: #fff; font-weight: 700; }
.mk-mark-gps { fill: #e46300; stroke: #ffffff; stroke-width: 1.5; }
.mk-mark-picked { fill: #7b3fe4; stroke: #ffffff; stroke-width: 1.5; }
.mk-mark-link { stroke: #7b3fe4; stroke-width: 2; stroke-dasharray: 4 3; }
.mk-mark text { fill: #ffffff; font-weight: 800; pointer-events: none; }
.mk-mark.selected .mk-mark-gps { stroke-width: 2.5; }
.mk-pick path { fill: #7b3fe4; stroke: #ffffff; stroke-width: 1.5; }
.mk-pick circle { fill: #ffffff; }
.mk-me { fill: #1a73e8; stroke: #fff; }
.mk-me-accuracy { fill: rgba(26, 115, 232, 0.15); }
.mk-area.mk-dim { opacity: 0.35; }
.mk-place-road { fill: #004080; }
.mk-place-trail { fill: #386808; }
.mk-place-sea { fill: #a8a8a8; font-style: italic; }
.mk-place-warning { fill: #b60005; font-weight: 700; }
.mk-hazard circle { fill: #b60005; stroke: #fff; stroke-width: 1.5px; }
.mk-hazard text { fill: #fff; font-weight: 900; }
.mk-hazard .mk-hazard-label { fill: #b60005; font-weight: 700; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
.mk-ortho .mk-area { fill: none; stroke-width: 2px; vector-effect: non-scaling-stroke; }
:where(.mk-line) { stroke: #e8590c; }
.mk-line path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.mk-line-stroke { stroke-width: 3px; }
.mk-line.selected .mk-line-stroke { stroke-width: 5px; }
.mk-line.draft .mk-line-stroke { stroke: var(--mk-brand); stroke-dasharray: 6 4; }
.mk-line path.mk-line-fill { fill: color-mix(in srgb, var(--mk-brand) 22%, transparent); stroke: none; }
.mk-line path.mk-line-close { stroke: var(--mk-brand); stroke-width: 2px; stroke-dasharray: 3 5; opacity: 0.6; }
.mk-line-vertex { fill: var(--mk-brand); stroke: #ffffff; stroke-width: 2px; }
:where(.mk-line-label) { fill: #e8590c; }
.mk-line-label { font-weight: 700; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; }
.mk-sector-label { fill: #3c4043; font-weight: 700; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; pointer-events: none; }
.mk-edit-ring { fill: color-mix(in srgb, var(--mk-brand) 8%, transparent); stroke: var(--mk-brand); stroke-width: 1.5px; stroke-dasharray: 5 3; }
.mk-edit-ring.selected { fill: color-mix(in srgb, var(--mk-brand) 20%, transparent); stroke-width: 2.5px; stroke-dasharray: none; }
.mk-handle { fill: #ffffff; stroke: var(--mk-brand); stroke-width: 2.5px; cursor: grab; touch-action: none; }
.mk-handle.dragging { fill: var(--mk-brand); cursor: grabbing; }
.mk-handle-mid { fill: rgba(255, 255, 255, 0.8); stroke-width: 1.5px; cursor: copy; }
.mk-edit-ring.open { fill: none; }
.mk-edit-face { fill: var(--mk-brand); stroke: #fff; stroke-width: 1.5px; stroke-linecap: round; stroke-linejoin: round; }
.mk-topo { opacity: 0.45; }
`;

/** 把樣式放進 host 所在的 root（document 或 shadow root），同一個 root 只放一次 */
export function injectStyle(host) {
  const root = host.getRootNode();
  const target = root.head ?? root;
  if (target.querySelector?.('style[data-mapkit]')) return;
  const style = host.ownerDocument.createElement('style');
  style.dataset.mapkit = '';
  style.textContent = CSS;
  target.prepend(style);
}
