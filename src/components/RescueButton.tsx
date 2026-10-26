import { useLang } from '../i18n'
import { href } from '../router'

/** 首頁的救援資訊入口：顯眼的紅色卡片 */
export function RescueEntry() {
  const { t } = useLang()
  return (
    <a className="rescue-entry" href={href.rescue()}>
      <span className="rescue-cross" aria-hidden>
        +
      </span>
      <span>
        <strong>{t('rescue.entry')}</strong>
        <span className="small">{t('rescue.entryDesc')}</span>
      </span>
    </a>
  )
}
