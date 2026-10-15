import { useEffect, useState } from 'react'
import { useLang } from '../i18n'

/**
 * 複製文字的小按鈕（救援點座標、我的位置）：按下後短暫顯示「已複製」；
 * 剪貼簿不可用或被拒絕時（部分 App 內建瀏覽器）顯示「無法複製」，不要讓人以為已經複製。
 */
export function CopyButton({ text, className = 'chip' }: { text: string; className?: string }) {
  const { t } = useLang()
  const [state, setState] = useState<'copied' | 'failed'>()
  useEffect(() => {
    if (!state) return
    const timer = setTimeout(() => setState(undefined), 2000)
    return () => clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <button type="button" className={className} onClick={() => void copy()}>
      {state === 'copied' ? t('rescue.copied') : state === 'failed' ? t('rescue.copyFailed') : t('rescue.copy')}
    </button>
  )
}
