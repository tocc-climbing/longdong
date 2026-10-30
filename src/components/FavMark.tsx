import { useLang } from '../i18n'

/** 清單名稱旁的小愛心：收藏的區域、分區 */
export function FavMark() {
  const { t } = useLang()
  return (
    <svg className="fav-mark" viewBox="0 0 24 24" width="14" height="14" role="img" aria-label={t('fav.on')}>
      <path d="M12 21s-7-4.4-9.5-9C.8 8.6 3 5 6.5 5c2 0 3.5 1.2 5.5 3 2-1.8 3.5-3 5.5-3C21 5 23.2 8.6 21.5 12 19 16.6 12 21 12 21z" fill="currentColor" />
    </svg>
  )
}
