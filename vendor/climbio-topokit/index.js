// TopoKit（@climbio/topokit）：戶外 Topo 的看圖與編輯。Climbio 公開格式 v2 的照片畫面＋圖層進、圖層出，座標是照片像素。
// 純 ES module，不用建置。Web Component <climbio-topo> 另外 import './element.js'（載入就註冊）。
// English: TopoKit entry. Plain ES modules, no build step.
export { TopoViewer, DRAG_PX } from './view.js';
export { TopoEditor } from './editor.js';
export { readTopo, writeLayer, assertView, pickName, pickGrade, newId } from './data.js';
export { renderLines, renderReveal } from './render.js';
export { drawnRuns, ownRuns, segmentAt, addLinePoint, forkLine, moveSharedPoint, removeLinePoint } from './lines.js';
export { smoothPath, pathLength, pointAlong, textWidth, wrapText, Placer } from './annotate.js';
export { clampView, moveView, focusView, fitSize, routeCrop, isSketch, doubleTapView, isDoubleTap, IDENTITY, MAX_SCALE, DOUBLE_TAP_SCALE, swipeStep } from './viewport.js';
export { CSS } from './style.js';
