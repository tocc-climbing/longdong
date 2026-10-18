import { useState } from 'react'
import { useLang } from '../i18n'
import { dismissInstall, install, useInstall, type IosMode } from '../install'
import { useWide } from '../layout'

/**
 * 首頁的安裝提示卡，30 天內沒按過「以後再說」時才顯示：
 * - Android 等支援安裝事件的瀏覽器：「安裝 App」按鈕
 * - iPhone／iPad：加入主畫面的圖示教學
 * 電腦版不主動提示（安裝入口留在「我的」頁）
 */
export function InstallBanner() {
  const { canInstall, dismissed, ios } = useInstall()
  const wide = useWide()
  const { t } = useLang()
  if (dismissed || !(ios || (canInstall && !wide))) return null

  return (
    <section className="install-banner" aria-label={t('install.title')}>
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={48} height={48} />
      <div className="install-text">
        <strong>{t('install.title')}</strong>
        <span className="muted small">{t('install.desc')}</span>
      </div>
      {ios ? <IosGuide mode={ios} /> : null}
      <div className="actions">
        {canInstall && (
          <button className="action primary" onClick={() => void install()}>
            {t('install.button')}
          </button>
        )}
        <button className="action" onClick={dismissInstall}>
          {ios ? t('install.gotIt') : t('install.later')}
        </button>
      </div>
    </section>
  )
}

/** 「我的」頁的安裝入口，不受「以後再說」影響 */
export function InstallButton() {
  const { canInstall, ios } = useInstall()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  if (canInstall) {
    return (
      <button className="action" onClick={() => void install()}>
        {t('install.button')}
      </button>
    )
  }
  if (!ios) return null
  return (
    <div className="install-inline">
      <button className="action" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('install.howTo')}
      </button>
      {open && <IosGuide mode={ios} />}
    </div>
  )
}

/** iOS 加入主畫面的步驟；在 App 內建瀏覽器裡則提示先用 Safari 開啟 */
function IosGuide({ mode }: { mode: IosMode }) {
  const { t } = useLang()
  if (mode === 'in-app') {
    return <p className="install-steps small">{t('install.inAppDesc')}</p>
  }
  return (
    <ol className="install-steps">
      <li>
        <ShareIcon />
        <span>{t('install.iosStep1')}</span>
      </li>
      <li>
        <AddIcon />
        <span>{t('install.iosStep2')}</span>
      </li>
      <li>
        <span className="step-badge">{t('install.iosAdd')}</span>
        <span>{t('install.iosStep3')}</span>
      </li>
    </ol>
  )
}

/** iOS 的分享圖示：方框加向上箭頭 */
function ShareIcon() {
  return (
    <svg className="step-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path
        d="M12 3v11M8 7l4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** iOS「加入主畫面」的圖示：圓角方框加號 */
function AddIcon() {
  return (
    <svg className="step-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
