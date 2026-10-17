import { describe, expect, it } from 'vitest'
import { MIN_SCALE, clampScale, clampView, dashLength, fitView, maxScale, panBy, rotateAt, toMap, toScreen, zoomAt } from '../src/mapView'

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

  it('縮放與平移都限制在範圍內', () => {
    expect(clampScale(0.01, bounds, frame)).toBe(MIN_SCALE)
    expect(clampScale(100, bounds, frame)).toBe(maxScale(bounds, frame))
    expect(clampView({ cx: -50, cy: 5000, s: 1, r: 0.5 }, bounds, frame)).toEqual({ cx: 0, cy: 2000, s: 1, r: 0.5 })
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
