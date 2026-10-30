import { describe, expect, it } from 'vitest'
import { heroFit, rotate, type FitBox, type Pt } from '../src/map/heroFit'

const box: FitBox = { w: 160, h: 200, top: 40, right: 10, bottom: 10, left: 10 }

/** 點在畫面上的位置（px）：轉過去後套 viewBox */
const onScreen = (p: Pt, fit: NonNullable<ReturnType<typeof heroFit>>): Pt => {
  const [x, y] = rotate(p, fit.angle)
  const [vx, vy, vw] = fit.viewBox
  const k = box.w / vw
  return [(x - vx) * k, (y - vy) * k]
}

describe('標題卡的地圖', () => {
  it('岩壁整個在框裡扣掉空白的地方（不被上方的圖示蓋住），viewBox 和框同比例', () => {
    const wall: Pt[] = [[0, 0], [30, 5], [60, 0], [80, 20]]
    const fit = heroFit(wall, box)!
    expect(fit.viewBox[2] / fit.viewBox[3]).toBeCloseTo(box.w / box.h)
    for (const p of wall) {
      const [x, y] = onScreen(p, fit)
      expect(x).toBeGreaterThanOrEqual(box.left - 0.01)
      expect(x).toBeLessThanOrEqual(box.w - box.right + 0.01)
      expect(y).toBeGreaterThanOrEqual(box.top - 0.01)
      expect(y).toBeLessThanOrEqual(box.h - box.bottom + 0.01)
    }
  })

  it('橫的岩壁放進直的框：轉個方向，比北邊朝上放得大', () => {
    const wall: Pt[] = [[0, 0], [100, 0]]
    const fit = heroFit(wall, box)!
    expect(fit.angle).not.toBe(0)
    // 不轉時最長只有框裡的寬度
    const [a, b] = wall.map((p) => onScreen(p, fit))
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan((box.w - box.left - box.right) * 1.2)
  })

  it('差不多大時不轉（北邊朝上）', () => {
    const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    expect(heroFit(square, { ...box, h: 160, top: 10 })!.angle).toBe(0)
  })

  it('spread：範圍放大，岩壁變小、看得到旁邊；minSpan：很短的岩壁不會放到太大', () => {
    const wall: Pt[] = [[0, 0], [0, 50]]
    const tight = heroFit(wall, box)!
    const wide = heroFit(wall, box, { spread: 2 })!
    expect(wide.viewBox[2]).toBeCloseTo(tight.viewBox[2] * 2)
    const tiny = heroFit([[0, 0], [0, 1]], box, { minSpan: 20 })!
    expect(tiny.viewBox[3]).toBeGreaterThan(20)
  })

  it('沒有點：不畫', () => {
    expect(heroFit([], box)).toBeUndefined()
  })
})
