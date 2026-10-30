import { useLang } from '../i18n'
import { href } from '../router'

/** 手機版頂欄右上的救援按鈕：每一頁都在同一個位置，一按就到救援頁 */
export function RescueButton({ active }: { active: boolean }) {
  const { t } = useLang()
  return (
    <a className="rescue-button" href={href.rescue()} aria-current={active ? 'page' : undefined}>
      <span className="rescue-cross" aria-hidden>
        +
      </span>
      {t('rescue.button')}
    </a>
  )
}
