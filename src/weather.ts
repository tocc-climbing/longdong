import { useEffect, useState } from 'react'
import { z } from 'zod'
import { whenActive } from './freshness'

/**
 * 龍洞的天氣：Open-Meteo（免金鑰、允許 CORS）的模型預報，時間都是台北時間。
 * 離線時由 Service Worker 給最後一次讀到的（vite.config.ts 的 runtimeCaching）。
 */

export type Condition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder'

/** WMO 天氣代碼（Open-Meteo 的 weather_code）→ 顯示的天氣 */
export function condition(code: number): Condition {
  if (code === 0) return 'clear'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code === 95 || code === 96 || code === 99) return 'thunder'
  throw new Error(`不認得的天氣代碼：${code}`)
}

export interface Hour {
  /** 台北時間 YYYY-MM-DDTHH:mm */
  time: string
  temp: number
  /** 降雨機率（%） */
  rain: number
  condition: Condition
}

export interface Weather {
  /** 預報的時間（台北時間 YYYY-MM-DDTHH:mm，每 15 分鐘一筆） */
  time: string
  temp: number
  humidity: number
  condition: Condition
  /** 平均風速、陣風（m/s） */
  wind: number
  gust: number
  /** 接下來 12 小時，從下一個整點開始 */
  hours: Hour[]
}

const Response = z.object({
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
    wind_gusts_10m: z.number(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    precipitation_probability: z.array(z.number()),
    weather_code: z.array(z.number()),
  }),
})

export const HOURS = 12

/** Open-Meteo 的回應 → Weather；格式不對、預報不夠 12 小時時丟出錯誤 */
export function parseWeather(json: unknown): Weather {
  const { current: c, hourly: h } = Response.parse(json)
  // 整點的時間字串比目前時間大的，就是下一個整點以後
  const start = h.time.findIndex((t) => t > c.time)
  if (start < 0 || start + HOURS > h.time.length) throw new Error(`逐時預報不足 ${HOURS} 小時`)
  const hours = h.time.slice(start, start + HOURS).map((time, i) => ({
    time,
    temp: h.temperature_2m[start + i],
    rain: h.precipitation_probability[start + i],
    condition: condition(h.weather_code[start + i]),
  }))
  return {
    time: c.time,
    temp: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    condition: condition(c.weather_code),
    wind: c.wind_speed_10m,
    gust: c.wind_gusts_10m,
    hours,
  }
}

export function weatherUrl([lat, lng]: [number, number]): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    wind_speed_unit: 'ms',
    timezone: 'Asia/Taipei',
    forecast_days: '2',
  })
  return `https://api.open-meteo.com/v1/forecast?${params}`
}

export type WeatherState = { status: 'loading' } | { status: 'ready'; weather: Weather } | { status: 'error' }

/** 打開時讀一次；回到前景、恢復網路時超過 15 分鐘就重新讀。讀不到時保留上一次的 */
export function useWeather(at: [number, number]): WeatherState {
  const [state, setState] = useState<WeatherState>({ status: 'loading' })
  const [lat, lng] = at
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(weatherUrl([lat, lng]))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const weather = parseWeather(await res.json())
        if (alive) setState({ status: 'ready', weather })
      } catch (err) {
        console.warn('天氣讀取失敗', err)
        if (alive) setState((s) => (s.status === 'ready' ? s : { status: 'error' }))
      }
    }
    void load()
    const stop = whenActive(() => void load(), { gapMs: 15 * 60_000, intervalMs: 15 * 60_000 })
    return () => {
      alive = false
      stop()
    }
  }, [lat, lng])
  return state
}
