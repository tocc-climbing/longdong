// 外部資料來源（龍洞、theCrag、OpenClimbing…）的 Topo 照片尺寸：所有來源共用這一份，不要在各處再寫一個常數。
// 只用 createImageBitmap／OffscreenCanvas，網頁和擴充功能的 service worker 都能跑。
// English: one size policy for imported topo photos (long edge <= TOPO_EDGE), shared by every external source.

/** 外部 Topo 照片長邊上限（像素）：手機上看夠了，原圖有好幾 MB 傳很慢 */
export const TOPO_EDGE = 1600;
/** 向 Wikimedia Commons 要的縮圖寬度：Commons 只出標準寬度（…1280、1920…），1600 會被換成 1920，所以要 1920 再自己縮到 TOPO_EDGE */
export const COMMONS_REQUEST_WIDTH = 1920;
/** 縮圖重新編碼的 JPEG 品質 */
export const QUALITY = 0.85;

/** 長邊縮到 edge 以內（不放大）的大小 { w, h }；寬高缺值就回 undefined 欄位 */
export function fitSize(w, h, edge = TOPO_EDGE) {
  if (!(w > 0) || !(h > 0)) return { w, h };
  const k = Math.min(1, edge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * 圖片 Blob → { blob, w, h }：長邊超過 edge 的縮小，不是 JPEG／PNG 的轉成 JPEG，其他原樣。
 * size 給了就縮成剛好這個大小（文件裡已經寫了 w、h，座標照它算，圖要對得上）；沒給就依圖片自己的大小算。
 */
export async function fitImage(blob, { edge = TOPO_EDGE, size } = {}) {
  const bitmap = await createImageBitmap(blob);
  try {
    const { w, h } = size ?? fitSize(bitmap.width, bitmap.height, edge);
    const keepType = blob.type === 'image/jpeg' || blob.type === 'image/png';
    if (w === bitmap.width && h === bitmap.height && keepType) return { blob, w, h };
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
    return { blob: await canvas.convertToBlob(type === 'image/png' ? { type } : { type, quality: QUALITY }), w, h };
  } finally { bitmap.close(); }
}
