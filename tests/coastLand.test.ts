import { describe, expect, it } from 'vitest'
import { coastLand, joinWays } from '../scripts/lib/coastLand'

const box = { west: 0, south: 0, east: 10, north: 10 }

describe('coastLand', () => {
  it('首尾相接的海岸線接成一條', () => {
    expect(joinWays([[[2, 0], [3, 0]], [[0, 0], [1, 0], [2, 0]]])).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]])
  })

  it('往西走的海岸線：陸地在左邊（南半邊），沿邊界逆時針圍起來', () => {
    expect(coastLand([[[12, 5], [-2, 5]]], box)).toEqual([[[10, 5], [0, 5], [0, 0], [10, 0], [10, 5]]])
  })

  it('反方向時陸地在北半邊', () => {
    expect(coastLand([[[-2, 5], [12, 5]]], box)).toEqual([[[0, 5], [10, 5], [10, 10], [0, 10], [0, 5]]])
  })

  it('兩段海岸線接成同一塊；範圍裡的封閉海岸線（島）各自一塊', () => {
    const island: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    // 往南走（陸地在東）與往北走（陸地在西）：中間 3–7 是陸地
    expect(coastLand([[[3, 12], [3, -2]], [[7, -2], [7, 12]], island], box)).toEqual([[[3, 10], [3, 0], [7, 0], [7, 10], [3, 10]], island])
  })
})
