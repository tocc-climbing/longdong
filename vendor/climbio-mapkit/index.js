// mapkit（@climbio/mapkit）：向量地圖的看圖與編輯。Climbio 公開格式 v2 的地圖畫面（經緯度）＋圖層進、圖層出。
// 純 ES module，不用建置。Web Component <climbio-map> 另外 import './element.js'（載入就註冊）。
// English: mapkit entry. Plain ES modules, no build step.
export { MapViewer, TEXT, LINE_HIT_PX } from './view.js';
export { MapEditor, faceTrail, wallFaces, nearestOnSegment, newId } from './editor.js';
export { readMap, assertMap, pickName, pathOf, centroid, BASE_KINDS, LINE_KINDS } from './data.js';
export { renderMap, wallLabelAt, SECTOR_LABEL_SCALE } from './render.js';
export { declutter, placeLineNames, textWidth, segmentDistance } from './labels.js';
export { projection, toScreen, toMap, mapTransform, fitRectView, focusView, clampView, clampScale, maxScale, panBy, zoomAt, rotateAt, dashLength, rectOf, MIN_SCALE, STEP } from './viewport.js';
export { SOURCES, visibleTiles, tileLevel, keepContours, contourTile } from './tiles.js';
export { CSS } from './style.js';
