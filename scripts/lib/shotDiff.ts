import { createCanvas, loadImage } from '@napi-rs/canvas'
import { chromium, type Browser } from 'playwright-core'

/** 截圖基準（topo-shots、map-shots）共用：逐像素比對與啟動瀏覽器 */

/**
 * 兩張 PNG 的差異像素比例（任一色差超過 24 才算不同）。
 * near：附近 ±near 個像素內找得到顏色相同的點就算相同（座標進位到不同單位，線、邊緣差不到一個像素；版面差了還是會被抓到）。
 */
export async function diff(actual: Buffer, expected: Buffer, near = 0): Promise<{ ratio: number; image?: Buffer }> {
  const [a, b] = [await loadImage(actual), await loadImage(expected)]
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1 }
  const read = (img: typeof a) => {
    const cv = createCanvas(img.width, img.height)
    const cx = cv.getContext('2d')
    cx.drawImage(img, 0, 0)
    return cx.getImageData(0, 0, img.width, img.height).data
  }
  const [da, db] = [read(a), read(b)]
  const out = createCanvas(a.width, a.height)
  const octx = out.getContext('2d')
  const o = octx.createImageData(a.width, a.height)
  let bad = 0
  const [w, h] = [a.width, a.height]
  const close = (i: number, j: number) => Math.max(Math.abs(da[i] - db[j]), Math.abs(da[i + 1] - db[j + 1]), Math.abs(da[i + 2] - db[j + 2])) <= 24
  const same = (i: number) => {
    if (close(i, i)) return true
    const [x, y] = [(i / 4) % w, Math.floor(i / 4 / w)]
    for (let dy = -near; dy <= near; dy++)
      for (let dx = -near; dx <= near; dx++) {
        const [xx, yy] = [x + dx, y + dy]
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && close(i, (yy * w + xx) * 4)) return true
      }
    return false
  }
  for (let i = 0; i < da.length; i += 4) {
    const hit = !same(i)
    if (hit) bad++
    o.data.set(hit ? [255, 0, 255, 255] : [da[i], da[i + 1], da[i + 2], 80], i)
  }
  octx.putImageData(o, 0, 0)
  return { ratio: bad / (da.length / 4), image: out.toBuffer('image/png') }
}

/** 差異像素超過這個比例就算外觀不同（字型反鋸齒的差異以內） */
export const TOLERANCE = 0.002

export async function launch(): Promise<Browser> {
  for (const channel of [process.env.BROWSER_CHANNEL, 'chrome', 'msedge'].filter(Boolean) as string[]) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch {
      /* 試下一個 */
    }
  }
  throw new Error('找不到 Chrome 或 Edge（可用 BROWSER_CHANNEL 指定）')
}
