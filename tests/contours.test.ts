import { describe, expect, it } from 'vitest'
import { contourLines, tm2ToLatLng, type Grid } from '../scripts/lib/contours'

/** values[row][col]，row 0 在南邊 */
const grid = (values: number[][], step = 10): Grid => ({ x0: 0, y0: 0, step, cols: values[0].length, rows: values.length, z: Float64Array.from(values.flat()) })

describe('等高線', () => {
  it('中間高的山頭：一條封閉的線，在高低兩點之間依高程內插', () => {
    const lines = contourLines(grid([[0, 0, 0], [0, 20, 0], [0, 0, 0]]), 10)
    expect(lines).toHaveLength(1)
    const [line] = lines
    expect(line[0]).toEqual(line.at(-1))
    // 四條邊的中點：(10, 5)、(15, 10)、(10, 15)、(5, 10)
    expect(new Set(line.slice(1).map(([x, y]) => `${x},${y}`))).toEqual(new Set(['10,5', '15,10', '10,15', '5,10']))
  })

  it('斜坡：一條不封閉的線，穿過整個網格', () => {
    const lines = contourLines(grid([[0, 10, 20, 30], [0, 10, 20, 30], [0, 10, 20, 30]]), 15)
    expect(lines).toHaveLength(1)
    expect(lines[0].map(([x]) => x)).toEqual([15, 15, 15])
    expect(lines[0].map(([, y]) => y).sort((a, b) => a - b)).toEqual([0, 10, 20])
  })

  it('沒有資料的格子（海面）不畫：線在那裡斷開', () => {
    const lines = contourLines(grid([[0, 10], [0, 10], [NaN, 10], [0, 10], [0, 10]]), 5)
    expect(lines.map((l) => l.map(([, y]) => y))).toEqual([[0, 10], [30, 40]].map((ys) => expect.arrayContaining(ys)))
    expect(lines).toHaveLength(2)
  })

  it('鞍點：中間平均高於等高線時，兩個低的角各自被圍起來', () => {
    // 左下、右上低（0），右下、左上高（20）；平均 10 ≥ 9
    const lines = contourLines(grid([[0, 20], [20, 0]]), 9)
    expect(lines).toHaveLength(2)
    const near = (corner: [number, number]) => lines.some((l) => l.every(([x, y]) => Math.hypot(x - corner[0], y - corner[1]) < 5))
    expect(near([0, 0]) && near([10, 10])).toBe(true)
  })
})

describe('TWD97 TM2 → 經緯度', () => {
  it('中央經線上是 121 度', () => {
    expect(tm2ToLatLng([250000, 2700000])[1]).toBeCloseTo(121, 9)
  })

  it('龍洞一帶：和正算的結果差不到 0.1 公尺', () => {
    const [lat, lng] = tm2ToLatLng([341302.3574, 2776694.5368])
    expect(Math.abs(lat - 25.0958) * 111000).toBeLessThan(0.1)
    expect(Math.abs(lng - 121.9052) * 101000).toBeLessThan(0.1)
  })
})
