import { describe, expect, it } from 'vitest'
import { centeredBox, pathLength, Placer, pointAlong, smoothPath, textWidth, type Pt } from '../src/topo/annotate'

const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number)

describe('標記的曲線', () => {
  it('兩個點是直線；三個以上通過每一個點', () => {
    expect(smoothPath([[0, 0], [10, 0]])).toBe('M0 0L10 0')
    const pts: Pt[] = [[0, 0], [100, 40], [200, 0], [300, 60]]
    const d = smoothPath(pts)
    expect(d.startsWith('M0 0C')).toBe(true)
    // 每一段三次貝茲的終點就是下一個標記的點
    const ends = [...d.matchAll(/C[^C]*?(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)(?=C|$)/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(ends).toEqual([[100, 40], [200, 0], [300, 60]])
  })

  it('直線上的點畫出來還是直的；重疊的點不會產生 NaN', () => {
    expect(nums(smoothPath([[0, 0], [50, 0], [100, 0]])).every((n) => n === 0 || n > 0)).toBe(true)
    expect(smoothPath([[0, 0], [50, 0], [100, 0]])).not.toContain('NaN')
    expect(smoothPath([[5, 5], [5, 5], [5, 5]])).not.toContain('NaN')
  })

  it('折線的長度與依比例的位置', () => {
    const line: Pt[] = [[0, 0], [100, 0], [100, 100]]
    expect(pathLength(line)).toBe(200)
    expect(pointAlong(line, 0)).toEqual([0, 0])
    expect(pointAlong(line, 0.25)).toEqual([50, 0])
    expect(pointAlong(line, 0.75)).toEqual([100, 50])
    expect(pointAlong(line, 1)).toEqual([100, 100])
  })
})

describe('牌子的自動排版', () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 1000 }

  it('依優先順序放：第一個候選位置不重疊就放那裡，重疊就換下一個', () => {
    const placer = new Placer(bounds, 0)
    const first = placer.place([centeredBox([500, 500], 40, 20)])
    expect(first).toEqual({ x: 480, y: 490, w: 40, h: 20 })
    const second = placer.place([centeredBox([510, 500], 40, 20), centeredBox([600, 500], 40, 20)])
    expect(second?.x).toBe(580)
  })

  it('全部重疊就藏起來；強制（選到的路線）時放第一個候選位置', () => {
    const placer = new Placer(bounds, 0)
    placer.place([centeredBox([500, 500], 40, 20)])
    expect(placer.place([centeredBox([505, 500], 40, 20)])).toBeUndefined()
    expect(placer.place([centeredBox([505, 500], 40, 20)], true)).toBeDefined()
  })

  it('超出照片（裁切）範圍的位置不放', () => {
    const placer = new Placer(bounds, 0)
    expect(placer.place([centeredBox([5, 500], 40, 20)])).toBeUndefined()
    expect(placer.place([centeredBox([5, 500], 40, 20), centeredBox([100, 500], 40, 20)])?.x).toBe(80)
  })

  it('縮小時（牌子占的照片像素變多）重疊的藏起來，放大後都放得下', () => {
    // 兩個編號牌的位置相距 60 個照片像素；牌子寬 24 螢幕像素：k 是一個螢幕像素等於幾個照片像素
    const visible = (k: number) => {
      const placer = new Placer(bounds, 3 * k)
      const a = placer.place([centeredBox([400, 500], 24 * k, 20 * k)])
      const b = placer.place([centeredBox([460, 500], 24 * k, 20 * k)])
      return [a, b].filter(Boolean).length
    }
    expect(visible(4)).toBe(1) // 縮小：兩個牌子在畫面上只差 15 像素，後面的藏起來
    expect(visible(1)).toBe(2) // 放大：差 60 像素，放得下
  })

  it('文字寬度：中文一個字約一個字高，英數約 0.6', () => {
    expect(textWidth('龍洞', 10)).toBe(20)
    expect(textWidth('B01', 10)).toBeCloseTo(18)
  })
})
