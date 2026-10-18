import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { isWide } from './layout'

/**
 * 極簡路由，網址不帶 #：/、/search?q=、/area/<id>、/sector/<id>、/route/<id>、/me、/about、/rescue/<區域>、/map（id 本身含 "/"）。
 * 清單頁可帶 ?r=<路線 id>：電腦版在清單旁邊顯示這條路線，手機版直接顯示路線頁。
 * 伺服器（Firebase Hosting）把所有路徑都交給 index.html；站內連結由這裡攔下來換頁，不重新載入。
 */
export type Page = (
  | { name: 'home' }
  | { name: 'search'; q: string }
  | { name: 'area'; id: string }
  | { name: 'sector'; id: string }
  | { name: 'route'; id: string }
  | { name: 'me' }
  | { name: 'about' }
  | { name: 'rescue'; id?: string }
  | { name: 'map' }
) & { detail?: string }

/** 解析網址的路徑與查詢字串（/area/…?r=…） */
export function parseLocation(location: string): Page {
  const [rawPath, query = ''] = location.split('?')
  const params = new URLSearchParams(query)
  const r = params.get('r')
  const extra = r ? { detail: r } : {}
  const [, kind, ...rest] = decodeURIComponent(rawPath).replace(/\/+$/, '').split('/')
  const id = rest.join('/')
  if (kind === 'area' && id) return { name: 'area', id, ...extra }
  if (kind === 'route' && id) return { name: 'route', id }
  if (kind === 'sector' && id) return { name: 'sector', id, ...extra }
  if (kind === 'search') return { name: 'search', q: params.get('q') ?? '', ...extra }
  if (kind === 'me') return { name: 'me', ...extra }
  if (kind === 'about') return { name: 'about' }
  if (kind === 'map') return { name: 'map' }
  if (kind === 'rescue') return id ? { name: 'rescue', id } : { name: 'rescue' }
  return { name: 'home' }
}

// ID 只含 [a-z0-9./-]，不需要編碼
export const href = {
  home: () => '/',
  search: (q = '', detail?: string) => withDetail(q ? `/search?q=${encodeURIComponent(q)}` : '/search', detail),
  area: (id: string) => `/area/${id}`,
  sector: (id: string) => `/sector/${id}`,
  route: (id: string) => `/route/${id}`,
  me: () => '/me',
  about: () => '/about',
  /** 救援資訊；area 為大區域的救援 key（golden-valley），會先顯示該區的資訊 */
  rescue: (area?: string) => (area ? `/rescue/${area}` : '/rescue'),
  /** 照比例尺的龍洞地圖（測試版，可回報位置幫忙校正） */
  map: () => '/map',
}

/** 目前的網址（路徑＋查詢字串） */
export function here(): string {
  return location.pathname + location.search
}

const CHANGE = 'locationchange'

/** 站內換頁：新增一筆瀏覽紀錄（replace 時不新增，例如輸入搜尋字串），並通知 usePage 更新 */
export function navigate(to: string, { replace = false } = {}): void {
  if (to === here()) return
  if (replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  window.dispatchEvent(new Event(CHANGE))
}

if (typeof document !== 'undefined') {
  // 站內連結（<a href="/…">）不重新載入，改由路由換頁；新分頁、下載、外部連結照常
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
    const url = new URL(a.href)
    if (url.origin !== location.origin) return
    e.preventDefault()
    navigate(url.pathname + url.search)
  })
}

/** 在網址加上（或拿掉）?r=<路線 id>，其他參數不變 */
export function withDetail(location: string, id?: string): string {
  const [path, query = ''] = location.split('?')
  const params = new URLSearchParams(query)
  if (id) params.set('r', id)
  else params.delete('r')
  const s = params.toString().replace(/%2F/g, '/')
  return s ? `${path}?${s}` : path
}

/** 是否還在同一頁（只換了搜尋字串或右側的路線）：這時不捲回頂端 */
export function samePlace(a: Page, b: Page): boolean {
  if (a.name !== b.name) return false
  if (a.name === 'route' && b.name === 'route') return a.id === b.id || isWide()
  // 沒有 id 的頁面兩邊都是 undefined；/rescue 換到 /rescue/<大區域> 算換頁
  return (a as { id?: string }).id === (b as { id?: string }).id
}

/** 換頁時捲回頂端：手機版是整頁；電腦版是內容區與清單欄（各自捲動） */
function scrollToTop() {
  window.scrollTo(0, 0)
  for (const el of document.querySelectorAll('.shell-main, .list-pane')) el.scrollTo(0, 0)
}

export function usePage(): Page {
  const [page, setPage] = useState(() => parseLocation(here()))
  const current = useRef(page)
  useEffect(() => {
    const onChange = () => {
      const next = parseLocation(here())
      if (!samePlace(current.current, next)) scrollToTop()
      current.current = next
      setPage(next)
    }
    // 站內換頁（navigate）與瀏覽器的上一頁、下一頁
    window.addEventListener(CHANGE, onChange)
    window.addEventListener('popstate', onChange)
    return () => {
      window.removeEventListener(CHANGE, onChange)
      window.removeEventListener('popstate', onChange)
    }
  }, [])
  return page
}

/** 路線連結要指向哪裡：手機版是路線頁；電腦版是目前清單＋右側的路線 */
export interface RouteLink {
  link: (id: string) => string
  selected?: string
}

export const RouteLinkContext = createContext<RouteLink>({ link: href.route })

export function useRouteLink(): RouteLink {
  return useContext(RouteLinkContext)
}
