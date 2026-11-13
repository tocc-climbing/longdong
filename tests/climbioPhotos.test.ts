import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { validate } from '../vendor/climbio-format/format'
import { previewSize } from '../vendor/climbio-sourcekit/preview-layout.js'
import { cragSet, PACK_FILE } from '../scripts/lib/climbio'
import { longdongMap } from '../scripts/lib/climbioMap'
import { previewSheet, shrinkForExport } from '../scripts/lib/climbioPhotos'
import type { Dataset } from '../src/data/schema'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const png = async (w: number, h: number, color: string) => {
  const c = createCanvas(w, h)
  const g = c.getContext('2d')
  g.fillStyle = color
  g.fillRect(0, 0, w, h)
  return c.encode('png')
}

describe('出口的照片：長邊 1600（sourcekit）', () => {
  it('超過就縮小，w、h 跟圖檔一致；不超過原樣不動', async () => {
    const big = await shrinkForExport(await png(3200, 2400, '#c33'), 'jpg', 3200, 2400)
    expect([big.width, big.height]).toEqual([1600, 1200])
    const img = await loadImage(big.bytes)
    expect([img.width, img.height]).toEqual([1600, 1200])
    const small = await png(800, 600, '#3c3')
    expect(await shrinkForExport(small, 'webp', 800, 600)).toEqual({ bytes: small, width: 800, height: 600 })
  })

  it('直式照片也是長邊 1600', async () => {
    const tall = await shrinkForExport(await png(2400, 3200, '#33c'), 'webp', 2400, 3200)
    expect([tall.width, tall.height]).toEqual([1200, 1600])
  })
})

describe('合成預覽圖', () => {
  it('大小照 sourcekit 的版面；沒有照片就沒有', async () => {
    expect(await previewSheet([])).toBeNull()
    const sheet = await previewSheet([await png(1600, 1200, '#c33'), await png(900, 1200, '#3c3'), await png(1200, 900, '#33c')])
    const img = await loadImage(sheet!)
    expect([img.width, img.height]).toEqual([previewSize(3).w, previewSize(3).h])
  })
})

describe('岩場組合的 props', () => {
  const dataset = JSON.parse(readFileSync(resolve(__dirname, '..', 'public/data/longdong.json'), 'utf8')) as Dataset
  const map = longdongMap(dataset, undefined, false)
  const common = { dataUrl: 'https://longdong.web.app/data/longdong.json' }

  it('有 Topo：props.preview（count 是照片數）和 props.pack 指到合併檔，通過官方驗證', () => {
    const doc = cragSet(dataset, map, common, 5)
    expect(validate(doc)).toEqual([])
    expect(doc.props).toMatchObject({ pack: { href: PACK_FILE }, preview: { href: 'preview.jpg', count: 5, tile: { cols: 8 } } })
  })

  it('沒有 Topo：不放預覽圖，合併檔照放', () => {
    expect(cragSet(dataset, map, common).props).toEqual({ pack: { href: PACK_FILE } })
  })
})
