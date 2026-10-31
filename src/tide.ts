import { useEffect, useState } from 'react'
import { z } from 'zod'

/**
 * 龍洞的潮汐：中央氣象署「潮汐預報－未來 1 個月」（F-A0021-001）。
 * 授權碼不放前端：每週由 GitHub Actions 抓一次存成 public/data/tide.json（scripts/fetch-tide.ts、.github/workflows/tide.yml），
 * 跟著網站一起離線快取。
 */

/** 氣象署的預報地點裡離岩場最近的 */
export const TIDE_LOCATION = '海水浴場龍洞灣公園'

export type TideType = 'high' | 'low'
/** 潮差：大潮、中潮、小潮 */
export type TideRange = 'spring' | 'mid' | 'neap'

export const TideFile = z.object({
  location: z.string(),
  /** 抓取時間（ISO 8601） */
  fetchedAt: z.string(),
  days: z.array(
    z.object({
      /** 台北時間 YYYY-MM-DD */
      date: z.string(),
      range: z.enum(['spring', 'mid', 'neap']),
      /** 滿潮、乾潮的時間（台北時間 HH:mm），依時間排序 */
      tides: z.array(z.object({ time: z.string(), type: z.enum(['high', 'low']) })),
    }),
  ),
})
export type TideFile = z.infer<typeof TideFile>

const CwaResponse = z.object({
  records: z.object({
    TideForecasts: z.array(
      z.object({
        Location: z.object({
          LocationName: z.string(),
          TimePeriods: z.object({
            Daily: z.array(
              z.object({
                Date: z.string(),
                TideRange: z.string(),
                Time: z.array(z.object({ DateTime: z.string(), Tide: z.string() })),
              }),
            ),
          }),
        }),
      }),
    ),
  }),
})

const RANGES: Record<string, TideRange> = { 大: 'spring', 中: 'mid', 小: 'neap' }
const TYPES: Record<string, TideType> = { 滿潮: 'high', 乾潮: 'low' }

/** 氣象署的回應 → tide.json；找不到地點、看不懂的潮汐或時區時丟出錯誤 */
export function parseCwaTide(json: unknown, fetchedAt: string): TideFile {
  const forecast = CwaResponse.parse(json).records.TideForecasts.find((f) => f.Location.LocationName === TIDE_LOCATION)
  if (!forecast) throw new Error(`氣象署的潮汐預報沒有「${TIDE_LOCATION}」`)
  const days = forecast.Location.TimePeriods.Daily.map((d) => {
    const range = RANGES[d.TideRange]
    if (!range) throw new Error(`看不懂的潮差：${d.TideRange}（${d.Date}）`)
    const tides = d.Time.map((t) => {
      const type = TYPES[t.Tide]
      if (!type) throw new Error(`看不懂的潮汐：${t.Tide}（${t.DateTime}）`)
      if (!t.DateTime.endsWith('+08:00') || !t.DateTime.startsWith(d.Date)) throw new Error(`時間不是那一天的台北時間：${t.DateTime}（${d.Date}）`)
      return { time: t.DateTime.slice(11, 16), type }
    }).sort((a, b) => a.time.localeCompare(b.time))
    return { date: d.Date, range, tides }
  }).sort((a, b) => a.date.localeCompare(b.date))
  return { location: TIDE_LOCATION, fetchedAt, days }
}

export type TideState = { status: 'loading' } | { status: 'ready'; tide: TideFile } | { status: 'error' }

/** 資料檔由 Service Worker 預先快取，離線時也讀得到 */
export function useTide(): TideState {
  const [state, setState] = useState<TideState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}data/tide.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => alive && setState({ status: 'ready', tide: TideFile.parse(json) }))
      .catch((err) => {
        console.warn('潮汐讀取失敗', err)
        if (alive) setState({ status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [])
  return state
}
