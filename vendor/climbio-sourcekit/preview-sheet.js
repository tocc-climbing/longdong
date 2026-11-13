// 合成預覽圖 preview.jpg：一個岩場只要這一個「下載照片前先看的圖」。
//   紅點貓收這本時先下載它：卡片用上半、下載進度的小圖用下半（照片下載到哪，小圖就亮到哪）；不另外存縮圖檔。
//   版面（常數、位置）在 preview-layout.js；這裡是用瀏覽器畫布畫、裁。
// 只用 createImageBitmap／OffscreenCanvas：Studio、擴充功能的 service worker、紅點貓都共用這一份。
// English: canvas side of the composite preview image (cover on top, one small tile per photo below).
import { COVER_H, COVER_RECT, PREVIEW_W, previewSize, tileRect } from './preview-layout.js';

export * from './preview-layout.js';

/** 照片填滿 (x, y, w, h)、多的裁掉（置中） */
export function drawFit(g, bmp, x, y, w, h) {
  const k = Math.max(w / bmp.width, h / bmp.height);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(bmp, x + (w - bmp.width * k) / 2, y + (h - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  g.restore();
}

/** 預覽圖的空白畫布（底色已塗）：照片一張一張畫上去，不用同時全部解開 */
export function newSheet(n) {
  const { w, h } = previewSize(n), canvas = new OffscreenCanvas(w, h), g = canvas.getContext('2d');
  g.fillStyle = '#e9eff4';
  g.fillRect(0, 0, w, h);
  return { canvas, g };
}
/** 第 i 張照片畫上去（第 0 張也畫入口照片） */
export function paintSheet({ g }, i, bmp) {
  if (i === 0) drawFit(g, bmp, COVER_RECT.x, COVER_RECT.y, COVER_RECT.w, COVER_RECT.h);
  const t = tileRect(i);
  drawFit(g, bmp, t.x, t.y, t.w, t.h);
}
/** 一張一張解開照片 Blob（依序，同時只解一張）→ 預覽圖 JPEG */
export async function buildSheet(blobs, quality = 0.8) {
  const sheet = newSheet(blobs.length);
  for (const [i, blob] of blobs.entries()) {
    const bmp = await createImageBitmap(blob);
    try { paintSheet(sheet, i, bmp); } finally { bmp.close(); }
  }
  return sheet.canvas.convertToBlob({ type: 'image/jpeg', quality });
}

/** 預覽圖的上半（入口照片，寬 preview.w、高 preview.tile.y）裁成一張 JPEG：卡片和岩場頁橫幅用 */
export async function cropCover(blob, preview, quality = 0.88) {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(preview.w, preview.tile.y);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } finally { bmp.close(); }
}
