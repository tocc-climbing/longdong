import { useSyncExternalStore } from 'react'

/** 電腦版排版的斷點：寬度夠時改用左側欄＋清單／詳細內容並排 */
export const WIDE_QUERY = '(min-width: 1024px)'

const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE_QUERY) : null

export function isWide(): boolean {
  return !!mql?.matches
}

export function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      mql?.addEventListener('change', cb)
      return () => mql?.removeEventListener('change', cb)
    },
    isWide,
  )
}
