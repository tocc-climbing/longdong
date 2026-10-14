import { rescueKey } from '../data/rescue'
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

/** 區域頁標題旁的「救援」按鈕：進入救援資訊並先顯示這個大區域的救援圖與就近救援點 */
export function RescueButton({ areaId }: { areaId: string }) {
  const { t } = useLang()
  return (
    <a className="rescue-button" href={href.rescue(rescueKey(areaId))}>
      <span className="rescue-cross" aria-hidden>
        +
      </span>
      {t('rescue.button')}
    </a>
  )
}
