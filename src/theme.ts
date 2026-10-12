import { useSyncExternalStore } from 'react'

/**
 * 外觀：自動（依系統設定）、淺色、深色；選擇存在這台裝置上。
 * 手動選擇時在 <html> 加上 data-theme，styles.css 依此覆蓋系統的深淺色。
 * index.html 開頭有一段同樣的程式，在畫面出現前就套用，避免先閃一下另一種顏色。
 */
export type ThemeSetting = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'longdong.theme'

function readSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

let setting: ThemeSetting = readSetting()
const listeners = new Set<() => void>()

function apply() {
  if (typeof document === 'undefined') return
  if (setting === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = setting
}
apply()

export function setThemeSetting(next: ThemeSetting): void {
  setting = next
  try {
    if (next === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* 私密瀏覽等情況，只在這次使用有效 */
  }
  apply()
  for (const l of listeners) l()
}

export function useThemeSetting(): ThemeSetting {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => setting,
  )
}
