import { useLang } from '../i18n'
import { dismissInstall, install, useInstall } from '../install'

/** 首頁的安裝提示卡：瀏覽器允許安裝、且 30 天內沒按過「以後再說」時才顯示 */
export function InstallBanner() {
  const { canInstall, dismissed } = useInstall()
  const { t } = useLang()
  if (!canInstall || dismissed) return null
  return (
    <section className="install-banner" aria-label={t('install.title')}>
      <img src="./icons/icon-192.png" alt="" width={48} height={48} />
      <div className="install-text">
        <strong>{t('install.title')}</strong>
        <span className="muted small">{t('install.desc')}</span>
      </div>
      <div className="actions">
        <button className="action primary" onClick={() => void install()}>
          {t('install.button')}
        </button>
        <button className="action" onClick={dismissInstall}>
          {t('install.later')}
        </button>
      </div>
    </section>
  )
}

/** 「我的」頁的安裝按鈕：不受「以後再說」影響，瀏覽器允許安裝時就顯示 */
export function InstallButton() {
  const { canInstall } = useInstall()
  const { t } = useLang()
  if (!canInstall) return null
  return (
    <button className="action" onClick={() => void install()}>
      {t('install.button')}
    </button>
  )
}
