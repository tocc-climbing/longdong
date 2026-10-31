import { describe, expect, it } from 'vitest'
import { sunTimes } from '../src/sun'

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
