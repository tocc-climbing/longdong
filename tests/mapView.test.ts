import { describe, expect, it } from 'vitest'
import { MIN_SCALE, clampScale, clampView, dashLength, fitView, maxScale, panBy, viewBox, zoomAt } from '../src/mapView'

const bounds = { x: 0, y: 0, w: 1000, h: 2000 }
const frame = { w: 400, h: 400 }

describe('比例尺地圖的平移與縮放', () => {
  it('最小縮到整個範圍放進框裡', () => {
    const v = fitView(bounds, frame)
    expect(v).toEqual({ cx: 500, cy: 1000, s: 5 })
    const box = viewBox(v, frame)
    expect(box.w).toBeGreaterThanOrEqual(bounds.w)
    expect(box.h).toBeGreaterThanOrEqual(bounds.h)
  })

  it('縮放時，指定的那一點下面的地圖位置不動', () => {
    const v = { cx: 500, cy: 1000, s: 2 }
    const at = { x: 300, y: 100 }
    const mapPoint = (w: typeof v) => [w.cx + (at.x - frame.w / 2) * w.s, w.cy + (at.y - frame.h / 2) * w.s]
    const zoomed = zoomAt(v, frame, at, 0.5)
    expect(zoomed.s).toBe(0.5)
    expect(mapPoint(zoomed)).toEqual(mapPoint(v))
  })

  it('拖曳時地圖跟著手指走：往右拖，畫面中心往西移', () => {
    expect(panBy({ cx: 500, cy: 1000, s: 2 }, 10, -5)).toEqual({ cx: 480, cy: 1010, s: 2 })
  })

  it('縮放與平移都限制在範圍內', () => {
    expect(clampScale(0.01, bounds, frame)).toBe(MIN_SCALE)
    expect(clampScale(100, bounds, frame)).toBe(maxScale(bounds, frame))
    expect(clampView({ cx: -50, cy: 5000, s: 1 }, bounds, frame)).toEqual({ cx: 0, cy: 2000, s: 1 })
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
