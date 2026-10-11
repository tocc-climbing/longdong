import { useSyncExternalStore } from 'react'

/**
 * 「安裝到主畫面」：Android 的 Chrome、Edge 等瀏覽器在網站符合可安裝條件時發出 beforeinstallprompt。
 * 先攔下這個事件（不讓瀏覽器自己的小提示跳出），由 App 在適當位置顯示安裝按鈕，按下後才呼叫 prompt()。
 * iOS Safari 沒有這個事件，只能手動「分享 → 加入主畫面」。
 *
 * 這個模組必須在 main.tsx 最早載入：事件可能在 React 畫面出現前就發出。
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'longdong.installDismissedAt'
const DISMISS_DAYS = 30

let deferred: BeforeInstallPromptEvent | null = null
let installed = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
const listeners = new Set<() => void>()
let snapshot = { canInstall: false, dismissed: readDismissed() }

function emit() {
  snapshot = { canInstall: !!deferred && !installed, dismissed: readDismissed() }
  for (const l of listeners) l()
}

function readDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return !!at && Date.now() - at < DISMISS_DAYS * 86400000
  } catch {
    return false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    emit()
  })
}

/** 跳出系統的安裝視窗；使用者拒絕時這次的事件就失效，瀏覽器之後可能再發一次 */
export async function install(): Promise<void> {
  if (!deferred) return
  const event = deferred
  deferred = null
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') installed = true
  emit()
}

/** 首頁提示按「以後再說」：30 天內不再顯示（「我的」頁的安裝按鈕不受影響） */
export function dismissInstall(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* 私密瀏覽等情況，只在這次有效 */
  }
  emit()
}

export function useInstall(): { canInstall: boolean; dismissed: boolean } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}
