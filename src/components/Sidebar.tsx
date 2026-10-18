import { useEffect, useRef } from 'react'
import type { LoadedData } from '../data/dataset'
import { sectorColor } from '../format'
import { localName, useLang } from '../i18n'
import { href, navigate, type Page } from '../router'
import type { Level } from '../keyboard'
import { TABS, activeTab } from './BottomNav'

/**
 * 電腦版的左側欄：品牌、搜尋框、主選單，以及龍洞的區域／分區（目前所在的區域展開分區）。
 * 用方向鍵切換到大區域或區域層級時（kbdLevel），標示目前所在的那一項。
 */
export function Sidebar({ page, data, kbdLevel }: { page: Page; data?: LoadedData; kbdLevel: Level | null }) {
  const { lang, t } = useLang()
  const active = activeTab(page)
  const here = data ? currentPlace(page, data) : {}
  const tree = useRef<HTMLElement>(null)
  useEffect(() => {
    tree.current?.querySelector('.kbd')?.scrollIntoView({ block: 'nearest' })
  }, [kbdLevel, here.area, here.sector])

  const onSearch = (q: string) => {
    if (page.name === 'search') navigate(href.search(q, page.detail), { replace: true })
    else navigate(href.search(q))
  }

  return (
    <aside className="sidebar">
      <a className="brand" href={href.home()}>
        <span className="brand-mark" aria-hidden>
          LD
        </span>
        {t('app.title')}
      </a>

      <div className="search sidebar-search">
        <input
          id="sidebar-search"
          type="search"
          placeholder={t('search.aria')}
          aria-label={t('search.aria')}
          aria-keyshortcuts="/"
          value={page.name === 'search' ? page.q : ''}
          onChange={(e) => onSearch(e.target.value)}
        />
        <kbd aria-hidden>/</kbd>
      </div>

      <nav className="side-nav" aria-label={t('nav.main')}>
        {/* 電腦版由上到下：我的、地圖、岩場（岩場緊接下面的區域清單） */}
        {[...TABS].reverse().map((tab) => (
          <a key={tab.key} href={tab.href} className={tab.key === active ? 'active' : ''} aria-current={tab.key === active ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
              <path d={tab.icon} fill="currentColor" />
            </svg>
            {t(`nav.${tab.key}`)}
          </a>
        ))}
      </nav>

      {data && (
        <nav className="area-tree" aria-label={t('nav.areas')} ref={tree}>
          <ul>
            {data.dataset.areas.map((area) => (
              <li key={area.id}>
                <a
                  href={href.area(area.id)}
                  className={cls(here.area === area.id && !here.sector, here.area === area.id && kbdLevel === 'area')}
                  aria-current={here.area === area.id && !here.sector ? 'page' : undefined}
                >
                  <span className="dot" style={{ background: area.color }} aria-hidden />
                  {localName(area.name, lang).main}
                </a>
                {here.area === area.id && area.sectors.length > 1 && (
                  <ul>
                    {area.sectors.map((sector, i) => (
                      <li key={sector.id}>
                        <a
                          href={href.sector(sector.id)}
                          className={cls(here.sector === sector.id, here.sector === sector.id && kbdLevel === 'sector')}
                          aria-current={here.sector === sector.id ? 'page' : undefined}
                        >
                          <span className="dot" style={{ background: sectorColor(area.color, i, area.sectors.length) }} aria-hidden />
                          {localName(sector.name, lang).main}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* 側邊欄底部的次要連結；Bolt 統計只在電腦版有入口（手機版只能從連結進入） */}
      <div className="side-about small">
        <a className={page.name === 'bolts' ? 'active' : undefined} href={href.bolts()} aria-current={page.name === 'bolts' ? 'page' : undefined}>
          {t('bolts.title')}
        </a>
        <a className={page.name === 'about' ? 'active' : undefined} href={href.about()} aria-current={page.name === 'about' ? 'page' : undefined}>
          {t('footer.about')}
        </a>
      </div>
    </aside>
  )
}

function cls(active: boolean, kbd: boolean): string {
  return [active && 'active', kbd && 'kbd'].filter(Boolean).join(' ')
}

/** 目前所在的區域與分區（路線頁依該路線所在位置；單一分區的區域不標分區） */
function currentPlace(page: Page, data: LoadedData): { area?: string; sector?: string } {
  if (page.name === 'area') return { area: page.id }
  const ref = page.name === 'sector' ? data.sectorById.get(page.id) : page.name === 'route' ? data.routeById.get(page.id) : undefined
  if (!ref) return {}
  return { area: ref.area.id, sector: ref.area.sectors.length > 1 ? ref.sector.id : undefined }
}
