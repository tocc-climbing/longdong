import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { AppVersion } from '../scripts/lib/appVersion'
import { whenActive } from './freshness'
import { useLang } from './i18n'
import { fetchLatestVersion } from './version'

/** 開啟後這段時間內發現新版本就直接換上（毫秒） */
const AUTO_UPDATE_MS = 10_000

/**
 * 新版本（Service Worker）：定期檢查；剛開啟就發現時自動換上，否則顯示「有新版本」提示條。
 * offlineReady：離線可用；banner：要顯示的提示條（沒有時為 false）。
 */
export function useAppUpdate(): { offlineReady: boolean; banner: ReactNode } {
  const { t } = useLang()
  const applyUpdate = useRef<() => void>(undefined)
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // 回到前景、恢復網路、使用中每小時檢查新版本（App 從背景回來不會重新載入，只在載入時檢查會一直收不到）
      whenActive(() => void registration.update().catch(() => {}), { gapMs: 60_000, intervalMs: 60 * 60_000 })
    },
  })
  applyUpdate.current = () => void updateServiceWorker(true)

  // 剛開啟或重新整理（AUTO_UPDATE_MS 內、還沒點擊或打字）就發現新版本：直接換成新版，不會打斷操作。
  // 不這樣做的話，新版會一直等到按「更新」，重新整理幾次都還是舊版（電腦上習慣按 F5）
  const interacted = useRef(false)
  useEffect(() => {
    const mark = () => (interacted.current = true)
    window.addEventListener('pointerdown', mark, { once: true })
    window.addEventListener('keydown', mark, { once: true })
    return () => {
      window.removeEventListener('pointerdown', mark)
      window.removeEventListener('keydown', mark)
    }
  }, [])
  // 自動更新時不顯示「有新版本」：提示會在重新載入前閃一下就消失。
  // 在繪製時就決定（不能等 effect，否則第一次畫面還是會出現）；5 秒後還沒換成新版（例如重新載入失敗）才顯示
  const autoUpdate = useMemo(() => needRefresh && !interacted.current && performance.now() < AUTO_UPDATE_MS, [needRefresh])
  const [autoFailed, setAutoFailed] = useState(false)
  useEffect(() => {
    if (!autoUpdate) return
    applyUpdate.current?.()
    const timer = setTimeout(() => setAutoFailed(true), 5_000)
    return () => clearTimeout(timer)
  }, [autoUpdate])

  // 有新版本時讀新版號；讀不到（例如剛好斷線）就只說有新版本
  const [latest, setLatest] = useState<AppVersion>()
  useEffect(() => {
    if (needRefresh) void fetchLatestVersion().then(setLatest)
  }, [needRefresh])

  const banner = needRefresh && (!autoUpdate || autoFailed) && (
    <div className="banner">
      {latest ? t('app.updateAvailableVersion', { version: latest.version }) : t('app.updateAvailable')}
      <button onClick={() => updateServiceWorker(true)}>{t('app.update')}</button>
    </div>
  )

  return { offlineReady, banner }
}
