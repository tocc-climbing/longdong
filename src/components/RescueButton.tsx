import { useLang } from '../i18n'
import { href } from '../router'

/** 手機版頂欄右上的救援按鈕：每一頁都在同一個位置，一按就到救援頁；只有十字圖示，名稱給螢幕閱讀器 */
export function RescueButton({ active }: { active: boolean }) {
  const { t } = useLang()
  return (
    <a className="rescue-button" href={href.rescue()} aria-current={active ? 'page' : undefined} aria-label={t('rescue.button')} title={t('rescue.button')}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="currentColor" />
        <path d="M10 5h4v5h5v4h-5v5h-4v-5H5v-4h5z" fill="#fff" />
      </svg>
    </a>
  )
}
