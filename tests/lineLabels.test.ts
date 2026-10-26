import { describe, expect, it } from 'vitest'
import { placeLineNames } from '../src/map/lineLabels'
import type { LineName } from '../src/map/mapData'

const name = (at: [number, number], line: LineName['line'] = 'road'): LineName => ({ zh: '龍洞街', en: 'Long Dong St', tone: 'road', line, at })
const lines = (road: [number, number][][]) => ({ road, highway: [], tunnel: [], trail: [] })
const frame = { w: 400, h: 300 }
const same = (p: [number, number]) => p
const road = lines([[[50, 100], [350, 100]]])

describe('道路、步道的名稱沿著線排，位置固定在地圖上', () => {
  it('中心在錨點投影到線上的位置，文字由左往右', () => {
    const [p] = placeLineNames([name([180, 90])], road, same, frame, () => 100)
    expect(p.points[0]).toEqual([130, 100])
    expect(p.points[p.points.length - 1]).toEqual([230, 100])
  })

  it('平移時跟著地圖走，不會在線上滑動', () => {
    const shift = (dx: number) => (p: [number, number]): [number, number] => [p[0] + dx, p[1]]
    const [a] = placeLineNames([name([180, 90])], road, shift(0), frame, () => 100)
    const [b] = placeLineNames([name([180, 90])], road, shift(-40), frame, () => 100)
    expect(b.points.map(([x, y]) => [x + 40, y])).toEqual(a.points)
  })

  it('線往左走時反過來，文字保持朝上', () => {
    const [p] = placeLineNames([name([200, 100])], lines([[[350, 100], [50, 100]]]), same, frame, () => 100)
    expect(p.points[0][0]).toBeLessThan(p.points[p.points.length - 1][0])
  })

  it('錨點的位置超出畫面時不畫，不換到別的位置', () => {
    const long = lines([[[0, 100], [2000, 100]]])
    expect(placeLineNames([name([1500, 100])], long, same, frame, () => 100)).toEqual([])
  })

  it('線太短放不下名稱就不畫', () => {
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

  it('和優先的圖示、文字（occupied）重疊時不畫', () => {
    expect(placeLineNames([name([200, 100])], road, same, frame, () => 100, [[190, 95, 210, 105]])).toEqual([])
    expect(placeLineNames([name([200, 100])], road, same, frame, () => 100, [[190, 130, 210, 140]])).toHaveLength(1)
  })

  it('文字是直的：彎的線上，名稱沿著弦排', () => {
    const slight = lines([[[50, 100], [150, 102], [250, 100], [350, 101]]])
    const [p] = placeLineNames([name([200, 100])], slight, same, frame, () => 100)
    expect(p.points).toHaveLength(2)
  })

  it('錨點那一段彎得太厲害時，往旁邊沿線找夠直的一段', () => {
    // 錨點附近來回折，右邊是直線
    const zigzag = lines([[[50, 100], [70, 140], [90, 100], [110, 140], [130, 100], [260, 100], [350, 100]]])
    const [p] = placeLineNames([name([110, 120])], zigzag, same, frame, () => 60)
    // 線上夠直的那一段（右邊的直線），不是錨點那邊的來回折
    expect(Math.abs(p.points[0][1] - 100)).toBeLessThan(4)
    expect(Math.abs(p.points[1][1] - 100)).toBeLessThan(4)
    expect(p.points[0][0]).toBeGreaterThan(125)
  })

  it('整條線都彎得太厲害就不畫', () => {
    const zigzag = lines([[[50, 100], [70, 140], [90, 100], [110, 140], [130, 100], [150, 140], [170, 100], [190, 140], [210, 100]]])
    expect(placeLineNames([name([110, 120])], zigzag, same, frame, () => 60)).toEqual([])
  })

  it('斜的名稱只佔沿線的範圍：旁邊的空位不算重疊', () => {
    const diagonal = lines([[[50, 50], [250, 250]]])
    expect(placeLineNames([name([150, 150])], diagonal, same, frame, () => 100, [[190, 60, 240, 100]])).toHaveLength(1)
  })

  it('步道的名稱先排，重疊時道路的名稱不畫', () => {
    const both = { road: [[[50, 100], [350, 100]]] as [number, number][][], trail: [[[50, 104], [350, 104]]] as [number, number][][], highway: [], tunnel: [] }
    const placed = placeLineNames([name([200, 100], 'road'), { ...name([200, 104], 'trail'), tone: 'trail' }], both, same, frame, () => 280)
    expect(placed.map((p) => p.name.line)).toEqual(['trail'])
  })
})
