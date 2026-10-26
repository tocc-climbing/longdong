import { describe, expect, it } from 'vitest'
import { placeLineNames } from '../src/map/lineLabels'
import type { LineName } from '../src/map/mapData'

const name = (at: [number, number], line: LineName['line'] = 'road'): LineName => ({ zh: '龍洞街', en: 'Long Dong St', tone: 'road', line, at })
const lines = (road: [number, number][][]) => ({ road, highway: [], tunnel: [], trail: [] })
const frame = { w: 400, h: 300 }
const same = (p: [number, number]) => p

describe('道路、步道的名稱沿著線排', () => {
  it('放在畫面裡那段線的中點，文字由左往右', () => {
    const [p] = placeLineNames([name([0, 0])], lines([[[50, 100], [350, 100]]]), same, frame, () => 100)
    expect(p.points[0]).toEqual([150, 100])
    expect(p.points[p.points.length - 1]).toEqual([250, 100])
  })

  it('線往左走時反過來，文字保持朝上', () => {
    const [p] = placeLineNames([name([0, 0])], lines([[[350, 100], [50, 100]]]), same, frame, () => 100)
    expect(p.points[0][0]).toBeLessThan(p.points[p.points.length - 1][0])
  })

  it('只用完全在畫面裡的部分：線延伸到畫面外時，名稱在畫面裡那段的中點', () => {
    const [p] = placeLineNames([name([0, 0])], lines([[[-500, 100], [-100, 100], [50, 100], [350, 100], [900, 100]]]), same, frame, () => 100)
    expect(p.points[0]).toEqual([150, 100])
  })

  it('畫面裡的那段太短放不下名稱就不畫', () => {
    expect(placeLineNames([name([0, 0])], lines([[[50, 100], [120, 100]]]), same, frame, () => 100)).toEqual([])
  })

  it('找離錨點最近的那條線；同一條線只排一個名稱', () => {
    const two = lines([
      [[50, 50], [350, 50]],
      [[50, 250], [350, 250]],
    ])
    const placed = placeLineNames([name([200, 240]), name([210, 245])], two, same, frame, () => 100)
    expect(placed).toHaveLength(1)
    expect(placed[0].points[0][1]).toBe(250)
  })
})
