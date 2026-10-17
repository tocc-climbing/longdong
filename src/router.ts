import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { isWide } from './layout'

/**
 * 極簡 hash 路由：#/、#/search?q=、#/area/<id>、#/sector/<id>、#/route/<id>、#/me、#/about、#/rescue/<區域>、#/calibrate（id 本身含 "/"）。
 * 清單頁可帶 ?r=<路線 id>：電腦版在清單旁邊顯示這條路線，手機版直接顯示路線頁。
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
  | { name: 'calibrate' }
) & { detail?: string }

const DEFAULT_CRAG = 'longdong'

/**
 * 舊網址相容：早期 ID 沒有岩場前綴（r523、r242-p2、back-door），
 * 轉成 longdong/523、longdong/242-p2、longdong/back-door。
 */
export function upgradeId(kind: 'area' | 'route', id: string): string {
  if (id.includes('/')) return id
  if (kind === 'route' && /^r\d/.test(id)) return `${DEFAULT_CRAG}/${id.slice(1)}`
  return `${DEFAULT_CRAG}/${id}`
}

/**
 * 分享出去的網址用查詢字串（…/longdong/?route=<路線ID>）：Facebook、Messenger 轉址時可能丟掉 # 後面的部分。
 * 開啟時轉成 #/route/<路線ID>，順便去掉 fbclid 等查詢字串。
 */
export function routeFromSearch(search: string): string | undefined {
  const id = new URLSearchParams(search).get('route')
  return id ? upgradeId('route', id) : undefined
}

export function parseHash(hash: string): Page {
  const [rawPath, query = ''] = hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query)
  const r = params.get('r')
  const extra = r ? { detail: upgradeId('route', r) } : {}
  const [, kind, ...rest] = decodeURIComponent(rawPath).split('/')
  const id = rest.join('/')
  if ((kind === 'area' || kind === 'route') && id) return { name: kind, id: upgradeId(kind, id), ...(kind === 'area' ? extra : {}) }
  if (kind === 'sector' && id) return { name: 'sector', id, ...extra }
  if (kind === 'search') return { name: 'search', q: params.get('q') ?? '', ...extra }
  if (kind === 'me') return { name: 'me', ...extra }
  if (kind === 'about') return { name: 'about' }
  if (kind === 'calibrate') return { name: 'calibrate' }
  if (kind === 'rescue') return id ? { name: 'rescue', id } : { name: 'rescue' }
  return { name: 'home' }
}

// ID 只含 [a-z0-9./-]，不需要編碼
export const href = {
  home: () => '#/',
  search: (q = '', detail?: string) => withDetail(q ? `#/search?q=${encodeURIComponent(q)}` : '#/search', detail),
  area: (id: string) => `#/area/${id}`,
  sector: (id: string) => `#/sector/${id}`,
  route: (id: string) => `#/route/${id}`,
  me: () => '#/me',
  about: () => '#/about',
  /** 救援資訊；area 為大區域的救援 key（golden-valley），會先顯示該區的資訊 */
  rescue: (area?: string) => (area ? `#/rescue/${area}` : '#/rescue'),
  /** 比例尺地圖的現場校正（測試中） */
  calibrate: () => '#/calibrate',
}

// 開啟分享出去的網址時轉成路線頁（必須在 href 定義之後、usePage 第一次讀網址之前）
if (typeof location !== 'undefined') {
  const shared = routeFromSearch(location.search)
  if (shared) history.replaceState(null, '', location.pathname + href.route(shared))
}

/** 在網址加上（或拿掉）?r=<路線 id>，其他參數不變 */
export function withDetail(hash: string, id?: string): string {
  const [path, query = ''] = hash.split('?')
  const params = new URLSearchParams(query)
  if (id) params.set('r', id)
  else params.delete('r')
  const s = params.toString().replace(/%2F/g, '/')
  return s ? `${path}?${s}` : path
}

/** 換網址但不新增瀏覽紀錄（例如輸入搜尋字串），並通知 usePage 更新 */
export function replaceHash(hash: string): void {
  history.replaceState(null, '', hash)
  window.dispatchEvent(new Event('hashchange'))
}

/** 是否還在同一頁（只換了搜尋字串或右側的路線）：這時不捲回頂端 */
export function samePlace(a: Page, b: Page): boolean {
  if (a.name !== b.name) return false
  if (a.name === 'route' && b.name === 'route') return a.id === b.id || isWide()
  // 沒有 id 的頁面兩邊都是 undefined；#/rescue 換到 #/rescue/<大區域> 算換頁
  return (a as { id?: string }).id === (b as { id?: string }).id
}

/** 換頁時捲回頂端：手機版是整頁；電腦版是內容區與清單欄（各自捲動） */
function scrollToTop() {
  window.scrollTo(0, 0)
  for (const el of document.querySelectorAll('.shell-main, .list-pane')) el.scrollTo(0, 0)
}

export function usePage(): Page {
  const [page, setPage] = useState(() => parseHash(location.hash))
  const current = useRef(page)
  useEffect(() => {
    const onChange = () => {
      const next = parseHash(location.hash)
      if (!samePlace(current.current, next)) scrollToTop()
      current.current = next
      setPage(next)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
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
