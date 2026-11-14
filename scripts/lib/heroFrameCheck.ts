import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Page } from 'playwright-core'

/** 岩壁曲線的中段也須留在卡片內，且不被右上工具遮住。 */
export async function checkHeroWalls(page: Page, label: string) {
  const result = await page.locator('.area-hero').evaluate((card) => {
    const frame = card.getBoundingClientRect(), tools = card.parentElement!.querySelector('.page-tools')?.getBoundingClientRect()
    return [...card.querySelectorAll('path[data-wall="strong"]')].map((path) => {
      const b = path.getBoundingClientRect()
      return !b.width && !b.height || b.left >= frame.left-1 && b.right <= frame.right+1 && b.top >= Math.max(frame.top, tools?.bottom ?? frame.top)-1 && b.bottom <= frame.bottom+1
    })
  })
  assert(result.every(Boolean), `${label}：岩壁被卡片或工具列遮住`)
}

/** 突變：只以岩壁取景，第一洞、大禮堂等區域的地形會碰到影像邊緣而被截斷。 */
export async function checkHeroFrame(page: Page, label: string) {
  const source = (await page.locator('.terrain-hero image[data-surface="all"]').getAttribute('href'))!
  const image = await loadImage(Buffer.from(source.split(',')[1], 'base64'))
  const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data
  let left = image.width, right = -1, top = image.height, bottom = -1
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (pixels[(y*image.width+x)*4+3] <= 32) continue
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  assert(right >= left, `${label}：地形空白`)
  assert(left > 0 && top > 0 && right < image.width-1 && bottom < image.height-1, `${label}：完整地形被影像邊緣截斷 ${JSON.stringify({ left, top, right, bottom, width: image.width, height: image.height })}`)
  const map = await page.locator('.terrain-hero').boundingBox()
  assert(map && Math.max((right-left)/image.width, (bottom-top)/image.height) > 0.5, `${label}：地形留白過多`)
  const home = await page.locator('.area-hero.strip').count()
  if (home) assert(map.height >= 180, `${label}：首頁地圖高度不足`)
}
