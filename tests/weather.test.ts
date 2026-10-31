import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { condition, HOURS, parseWeather } from '../src/weather'

/** 2026-10-31 21:15 實際讀到的 Open-Meteo 回應（weatherUrl 的參數） */
const sample = JSON.parse(readFileSync(new URL('./fixtures/open-meteo.json', import.meta.url), 'utf8'))

describe('parseWeather', () => {
  it('目前的天氣', () => {
    const w = parseWeather(sample)
    expect(w).toMatchObject({ time: '2026-10-31T21:15', temp: 23, humidity: 90, condition: 'drizzle', wind: 5.04, gust: 10.8 })
  })

  it('逐時預報從下一個整點開始，共 12 小時', () => {
    const { hours } = parseWeather(sample)
    expect(hours).toHaveLength(HOURS)
    expect(hours[0]).toEqual({ time: '2026-10-31T22:00', temp: 23, rain: 65, condition: 'drizzle' })
    expect(hours.at(-1)!.time).toBe('2026-11-01T09:00')
  })

  it('剛好在整點時，從下一個小時開始', () => {
    const w = parseWeather({ ...sample, current: { ...sample.current, time: '2026-10-31T22:00' } })
    expect(w.hours[0].time).toBe('2026-10-31T23:00')
  })

  it('預報不足 12 小時時丟出錯誤', () => {
    const late = { ...sample, current: { ...sample.current, time: '2026-11-01T14:00' } }
    expect(() => parseWeather(late)).toThrow('逐時預報不足')
  })

  it('缺欄位時丟出錯誤', () => {
    expect(() => parseWeather({ current: sample.current })).toThrow()
  })
})

describe('condition', () => {
  it.each([
    [0, 'clear'],
    [2, 'partly'],
    [3, 'cloudy'],
    [45, 'fog'],
    [53, 'drizzle'],
    [63, 'rain'],
    [81, 'rain'],
    [95, 'thunder'],
  ])('%i → %s', (code, expected) => {
    expect(condition(code)).toBe(expected)
  })

  it('不認得的代碼丟出錯誤', () => {
    expect(() => condition(4)).toThrow('不認得的天氣代碼')
  })
})
