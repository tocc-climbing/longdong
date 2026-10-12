import type { Page } from '../router'
import { href } from '../router'
import { useLang } from '../i18n'

export const TABS = [
  { key: 'crags', href: href.home(), icon: 'M3 20l6-11 4 6 3-4 5 9z' },
  { key: 'search', href: href.search(), icon: 'M10.5 4a6.5 6.5 0 1 0 4.04 11.6l4.43 4.43 1.41-1.41-4.43-4.43A6.5 6.5 0 0 0 10.5 4zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z' },
  { key: 'me', href: href.me(), icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z' },
] as const

export function activeTab(page: Page): (typeof TABS)[number]['key'] {
  if (page.name === 'search') return 'search'
  if (page.name === 'me' || page.name === 'about') return 'me'
  return 'crags'
}

export function BottomNav({ page }: { page: Page }) {
  const active = activeTab(page)
  const { t } = useLang()
  return (
    <nav className="bottom-nav" aria-label={t('nav.main')}>
      {TABS.map((tab) => (
        <a key={tab.key} href={tab.href} className={tab.key === active ? 'active' : ''} aria-current={tab.key === active ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden width="24" height="24">
            <path d={tab.icon} fill="currentColor" />
          </svg>
          <span>{t(`nav.${tab.key}`)}</span>
        </a>
      ))}
    </nav>
  )
}
