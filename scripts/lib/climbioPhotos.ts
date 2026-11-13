import { createCanvas, loadImage, type Image } from '@napi-rs/canvas'
import { fitSize, QUALITY, TOPO_EDGE } from '../../vendor/climbio-sourcekit/photo-size.js'
import { COVER_RECT, previewSize, tileRect, type Rect } from '../../vendor/climbio-sourcekit/preview-layout.js'

/**
 * 岩場站出口的照片處理：照 sourcekit 的規則，Topo 照片長邊縮到 TOPO_EDGE（1600），紅點貓匯入時下載才快；
 * 網站上存的原圖不動，只有出口的副本縮小。座標在 v2 是照片像素，縮小後的 w、h 要跟圖檔一致，所以回傳新的大小。
 */
export async function shrinkForExport(bytes: Buffer, ext: 'webp' | 'jpg', width: number, height: number): Promise<{ bytes: Buffer; width: number; height: number }> {
  const size = fitSize(width, height, TOPO_EDGE)
  if (size.w === width && size.h === height) return { bytes, width, height }
  const img = await loadImage(bytes)
  const canvas = createCanvas(size.w, size.h)
  canvas.getContext('2d').drawImage(img, 0, 0, size.w, size.h)
  const out = ext === 'webp' ? await canvas.encode('webp', Math.round(QUALITY * 100)) : await canvas.encode('jpeg', Math.round(QUALITY * 100))
  return { bytes: out, width: size.w, height: size.h }
}

/** 照片填滿 rect、多的裁掉（置中），跟 sourcekit 的 drawFit 一樣 */
function drawFit(g: ReturnType<ReturnType<typeof createCanvas>['getContext']>, img: Image, r: Rect) {
  const k = Math.max(r.w / img.width, r.h / img.height)
  g.save()
  g.beginPath()
  g.rect(r.x, r.y, r.w, r.h)
  g.clip()
  g.drawImage(img, r.x + (r.w - img.width * k) / 2, r.y + (r.h - img.height * k) / 2, img.width * k, img.height * k)
  g.restore()
}

/** 合成預覽圖（版面見 sourcekit 的 preview-layout）：第 0 張同時是上面的入口照片，每張照片一格小圖；沒有照片就沒有 */
export async function previewSheet(photos: Buffer[]): Promise<Buffer | null> {
  if (!photos.length) return null
  const { w, h } = previewSize(photos.length)
  const canvas = createCanvas(w, h)
  const g = canvas.getContext('2d')
  g.fillStyle = '#e9eff4'
  g.fillRect(0, 0, w, h)
  for (const [i, bytes] of photos.entries()) {
    const img = await loadImage(bytes)
    if (i === 0) drawFit(g, img, COVER_RECT)
    drawFit(g, img, tileRect(i))
  }
  return canvas.encode('jpeg', Math.round(QUALITY * 100 * 0.94))
}
