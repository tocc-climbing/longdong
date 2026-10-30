import type { Page } from '../router'
import { href } from '../router'
import { useLang } from '../i18n'

export const TABS = [
  { key: 'crags', href: href.home(), icon: 'M3 20l6-11 4 6 3-4 5 9z' },
  {
    key: 'search',
    href: href.search(),
    icon: 'M10.5 4a6.5 6.5 0 1 0 4.04 11.6l4.43 4.43 1.41-1.41-4.43-4.43A6.5 6.5 0 0 0 10.5 4zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z',
  },
  { key: 'map', href: href.map(), icon: 'M15 4l-6-2-6 2v18l6-2 6 2 6-2V2zM9 4.2l6 2v13.6l-6-2z' },
  { key: 'me', href: href.me(), icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z' },
] as const

/** 目前頁面屬於哪個分頁；救援頁不屬於任何分頁（從頂欄進入） */
export function activeTab(page: Page): (typeof TABS)[number]['key'] | undefined {
  if (page.name === 'rescue') return undefined
  if (page.name === 'map') return 'map'
  if (page.name === 'search') return 'search'
  if (page.name === 'me' || page.name === 'about' || page.name === 'reports' || page.name === 'admin' || page.name === 'checklist') return 'me'
  return 'crags'
}

/** 手機版底部分頁：只有圖示，名稱給螢幕閱讀器 */
export function BottomNav({ page }: { page: Page }) {
  const active = activeTab(page)
  const { t } = useLang()
  return (
    <nav className="bottom-nav" aria-label={t('nav.main')}>
      {TABS.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={tab.key === active ? 'active' : ''}
          aria-current={tab.key === active ? 'page' : undefined}
          aria-label={t(`nav.${tab.key}`)}
          title={t(`nav.${tab.key}`)}
        >
          <svg viewBox="0 0 24 24" aria-hidden width="24" height="24">
            <path d={tab.icon} fill="currentColor" />
          </svg>
        </a>
      ))}
    </nav>
  )
}
