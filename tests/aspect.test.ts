import { describe, expect, it } from 'vitest'
import type { LatLng } from '../src/geo'
import { angleBetween, faceTrail, meanFacing, photoFacing, sunWindows, wallFaces } from '../src/map/aspect'
import { project } from '../src/map/mapData'
import { sunTimes } from '../src/sun'

const A: LatLng = [25.11, 121.922]
/** 往北約 11 公尺 */
const NORTH: LatLng = [25.1101, 121.922]
/** 往東約 10 公尺 */
const EAST: LatLng = [25.11, 121.9221]

/** 經過某一點、南北向的步道（地圖座標） */
const trailThrough = (lng: number): [number, number][][] => [[project([25.109, lng]), project([25.111, lng])]]

describe('wallFaces', () => {
  it('岩壁在左手邊、岩壁面朝右手邊', () => {
    expect(wallFaces([A, NORTH])[0].bearing).toBeCloseTo(90, 0)
    expect(wallFaces([A, EAST])[0].bearing).toBeCloseTo(180, 0)
    expect(wallFaces([NORTH, A])[0].bearing).toBeCloseTo(270, 0)
  })

  it('長度是公尺', () => {
    expect(wallFaces([A, NORTH])[0].length).toBeCloseTo(11.1, 0)
  })
})

describe('faceTrail', () => {
  it('步道在右手邊（東邊）時保持原樣', () => {
    expect(faceTrail([A, NORTH], trailThrough(121.9225))).toEqual([A, NORTH])
  })

  it('步道在左手邊（西邊）時反過來，岩壁面朝西', () => {
    const line = faceTrail([A, NORTH], trailThrough(121.9215))
    expect(line).toEqual([NORTH, A])
    expect(wallFaces(line)[0].bearing).toBeCloseTo(270, 0)
  })

  it('依長度加權：長的那段決定', () => {
    // 先往北 11 公尺（步道在右手邊），再往西（步道在東南方，是左手邊）：往西的那段比較長就反過來
    const trail: [number, number][][] = [[project([25.11005, 121.9225]), project([25.11004, 121.9226])]]
    const short: LatLng = [25.1101, 121.92195]
    const long: LatLng = [25.1101, 121.9218]
    expect(faceTrail([A, NORTH, short], trail)).toEqual([A, NORTH, short])
    expect(faceTrail([A, NORTH, long], trail)).toEqual([long, NORTH, A])
  })
})

describe('meanFacing', () => {
  it('依長度加權的平均方位', () => {
    expect(meanFacing([{ bearing: 0, length: 1 }, { bearing: 90, length: 1 }])).toBeCloseTo(45, 5)
    expect(meanFacing([{ bearing: 350, length: 1 }, { bearing: 10, length: 1 }])! % 360).toBeCloseTo(0, 5)
  })

  it('沒有線段時沒有朝向', () => {
    expect(meanFacing([])).toBeUndefined()
  })
})

describe('photoFacing', () => {
  it('相機朝西拍：岩壁朝東；多張取平均', () => {
    expect(photoFacing([270])).toBeCloseTo(90, 5)
    expect(photoFacing([250, 290])).toBeCloseTo(90, 5)
  })

  it('沒有照片：沒有朝向', () => {
    expect(photoFacing([])).toBeUndefined()
  })
})

describe('angleBetween', () => {
  it('跨過正北也算得對', () => {
    expect(angleBetween(350, 10)).toBeCloseTo(20, 5)
    expect(angleBetween(90, 270)).toBeCloseTo(180, 5)
  })
})

describe('sunWindows', () => {
  const minutes = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000
  const noonOf = (date: string) => {
    const { rise, set } = sunTimes(date, A)
    return new Date((rise.getTime() + set.getTime()) / 2)
  }

  it('朝東的岩壁：日出到正午', () => {
    const date = '2026-03-20'
    const [w, ...rest] = sunWindows(date, wallFaces([A, NORTH]), A)
    expect(rest).toEqual([])
    expect(w.from).toEqual(sunTimes(date, A).rise)
    expect(minutes(w.to, noonOf(date))).toBeLessThanOrEqual(5)
  })

  it('朝西的岩壁：正午到日落', () => {
    const date = '2026-03-20'
    const [w, ...rest] = sunWindows(date, wallFaces([NORTH, A]), A)
    expect(rest).toEqual([])
    expect(minutes(w.from, noonOf(date))).toBeLessThanOrEqual(5)
    expect(w.to).toEqual(sunTimes(date, A).set)
  })

  it('不同方向的岩壁：曬到的部分要佔牆長一半以上', () => {
    const date = '2026-03-20'
    const faces = [
      { bearing: 90, length: 10 },
      { bearing: 270, length: 20 },
    ]
    const [w, ...rest] = sunWindows(date, faces, A)
    expect(rest).toEqual([])
    expect(minutes(w.from, noonOf(date))).toBeLessThanOrEqual(5)
  })

  it('朝北的岩壁：冬天整天曬不到，夏天清晨、傍晚各一段', () => {
    const north = wallFaces([EAST, A])
    expect(north[0].bearing).toBeCloseTo(0, 0)
    expect(sunWindows('2026-01-01', north, A)).toEqual([])
    const summer = sunWindows('2026-06-21', north, A)
    expect(summer).toHaveLength(2)
    expect(summer[0].from).toEqual(sunTimes('2026-06-21', A).rise)
    expect(summer[1].to).toEqual(sunTimes('2026-06-21', A).set)
  })
})
