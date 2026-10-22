import { useSyncExternalStore } from 'react'
import type { LatLng } from './geo'

/**
 * 模擬位置（測試整個回報流程用）：打開 /map@緯度,經度（例如 /map@25.1105,121.9228）後，
 * 這個分頁裡的定位（地圖、路線頁的回報位置、救援頁的我的位置）都用這個座標，誤差當作 5 公尺；
 * 不在龍洞範圍內也能回報。模擬時送出的回報標上 test，管理頁看得出來。
 * 存在 sessionStorage：關掉分頁就結束，也可以按畫面上方的「結束模擬」。
 */

const KEY = 'longdong.simulate'
/** 模擬位置的 GPS 誤差（公尺） */
export const SIMULATED_ACCURACY_M = 5

/** 「25.1105,121.9228」→ [25.1105, 121.9228]；格式不對或超出經緯度範圍時 undefined */
export function parseSimulation(text: string): LatLng | undefined {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!m) return undefined
  const [lat, lng] = [Number(m[1]), Number(m[2])]
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : undefined
}

function read(): LatLng | undefined {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? parseSimulation(raw) : undefined
  } catch {
    return undefined
  }
}

let current = read()
const listeners = new Set<() => void>()

/** 目前的模擬位置（沒有模擬時 undefined） */
export function simulatedLocation(): LatLng | undefined {
  return current
}

/** 開始或結束（undefined）模擬 */
export function setSimulation(at: LatLng | undefined): void {
  current = at
  try {
    if (at) sessionStorage.setItem(KEY, at.join(','))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* 存不了就只在這次瀏覽有效 */
  }
  listeners.forEach((l) => l())
}

export function useSimulation(): LatLng | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
