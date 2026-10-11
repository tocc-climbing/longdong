import { useSyncExternalStore } from 'react'

/**
 * 「安裝到主畫面」：Android 的 Chrome、Edge 等瀏覽器在網站符合可安裝條件時發出 beforeinstallprompt。
 * 先攔下這個事件（不讓瀏覽器自己的小提示跳出），由 App 在適當位置顯示安裝按鈕，按下後才呼叫 prompt()。
 * iOS 沒有這個事件，只能手動「分享 → 加入主畫面」，所以在 iPhone／iPad 上改為顯示圖示教學；
 * 在 LINE、Facebook 等 App 的內建瀏覽器裡無法加入主畫面，改提示先用 Safari 開啟。
 *
 * 這個模組必須在 main.tsx 最早載入：事件可能在 React 畫面出現前就發出。
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** iOS 的加入方式：safari＝可從分享選單加入；in-app＝在 App 內建瀏覽器裡，要先用 Safari 開啟 */
export type IosMode = 'safari' | 'in-app'

/** 判斷是否需要顯示 iOS 的加入主畫面教學；已從主畫面開啟（standalone）或不是 iOS 時回傳 null */
export function detectIos(ua: string, maxTouchPoints: number, standalone: boolean | undefined): IosMode | null {
  // iPadOS 13 起預設以 Mac 的 UA 呈現，用觸控點數區分
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
  if (!isIos || standalone === true) return null
  return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|KAKAOTALK/i.test(ua) ? 'in-app' : 'safari'
}

const ios: IosMode | null =
  typeof navigator !== 'undefined'
    ? detectIos(navigator.userAgent, navigator.maxTouchPoints ?? 0, (navigator as { standalone?: boolean }).standalone)
    : null

const DISMISS_KEY = 'longdong.installDismissedAt'
const DISMISS_DAYS = 30

let deferred: BeforeInstallPromptEvent | null = null
let installed = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
const listeners = new Set<() => void>()
let snapshot = { canInstall: false, dismissed: readDismissed(), ios }

function emit() {
  snapshot = { canInstall: !!deferred && !installed, dismissed: readDismissed(), ios }
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

/** 首頁提示按「以後再說」／「知道了」：30 天內不再顯示（「我的」頁的安裝入口不受影響） */
export function dismissInstall(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* 私密瀏覽等情況，只在這次有效 */
  }
  emit()
}

export function useInstall(): { canInstall: boolean; dismissed: boolean; ios: IosMode | null } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}
