import { useLang } from '../i18n'
import { signIn, useCloud } from '../personal/sync'

/**
 * Facebook 登入：Facebook App 尚未通過上線（非開發者無法登入），暫時隱藏按鈕。
 * 程式（含同 Email 帳號連結）都已完成，Facebook App 可公開使用後改成 true 即可。
 */
export const FACEBOOK_LOGIN_ENABLED = false

/** 未登入時顯示的登入按鈕；message 說明登入後能做什麼。compact 為一行文字加連結 */
export function SignInPrompt({ message, compact = false }: { message: string; compact?: boolean }) {
  const cloud = useCloud()
  const { t } = useLang()
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  if (compact) {
    return (
      <>
        <p className="muted small">
          {message}
          {!offline && (
            <button className="link-button inline" onClick={() => void signIn()} disabled={cloud.status === 'loading'}>
              {t('signin.link')}
            </button>
          )}
        </p>
        {cloud.error && <p className="small error">{cloud.error}</p>}
      </>
    )
  }
  return (
    <div className="signin-prompt">
      <p className="muted small">{message}</p>
      {offline ? (
        <button className="action" disabled>
          {t('signin.offline')}
        </button>
      ) : (
        <div className="actions">
          <button className="action primary" onClick={() => void signIn('google')} disabled={cloud.status === 'loading'}>
            {t('signin.google')}
          </button>
          {FACEBOOK_LOGIN_ENABLED && (
            <button className="action facebook" onClick={() => void signIn('facebook')} disabled={cloud.status === 'loading'}>
              {t('signin.facebook')}
            </button>
          )}
        </div>
      )}
      {cloud.error && <p className="small error">{cloud.error}</p>}
    </div>
  )
}
