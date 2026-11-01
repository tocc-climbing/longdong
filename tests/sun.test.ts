import { describe, expect, it } from 'vitest'
import { sunPosition, sunTimes } from '../src/sun'

/** 岩場入口（救援點 #2） */
const LONGDONG: [number, number] = [25.113133, 121.92035]

/** 台北時間的時:分（分鐘數） */
const minutes = (d: Date) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number)
  return h * 60 + m
}

describe('sunTimes', () => {
  // 對照：Open-Meteo 歷史資料（archive-api）同一座標的日出、日落，台北時間，到分鐘
  it.each([
    ['2026-01-01', '06:37', '17:14'],
    ['2026-03-21', '05:55', '18:03'],
    ['2026-06-21', '05:03', '18:45'],
    ['2026-09-22', '05:40', '17:49'],
    ['2026-10-20', '05:52', '17:21'],
  ])('%s 日出 %s、日落 %s（誤差一分鐘內）', (date, rise, set) => {
    const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
    const sun = sunTimes(date, LONGDONG)
    expect(Math.abs(minutes(sun.rise) - toMin(rise))).toBeLessThanOrEqual(1)
    expect(Math.abs(minutes(sun.set) - toMin(set))).toBeLessThanOrEqual(1)
  })

  it('是那一天的日出，不是前一天或後一天', () => {
    const sun = sunTimes('2026-10-31', LONGDONG)
    const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d)
    expect(day(sun.rise)).toBe('2026-10-31')
    expect(day(sun.set)).toBe('2026-10-31')
  })
})

describe('sunPosition', () => {
  it('日出、日落那一刻太陽在地平線下 0.833 度（上緣含折射剛好碰到地平線；0.25 度約一分鐘）', () => {
    for (const date of ['2026-01-01', '2026-06-21', '2026-10-20']) {
      const { rise, set } = sunTimes(date, LONGDONG)
      expect(Math.abs(sunPosition(rise, LONGDONG).altitude + 0.833)).toBeLessThan(0.25)
      expect(Math.abs(sunPosition(set, LONGDONG).altitude + 0.833)).toBeLessThan(0.25)
    }
  })

  it('夏至日出在東北偏東（約 64 度）、日落在西北偏西（約 296 度）', () => {
    const { rise, set } = sunTimes('2026-06-21', LONGDONG)
    expect(Math.abs(sunPosition(rise, LONGDONG).azimuth - 64)).toBeLessThan(1)
    expect(Math.abs(sunPosition(set, LONGDONG).azimuth - 296)).toBeLessThan(1)
  })

  it('春分正午在正南，高度約 90 − 緯度', () => {
    const { rise, set } = sunTimes('2026-03-20', LONGDONG)
    const noon = new Date((rise.getTime() + set.getTime()) / 2)
    const sun = sunPosition(noon, LONGDONG)
    expect(Math.abs(sun.azimuth - 180)).toBeLessThan(1)
    expect(Math.abs(sun.altitude - (90 - LONGDONG[0]))).toBeLessThan(0.5)
  })
})
