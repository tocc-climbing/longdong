import { describe, expect, it } from 'vitest'
import { smoothRing } from '../src/components/AreaShape'

describe('標題卡的區域形狀修圓角', () => {
  it('切角兩次：方形的四個尖角都不在了，點都在原本的範圍內', () => {
    const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const r = smoothRing(square)
    expect(r).toHaveLength(16)
    for (const corner of square) expect(r.some(([x, y]) => x === corner[0] && y === corner[1])).toBe(false)
    expect(r.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100)).toBe(true)
  })
})
