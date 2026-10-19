import { useLang } from '../i18n'

/** 開發站（longdong-dev.web.app，由 main 建置時設定 VITE_CHANNEL=dev）：畫面上標示，避免誤當成正式站使用 */
export const IS_DEV_SITE = import.meta.env.VITE_CHANNEL === 'dev'

export function DevBadge() {
  const { t } = useLang()
  return IS_DEV_SITE ? <span className="dev-badge">{t('app.devBadge')}</span> : null
}
