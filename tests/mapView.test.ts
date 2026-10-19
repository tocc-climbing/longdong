import { describe, expect, it } from 'vitest'
import { MIN_SCALE, clampScale, clampView, dashLength, fitView, focusView, maxScale, panBy, rotateAt, toMap, toScreen, zoomAt } from '../src/map/mapView'

const bounds = { x: 0, y: 0, w: 1000, h: 2000 }
const frame = { w: 400, h: 400 }
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6))

describe('比例尺地圖的平移、縮放與旋轉', () => {
  it('最小縮到整個範圍放進框裡、北方朝上', () => {
    expect(fitView(bounds, frame)).toEqual({ cx: 500, cy: 1000, s: 5, r: 0 })
  })

  it('螢幕座標與地圖座標互相換算（含旋轉）', () => {
    const v = { cx: 500, cy: 1000, s: 2, r: 0.7 }
    close(toMap(v, frame, toScreen(v, frame, [123, 456])), [123, 456])
    close(toScreen(v, frame, [500, 1000]), [200, 200])
  })

  it('旋轉 90 度時，地圖的東方朝下', () => {
    const v = { cx: 0, cy: 0, s: 1, r: Math.PI / 2 }
    close(toScreen(v, frame, [10, 0]), [200, 210])
  })

  it('縮放與旋轉時，指定的那一點下面的地圖位置不動', () => {
    const v = { cx: 500, cy: 1000, s: 2, r: 0.3 }
    const at = { x: 300, y: 100 }
    const before = toMap(v, frame, [at.x, at.y])
    close(toMap(zoomAt(v, frame, at, 0.5), frame, [at.x, at.y]), before)
    close(toMap(rotateAt(v, frame, at, 1.2), frame, [at.x, at.y]), before)
  })

  it('拖曳時地圖跟著手指走（旋轉後也一樣）', () => {
    expect(panBy({ cx: 500, cy: 1000, s: 2, r: 0 }, 10, -5)).toEqual({ cx: 480, cy: 1010, s: 2, r: 0 })
    const v = { cx: 500, cy: 1000, s: 2, r: 1 }
    const grab = toScreen(v, frame, [520, 990])
    const moved = panBy(v, 15, 25)
    close(toScreen(moved, frame, [520, 990]), [grab[0] + 15, grab[1] + 25])
  })

  it('最多縮到範圍的上下剛好填滿框；北方朝上時畫面上下緣不超出範圍', () => {
    const wide = { w: 800, h: 400 }
    expect(maxScale(bounds, wide)).toBe(5)
    // 每像素 1 公尺時畫面高 400 公尺：中心最多到範圍上緣往下 200 公尺
    expect(clampView({ cx: 500, cy: -50, s: 1, r: 0 }, bounds, wide)).toEqual({ cx: 500, cy: 200, s: 1, r: 0 })
    expect(clampView({ cx: 500, cy: 5000, s: 1, r: 0 }, bounds, wide)).toEqual({ cx: 500, cy: 1800, s: 1, r: 0 })
    // 縮到最小時上下剛好填滿，中心固定在範圍中間
    expect(fitView(bounds, wide, 900)).toEqual({ cx: 900, cy: 1000, s: 5, r: 0 })
  })

  it('縮放與平移都限制在範圍內', () => {
    expect(clampScale(0.01, bounds, frame)).toBe(MIN_SCALE)
    expect(clampScale(100, bounds, frame)).toBe(maxScale(bounds, frame))
    expect(clampView({ cx: -50, cy: 5000, s: 1, r: 0.5 }, bounds, frame)).toEqual({ cx: 0, cy: 2000, s: 1, r: 0.5 })
  })
})

describe('聚焦（區域、救援點）', () => {
  const bounds = { x: 0, y: 0, w: 2000, h: 1000 }
  const frame = { w: 400, h: 300 }

  it('目標放進框裡、置中', () => {
    const v = focusView({ x: 800, y: 400, w: 200, h: 100 }, bounds, frame)
    expect(v).toMatchObject({ cx: 900, cy: 450, r: 0 })
    expect(v.s).toBeCloseTo(0.5)
  })

  it('單一個點（沒有大小）放到最大，不超出縮放範圍', () => {
    expect(focusView({ x: 900, y: 450, w: 0, h: 0 }, bounds, frame).s).toBe(MIN_SCALE)
  })

  it('比整個範圍還大時縮到最小，中心留在範圍內', () => {
    const v = focusView({ x: -500, y: -500, w: 4000, h: 3000 }, bounds, frame)
    expect(v.s).toBe(maxScale(bounds, frame))
    expect(v.cy).toBeGreaterThanOrEqual(0)
    expect(v.cy).toBeLessThanOrEqual(1000)
  })
})

describe('虛線長度', () => {
  it('只取 2 的次方：小幅縮放時不變（虛線不會沿路線滑動），跨過級距才換', () => {
    expect(dashLength(3, 1)).toBe(4)
    expect(dashLength(3, 1.1)).toBe(4)
    expect(dashLength(3, 0.9)).toBe(2)
    expect(dashLength(3, 2)).toBe(8)
  })
})

describe('地圖範圍', () => {
  it('龍洞的救援點在範圍內；台北不在', async () => {
    const { inMapBounds } = await import('../src/map/bounds')
    expect(inMapBounds([25.111367, 121.922917])).toBe(true)
    expect(inMapBounds([25.0478, 121.517])).toBe(false)
  })
})
