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

const coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : null

/** 主要的指標是手指：點、把手要比滑鼠的大 */
export function useCoarse(): boolean {
  return useSyncExternalStore(
    (cb) => {
      coarse?.addEventListener('change', cb)
      return () => coarse?.removeEventListener('change', cb)
    },
    () => !!coarse?.matches,
  )
}

// <html data-layout="mobile|wide">：手機版的視覺（styles.css 的「手機版」一節）只套用在手機版，電腦版不受影響。
// 在載入時就設定（畫面出現前），之後跟著視窗寬度更新
if (typeof document !== 'undefined') {
  const mark = () => (document.documentElement.dataset.layout = isWide() ? 'wide' : 'mobile')
  mark()
  mql?.addEventListener('change', mark)
}
