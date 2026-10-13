import { useEffect, useState } from 'react'
import type { RouteRef } from '../data/dataset'
import { useLang } from '../i18n'
import { shareRoute } from '../share'

/** 路線頁的分享按鈕：叫出系統分享選單，或複製連結並短暫顯示「已複製連結」 */
export function ShareButton({ item }: { item: RouteRef }) {
  const { lang, t } = useLang()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])

  const onClick = async () => {
    try {
      const result = await shareRoute(item, lang, t)
      if (result === 'copied') setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <button type="button" className="fact share-button" onClick={() => void onClick()} aria-live="polite">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
        <path
          d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {state === 'copied' ? t('share.copied') : state === 'failed' ? t('share.failed') : t('share.button')}
    </button>
  )
}
