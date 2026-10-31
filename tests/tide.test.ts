import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCwaTide, TIDE_LOCATION } from '../src/tide'

/** 2026-10-31 實際讀到的氣象署回應，只留兩個地點、各三天（回應裡的日期沒有排序） */
const sample = JSON.parse(readFileSync(new URL('./fixtures/cwa-tide.json', import.meta.url), 'utf8'))
const AT = '2026-10-31T15:27:44.271Z'

/** 改掉龍洞灣公園某一天的資料 */
const withDay = (patch: (day: { TideRange: string; Time: { DateTime: string; Tide: string }[] }) => void) => {
  const copy = structuredClone(sample)
  patch(copy.records.TideForecasts.find((f: { Location: { LocationName: string } }) => f.Location.LocationName === TIDE_LOCATION).Location.TimePeriods.Daily[0])
  return copy
}

describe('parseCwaTide', () => {
  it('只取龍洞灣公園，日期排序，潮差與滿潮、乾潮', () => {
    const tide = parseCwaTide(sample, AT)
    expect(tide.location).toBe('海水浴場龍洞灣公園')
    expect(tide.fetchedAt).toBe(AT)
    expect(tide.days.map((d) => [d.date, d.range])).toEqual([
      ['2026-11-11', 'spring'],
      ['2026-11-17', 'neap'],
      ['2026-11-22', 'mid'],
    ])
    expect(tide.days[0].tides).toEqual([
      { time: '02:20', type: 'low' },
      { time: '08:47', type: 'high' },
      { time: '13:57', type: 'low' },
      { time: '18:19', type: 'high' },
    ])
  })

  it('沒有龍洞灣公園時丟出錯誤', () => {
    const copy = structuredClone(sample)
    copy.records.TideForecasts = copy.records.TideForecasts.filter((f: { Location: { LocationName: string } }) => f.Location.LocationName !== TIDE_LOCATION)
    expect(() => parseCwaTide(copy, AT)).toThrow('沒有「海水浴場龍洞灣公園」')
  })

  it('看不懂的潮汐、潮差時丟出錯誤', () => {
    expect(() => parseCwaTide(withDay((d) => (d.Time[0].Tide = '平潮')), AT)).toThrow('看不懂的潮汐')
    expect(() => parseCwaTide(withDay((d) => (d.TideRange = '特大')), AT)).toThrow('看不懂的潮差')
  })

  it('時間不是台北時間、或不是那一天時丟出錯誤', () => {
    expect(() => parseCwaTide(withDay((d) => (d.Time[0].DateTime = '2026-11-10T18:20:00Z')), AT)).toThrow('不是那一天的台北時間')
    expect(() => parseCwaTide(withDay((d) => (d.Time[0].DateTime = '2026-11-12T02:20:00+08:00')), AT)).toThrow('不是那一天的台北時間')
  })
})
