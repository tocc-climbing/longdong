import { useSyncExternalStore } from 'react'

/**
 * 外觀：自動（依系統設定）、淺色、深色；選擇存在這台裝置上。
 * <html data-theme> 一律是實際套用的 light 或 dark（自動時依系統，系統切換時跟著換），styles.css 依此換顏色；
 * Android 的狀態列、系統列（theme-color）跟著頂欄的顏色（--bar-bg）。
 * index.html 開頭有一段同樣的程式，在畫面出現前就套用，避免先閃一下另一種顏色。
 */
export type ThemeSetting = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'longdong.theme'
const systemLight = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: light)')

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

export const resolveTheme = (s: ThemeSetting, systemIsLight: boolean): 'light' | 'dark' => (s === 'auto' ? (systemIsLight ? 'light' : 'dark') : s)

function apply() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = resolveTheme(setting, systemLight?.matches ?? false)
  const bar = getComputedStyle(root).getPropertyValue('--bar-bg').trim()
  if (bar) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar)
}
apply()
systemLight?.addEventListener('change', () => setting === 'auto' && apply())

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
