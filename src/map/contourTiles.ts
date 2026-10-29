import { useEffect, useState } from 'react'

/**
 * 1/5000 基本地形圖（B5000 圖磚）只留等高線與海岸線：圖磚的等高線是洋紅色（255, 0, 255）、海岸線（水涯線）是藍色（0, 0, 255），
 * 高程點、注記是黑色；等高線換成 CONTOUR_RGB、海岸線換成 COAST_RGB，其他全部透明。圖磚以 CORS 載入（伺服器允許）才讀得到像素。
 */
export const CONTOUR_RGB: readonly [number, number, number] = [255, 150, 40]
export const COAST_RGB: readonly [number, number, number] = [60, 170, 255]

/** 就地改寫 RGBA 像素：等高線、海岸線換色，其他透明 */
export function keepContours(px: Uint8ClampedArray): void {
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]]
    const to = r === 255 && g === 0 && b === 255 ? CONTOUR_RGB : r === 0 && g === 0 && b === 255 ? COAST_RGB : undefined
    if (to) [px[i], px[i + 1], px[i + 2]] = to
    else px[i + 3] = 0
  }
}

/** 圖磚網址 → 只有等高線與海岸線的圖（object URL）；同一張只處理一次 */
const cache = new Map<string, Promise<string>>()

function contourTile(href: string): Promise<string> {
  let p = cache.get(href)
  if (!p) {
    p = new Promise<string>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const g = canvas.getContext('2d')!
        g.drawImage(img, 0, 0)
        const data = g.getImageData(0, 0, canvas.width, canvas.height)
        keepContours(data.data)
        g.putImageData(data, 0, 0)
        canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error(`等高線圖磚轉換失敗：${href}`))))
      }
      img.onerror = () => reject(new Error(`等高線圖磚載入失敗：${href}`))
      img.src = href
    })
    // 失敗的不留著，下次看到這張圖磚再試
    p.catch((err: unknown) => {
      cache.delete(href)
      console.warn(err)
    })
    cache.set(href, p)
  }
  return p
}

/** 圖磚網址 → 處理好的圖（還沒好的不在裡面） */
export function useContourTiles(hrefs: string[]): Record<string, string> {
  const [ready, setReady] = useState<Record<string, string>>({})
  // 依賴網址組成的字串：陣列每次畫面更新都是新的
  const key = hrefs.join(' ')
  useEffect(() => {
    let alive = true
    for (const href of hrefs) {
      if (ready[href]) continue
      contourTile(href).then(
        (url) => alive && setReady((r) => (r[href] ? r : { ...r, [href]: url })),
        // 錯誤在 contourTile 記下了；這張圖磚不畫
        () => undefined,
      )
    }
    return () => {
      alive = false
    }
  }, [key])
  return ready
}
