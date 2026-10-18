import { useEffect, useRef, useState } from 'react'
import type { LoadedData } from './data/dataset'
import { useLang } from './i18n'
import { defaultLevel, keyNav, type Level } from './keyboard'
import { RoutePage } from './pages/RoutePage'
import { here, href, navigate, withDetail, type Page } from './router'

/* 電腦版：清單與路線並排的版面、右邊的路線、快捷鍵 */

export interface DesktopView {
  /** 清單與路線並排 */
  split: boolean
  /** 左邊的清單 */
  list: Page
  /** 右邊的路線；沒有時顯示提示 */
  detail?: string
  /** 關閉右邊路線的連結 */
  closeHref: string
  /** 不並排時用較寬的版面（首頁、分區卡片、我的、救援資訊） */
  roomy: boolean
}

/**
 * 電腦版的版面：
 * - 分區、只有一個分區的區域：路線清單＋右邊的路線（沒選時顯示提示）
 * - 路線頁：該路線所在的分區清單＋右邊的路線
 * - 搜尋、我的：選了路線（?r=）才並排
 */
export function desktopView(page: Page, data: LoadedData): DesktopView {
  const plain = (roomy: boolean): DesktopView => ({ split: false, list: page, closeHref: '', roomy })
  if (page.name === 'route') {
    const ref = data.routeById.get(page.id)
    if (!ref) return plain(false)
    return { split: true, list: { name: 'sector', id: ref.sector.id }, detail: page.id, closeHref: href.sector(ref.sector.id), roomy: false }
  }
  const closeHref = withDetail(here(), undefined)
  const routeList = page.name === 'sector' || (page.name === 'area' && data.areaById.get(page.id)?.sectors.length === 1)
  if (routeList || page.detail) return { split: true, list: page, detail: page.detail, closeHref, roomy: false }
  return plain(page.name === 'home' || page.name === 'area' || page.name === 'me' || page.name === 'rescue' || page.name === 'reports' || page.name === 'bolts')
}

export function DetailPane({ data, id, closeHref }: { data: LoadedData; id?: string; closeHref: string }) {
  const { t } = useLang()
  const pane = useRef<HTMLElement>(null)
  useEffect(() => {
    pane.current?.scrollTo(0, 0)
  }, [id])

  if (!id) {
    return (
      <aside className="detail-pane detail-empty">
        <p className="muted">{t('layout.pickRoute')}</p>
        <p className="muted small">{t('layout.keys')}</p>
      </aside>
    )
  }
  return (
    <aside className="detail-pane" ref={pane} aria-label={t('layout.detail')}>
      <a className="icon-button detail-close" href={closeHref} aria-label={t('layout.close')} title={t('layout.close')}>
        ×
      </a>
      <RoutePage key={id} data={data} id={id} />
    </aside>
  )
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * 電腦版快捷鍵：/ 搜尋、Esc 關閉右邊的路線、↑↓ 在目前層級內移動、←→ 切換層級（大區域／區域／路線）。
 * 回傳用鍵盤選定的層級（用滑鼠點選或換頁後清除），側欄依此標示目前的位置。
 */
export function useDesktopKeys(wide: boolean, view: DesktopView | undefined, page: Page, data: LoadedData | undefined): Level | null {
  const [level, setLevel] = useState<Level | null>(null)
  const current = useRef({ view, page, data, level })
  current.current = { view, page, data, level }
  // 方向鍵造成的換頁不清除層級；其他換頁（點選、Esc、返回）清除
  const fromKeys = useRef(false)
  useEffect(() => {
    if (fromKeys.current) fromKeys.current = false
    else setLevel(null)
  }, [page])

  useEffect(() => {
    if (!wide) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const { view: v, page: p, data: d, level: l } = current.current
      if (e.key === 'Escape') {
        if (typing(e.target)) (e.target as HTMLElement).blur()
        else if (v?.detail) navigate(v.closeHref)
        return
      }
      if (typing(e.target)) return
      if (e.key === '/') {
        e.preventDefault()
        document.getElementById('sidebar-search')?.focus()
        return
      }
      if (!d || !e.key.startsWith('Arrow')) return
      const rows = [...document.querySelectorAll<HTMLAnchorElement>('main a.route-row')]
      const result = keyNav(e.key, {
        page: p,
        level: l ?? defaultLevel(p, d),
        data: d,
        rows: rows.map((r) => r.getAttribute('href')!),
        selected: rows.findIndex((r) => r.getAttribute('aria-current') === 'true'),
      })
      if (!result) return
      e.preventDefault()
      setLevel(result.level)
      if (result.row !== undefined) rows[result.row].scrollIntoView({ block: 'nearest' })
      if (result.hash && result.hash !== here()) {
        fromKeys.current = true
        navigate(result.hash, { replace: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wide])

  return wide ? level : null
}
