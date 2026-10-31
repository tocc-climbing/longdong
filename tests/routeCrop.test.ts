import { describe, expect, it } from 'vitest'
import { FULL_CROP } from '../src/topo/model'
import { clampView, routeCrop, widenCrop } from '../src/topo/viewport'

const photo = { width: 2000, height: 1500 }
const inside = (c: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => c.x >= b.x && c.y >= b.y && c.x + c.w <= b.x + b.w + 1 && c.y + c.h <= b.y + b.h + 1

describe('routeCrop', () => {
  it('沒有標記：整個裁切範圍', () => {
    expect(routeCrop(photo, FULL_CROP, undefined)).toEqual(FULL_CROP)
    expect(routeCrop(photo, FULL_CROP, { line: [] })).toEqual(FULL_CROP)
  })

  it('放大到路線附近，路線整條看得到', () => {
    const line: [number, number][] = [
      [3000, 9000],
      [3200, 6000],
      [3500, 3000],
    ]
    const c = routeCrop(photo, FULL_CROP, { line })
    expect(c.w).toBeLessThan(FULL_CROP.w)
    for (const [x, y] of line) {
      expect(x).toBeGreaterThan(c.x)
      expect(x).toBeLessThan(c.x + c.w)
      expect(y).toBeGreaterThan(c.y)
      expect(y).toBeLessThan(c.y + c.h)
    }
    expect(inside(c, FULL_CROP)).toBe(true)
  })

  it('又高又窄的路線：寬高比不會比 0.8 更窄', () => {
    const c = routeCrop(photo, FULL_CROP, { line: [[5000, 9000], [5000, 1000]] })
    const ratio = (c.w * photo.width) / (c.h * photo.height)
    expect(ratio).toBeGreaterThanOrEqual(0.79)
  })

  it('很短的路線：最多放大 2.2 倍', () => {
    const c = routeCrop(photo, FULL_CROP, { bolts: { B01: [5000, 5000] } })
    expect(c.w).toBeGreaterThanOrEqual(Math.floor(FULL_CROP.w / 2.2) - 1)
    expect(c.h).toBeGreaterThanOrEqual(Math.floor(FULL_CROP.h / 2.2) - 1)
  })

  it('靠邊的路線：裁掉另一邊，路線在畫面中間，不超出照片的裁切範圍', () => {
    const base = { x: 1000, y: 1000, w: 8000, h: 8000 }
    const line: [number, number][] = [
      [1600, 8000],
      [1700, 5000],
      [1800, 2000],
    ]
    const c = routeCrop(photo, base, { line })
    expect(inside(c, base)).toBe(true)
    expect(Math.abs(c.x + c.w / 2 - 1700)).toBeLessThan(30)
    for (const [x, y] of line) {
      expect(x).toBeGreaterThan(c.x)
      expect(x).toBeLessThan(c.x + c.w)
      expect(y).toBeGreaterThan(c.y)
      expect(y).toBeLessThan(c.y + c.h)
    }
  })

  it('示意的線（只畫一小段、從照片邊緣出去，例如 565）：整張照片', () => {
    const base = { x: 2176, y: 0, w: 5427, h: 7459 }
    const sketch = { line: [[3001, 7403], [3217, 7005], [3280, 6775], [3354, 6570]] as [number, number][] }
    expect(routeCrop({ width: 2560, height: 1711 }, base, sketch)).toEqual(base)
  })

  it('騙人的牆 566（代溝）：放大並置中', () => {
    const base = { x: 2176, y: 0, w: 5427, h: 7459 }
    const line: [number, number][] = [[3766, 7217], [3841, 6129], [3965, 5557], [4045, 5016], [4212, 4305], [4133, 3539], [4336, 2747], [4605, 2382]]
    const bolts = { A01: [4588, 2225], B01: [3335, 6427] } as Record<string, [number, number]>
    const c = routeCrop({ width: 2560, height: 1711 }, base, { line, bolts })
    expect(c.w).toBeLessThan(base.w)
    const xs = [...line, ...Object.values(bolts)].map(([x]) => x)
    expect(Math.abs(c.x + c.w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2)).toBeLessThan(60)
  })
})

describe('widenCrop', () => {
  const ratio = (c: { w: number; h: number }) => (c.w * photo.width) / (c.h * photo.height)

  it('有空間：放寬到 4:5，路線仍在中間', () => {
    const crop = { x: 4500, y: 2000, w: 1000, h: 6000 }
    const c = widenCrop(photo, crop, FULL_CROP, 0.8)
    expect(ratio(c)).toBeCloseTo(0.8, 3)
    expect(c.h).toBeCloseTo(crop.h, 3)
    expect(c.x + c.w / 2).toBeCloseTo(5000, 3)
    expect(inside(c, FULL_CROP)).toBe(true)
  })

  it('太扁：放高到 4:5', () => {
    const c = widenCrop(photo, { x: 2000, y: 4000, w: 6000, h: 2000 }, FULL_CROP, 0.8)
    expect(ratio(c)).toBeCloseTo(0.8, 3)
    expect(inside(c, FULL_CROP)).toBe(true)
  })

  it('照片的裁切範圍不夠寬：不超出裁切範圍（兩邊是卡片底色）', () => {
    const base = { x: 4000, y: 0, w: 2000, h: 10000 }
    const c = widenCrop(photo, { x: 4500, y: 1000, w: 1000, h: 8000 }, base, 0.8)
    expect(inside(c, base)).toBe(true)
    expect(ratio(c)).toBeLessThan(0.8)
  })
})

describe('clampView inset', () => {
  const stage = { w: 400, h: 800 }
  const content = { w: 400, h: 800 }
  it('沒有 inset：沒放大時不能上下移動', () => {
    expect(clampView({ scale: 1, x: 0, y: -300 }, stage, content).y).toBe(0)
  })
  it('有 inset：照片的下緣可以拖到下面的按鈕上面、上緣拖到上面的按鈕下面', () => {
    const inset = { top: 70, bottom: 80 }
    expect(clampView({ scale: 1, x: 0, y: -300 }, stage, content, inset).y).toBe(-80)
    expect(clampView({ scale: 1, x: 0, y: 300 }, stage, content, inset).y).toBe(70)
    expect(clampView({ scale: 2, x: 0, y: -2000 }, stage, content, inset).y).toBe(-480)
  })
  it('照片比舞台矮很多：已經露出來，維持置中', () => {
    expect(clampView({ scale: 1, x: 0, y: -300 }, stage, { w: 400, h: 300 }, { top: 70, bottom: 80 }).y).toBe(0)
  })
})
