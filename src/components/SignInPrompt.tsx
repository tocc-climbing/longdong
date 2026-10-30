import { useEffect } from 'react'
import { useLang } from '../i18n'
import { preloadSignIn, signIn, useCloud } from '../personal/sync'

/**
 * Facebook 登入：Facebook App 尚未通過上線（非開發者無法登入），暫時隱藏按鈕。
 * 程式（含同 Email 帳號連結）都已完成，Facebook App 可公開使用後改成 true 即可。
 */
export const FACEBOOK_LOGIN_ENABLED = false

/** 未登入時顯示的登入按鈕；message：按鈕上方的說明（不寫「登入後可以做什麼」） */
export function SignInPrompt({ message }: { message?: string }) {
  const cloud = useCloud()
  const { t } = useLang()
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  // 先下載登入程式，按下按鈕時才能馬上開出登入視窗（iOS Safari 會擋太晚開的視窗）
  useEffect(() => {
    if (!offline) preloadSignIn()
  }, [offline])
  return (
    <div className="signin-prompt">
      {message && <p className="muted small">{message}</p>}
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
