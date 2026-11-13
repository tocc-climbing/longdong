// 合成預覽圖 preview.jpg 的版面：只有常數和純函式，不碰畫布，Node（站台建置）、瀏覽器都能用。
//   上面：入口照片（4:3，960×720）；下面：每張照片的小圖排成格子（120×90，每列 8 格）。
//   組合的 props.preview 記圖檔和格子的位置，照片項目的 props.tile 是第幾格（見 format/VOCABULARY.md）。
//   畫圖在 preview-sheet.js（瀏覽器畫布）；站台建置用自己的影像工具，照這裡的位置畫。
// English: layout of the composite preview image (pure; no canvas).

export const PREVIEW = 'preview.jpg';
export const PREVIEW_W = 960, COVER_H = 720, TILE_W = 120, TILE_H = 90, TILE_COLS = 8;

/** n 張照片的合成預覽圖大小 */
export const previewSize = (n) => ({ w: PREVIEW_W, h: COVER_H + Math.ceil(n / TILE_COLS) * TILE_H });
/** 組合的 props.preview：n 張照片（count 是格子數：組合底下還有別的組合時，照片項目不在這一層，讀的人靠它知道有幾格） */
export function previewProps(n, href = PREVIEW) {
  const { w, h } = previewSize(n);
  return { href, w, h, count: n, tile: { w: TILE_W, h: TILE_H, cols: TILE_COLS, y: COVER_H } };
}
/** 第 i 張照片在預覽圖上的格子位置（像素）；i 從 0 開始 */
export const tileRect = (i) => ({ x: (i % TILE_COLS) * TILE_W, y: COVER_H + Math.floor(i / TILE_COLS) * TILE_H, w: TILE_W, h: TILE_H });
/** 入口照片的位置（上面那塊）：第 0 張照片同時畫在這裡 */
export const COVER_RECT = { x: 0, y: 0, w: PREVIEW_W, h: COVER_H };
