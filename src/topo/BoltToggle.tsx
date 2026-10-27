import { useSyncExternalStore } from 'react'
import { useLang } from '../i18n'

/**
 * 看 Topo 時 bolt 預設不顯示（anchor 和路線編號容易重疊）：照片右上角的按鈕切換，這個瀏覽器記住選擇。
 * 全螢幕與頁面上的照片共用同一個選擇。
 */
const KEY = 'longdong.topoBolts'

let on = (() => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()
const listeners = new Set<() => void>()

export function useShowBolts(): [boolean, () => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => on,
  )
  return [
    value,
    () => {
      on = !on
      try {
        localStorage.setItem(KEY, on ? '1' : '0')
      } catch {
        /* 存不了就只在這次開啟期間有效 */
      }
      listeners.forEach((l) => l())
    },
  ]
}

/** 照片右上角的按鈕（在全螢幕按鈕左邊）：顯示／隱藏 bolt */
export function BoltToggle({ className = 'topo-bolt-toggle' }: { className?: string }) {
  const { t } = useLang()
  const [shown, toggle] = useShowBolts()
  const label = t(shown ? 'topo.boltsHide' : 'topo.boltsShow')
  return (
    <button type="button" className={className} aria-pressed={shown} aria-label={label} title={label} onClick={toggle}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      </svg>
    </button>
  )
}
