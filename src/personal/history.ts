import { useEffect } from 'react'

/**
 * 最近查過的路線（首頁）：在路線頁看超過 10 秒才算，滑過去的不算。
 * 只存在這台裝置（localStorage），不上傳。
 */

const KEY = 'longdong.viewed'
/** 停留多久才算查過（畫面在背景的時間不算） */
export const VIEW_MS = 10_000
const MAX = 20

export interface View {
  routeId: string
  /** ISO 8601 */
  at: string
}

/** 新查的放最前面；同一條路線只留最新的一次 */
export function addView(list: View[], routeId: string, at: string): View[] {
  return [{ routeId, at }, ...list.filter((v) => v.routeId !== routeId)].slice(0, MAX)
}

export function loadViews(): View[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((v): v is View => typeof v?.routeId === 'string' && typeof v?.at === 'string') : []
  } catch {
    return []
  }
}

function recordView(routeId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(addView(loadViews(), routeId, new Date().toISOString())))
  } catch {
    /* 存不了（私密瀏覽等）就不記 */
  }
}

/** 路線頁：畫面在前景累計 10 秒就記一筆 */
export function useViewTimer(routeId: string | undefined) {
  useEffect(() => {
    if (!routeId) return
    let remaining = VIEW_MS
    let started: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = () => {
      if (document.visibilityState !== 'visible' || remaining <= 0 || started !== undefined) return
      started = Date.now()
      timer = setTimeout(() => {
        remaining = 0
        started = undefined
        recordView(routeId)
      }, remaining)
    }
    const pause = () => {
      if (started === undefined) return
      clearTimeout(timer)
      remaining -= Date.now() - started
      started = undefined
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : pause())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      pause()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [routeId])
}
