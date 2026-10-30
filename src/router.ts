import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { findSector, type LoadedData } from './data/dataset'
import { isWide } from './layout'
import type { LatLng } from './geo'
import { parseSimulation } from './simulate'

/**
 * 極簡路由，網址不帶 #：/、/search?q=、/area/<id>、/sector/<id>、/route/<id>、/me、/about、/rescue、/map、/reports、/admin、/bolts、/topo/<照片>、
 * /edit/<種類>/<項目>（編輯模式：map、topo、text；id 本身含 "/"）。
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
  | { name: 'rescue' }
  /** simulate：/map@緯度,經度 的模擬位置（src/simulate.ts） */
  | { name: 'map'; simulate?: LatLng }
  | { name: 'reports' }
  | { name: 'admin' }
  | { name: 'bolts' }
  | { name: 'checklist' }
  /** Topo 編輯（電腦版）；id 是照片 id */
  | { name: 'topo'; id: string }
  /** 編輯模式：kind 是 map（地圖編輯的對象）、topo（照片 id）、text（說明的對象）；沒有時顯示目錄 */
  | { name: 'edit'; kind?: EditKind; id?: string }
  /** 不是 App 的頁面（例如 /terms.html 等靜態檔案）：站內連結不攔，直接載入時顯示找不到頁面 */
  | { name: 'notFound' }
) & { detail?: string }

export type EditKind = 'map' | 'topo' | 'text'
const EDIT_KINDS: EditKind[] = ['map', 'topo', 'text']

/** 解析網址的路徑與查詢字串（/area/…?r=…） */
export function parseLocation(location: string): Page {
  const [rawPath, query = ''] = location.split('?')
  const params = new URLSearchParams(query)
  const r = params.get('r')
  const extra = r ? { detail: r } : {}
  const path = decodePath(rawPath)
  if (path === undefined) return { name: 'notFound' }
  const [, kind, ...rest] = path.replace(/\/+$/, '').split('/')
  const id = rest.join('/')
  if (kind === 'area' && id) return { name: 'area', id, ...extra }
  if (kind === 'route' && id) return { name: 'route', id }
  if (kind === 'sector' && id) return { name: 'sector', id, ...extra }
  if (kind === 'search') return { name: 'search', q: params.get('q') ?? '', ...extra }
  if (kind === 'me') return { name: 'me', ...extra }
  if (kind === 'about') return { name: 'about' }
  if (kind === 'map') return { name: 'map' }
  if (kind?.startsWith('map@')) {
    const simulate = parseSimulation(kind.slice(4))
    return simulate ? { name: 'map', simulate } : { name: 'map' }
  }
  if (kind === 'reports') return { name: 'reports' }
  if (kind === 'admin') return { name: 'admin' }
  if (kind === 'bolts') return { name: 'bolts' }
  if (kind === 'checklist') return { name: 'checklist' }
  if (kind === 'topo' && id) return { name: 'topo', id }
  if (kind === 'edit') {
    const [editKind, ...itemId] = rest
    return EDIT_KINDS.includes(editKind as EditKind) && itemId.length ? { name: 'edit', kind: editKind as EditKind, id: itemId.join('/') } : { name: 'edit' }
  }
  // 救援頁依定位顯示，不分區域：舊的 /rescue/<區域> 也到救援頁，緊急時不會落到「找不到」
  if (kind === 'rescue') return { name: 'rescue' }
  if (!kind) return { name: 'home' }
  return { name: 'notFound' }
}

/** 解碼網址的路徑；% 後面不是合法的編碼（例如 /area/%）時不是任何頁面，回傳 undefined */
function decodePath(rawPath: string): string | undefined {
  try {
    return decodeURIComponent(rawPath)
  } catch {
    // decodeURIComponent 只會因為編碼不合法丟出 URIError
    return undefined
  }
}

// ID 只含 [a-z0-9./-]，不需要編碼
export const href = {
  home: () => '/',
  search: (q = '', detail?: string) => withDetail(q ? `/search?q=${encodeURIComponent(q)}` : '/search', detail),
  area: (id: string) => `/area/${id}`,
  edit: (kind?: EditKind, id?: string) => (kind && id ? `/edit/${kind}/${id}` : '/edit'),
  sector: (id: string) => `/sector/${id}`,
  route: (id: string) => `/route/${id}`,
  me: () => '/me',
  about: () => '/about',
  /** 救援資訊；area 為大區域的救援 key（golden-valley），會先顯示該區的資訊 */
  rescue: () => '/rescue',
  /** 照比例尺的龍洞地圖（測試版，可回報位置幫忙校正） */
  map: () => '/map',
  /** 管理員：所有人的地圖回報（管理頁的「地圖回報」分頁） */
  reports: () => '/reports',
  /** 管理員：所有留言（可刪除）與檢舉 */
  admin: () => '/admin',
  /** Bolt 統計：依安裝年份、材質、區域 */
  bolts: () => '/bolts',
  /** 路線清單：快速記錄每條路線的最佳攀登方式與評分（我的 → 路線清單） */
  checklist: () => '/checklist',
  /** Topo 編輯（電腦版） */
  /** Topo 編輯在編輯模式裡（舊的 /topo/<照片> 也會開編輯模式） */
  topo: (id: string) => `/edit/topo/${id}`,
  /** 分區還沒有 Topo 照片時的新增頁（有照片會轉到第一張） */
  topoAdd: (sectorId: string) => `/edit/topo/${TOPO_ADD_PREFIX}${sectorId}`,
}

/** 舊的分區網址（依位置編號的 ID）要換成的網址，?r= 照留；不是舊網址時回傳 undefined */
export function legacySectorHref(page: Page, sectorIdByLegacyId: Map<string, string>): string | undefined {
  const id = page.name === 'sector' ? sectorIdByLegacyId.get(page.id) : undefined
  return id && withDetail(href.sector(id), page.detail)
}

/** 目前的網址（路徑＋查詢字串） */
export function here(): string {
  return location.pathname + location.search
}

const CHANGE = 'locationchange'

/** 站內換頁：新增一筆瀏覽紀錄（replace 時不新增，例如輸入搜尋字串），並通知 usePage 更新 */
/** 編輯模式的 Topo 項目網址以此開頭時，後面是分區 ID（新增頁），不是照片 ID */
export const TOPO_ADD_PREFIX = 'sector:'

export function navigate(to: string, { replace = false } = {}): void {
  if (to === here()) return
  const d = depth()
  if (replace) history.replaceState({ depth: d }, '', to)
  else {
    // 離開前把這一頁的捲動位置記在它的瀏覽紀錄裡，按上一頁回來時捲回去（scrollAfter）
    history.replaceState({ ...history.state, scroll: scrollPositions() }, '')
    history.pushState({ depth: d + 1 }, '', to)
  }
  window.dispatchEvent(new Event(CHANGE))
}

/** 這筆瀏覽紀錄是第幾筆（navigate 記在 history.state）：比較前後就知道是返回還是往前 */
function depth(): number {
  return (history.state as { depth?: number } | null)?.depth ?? 0
}

/**
 * 上一層的網址：路線 → 分區，分區 → 區域，區域 → 首頁；
 * 清單旁邊開著路線（?r=）時是拿掉路線的清單。其他頁面沒有上一層（undefined）。
 */
export function parentHref(location: string, data: LoadedData): string | undefined {
  const page = parseLocation(location)
  if (page.detail) return withDetail(location)
  if (page.name === 'route') {
    const ref = data.routeById.get(page.id)
    return ref && href.sector(ref.sector.id)
  }
  if (page.name === 'sector') {
    const found = findSector(data, page.id)
    return found && href.area(found.area.id)
  }
  if (page.name === 'area') return href.home()
  return undefined
}

/** 各上一層的網址，由最上層開始（不含自己） */
export function ancestors(location: string, data: LoadedData): string[] {
  const chain: string[] = []
  for (let p = parentHref(location, data); p; p = parentHref(p, data)) chain.unshift(p)
  return chain
}

/** 按了返回（back）、從 left 回到 landed 時，要改去的上一層；已經是上一層、往前、或沒有上一層時 undefined */
export function backTarget(left: string, back: boolean, landed: string, parentOf?: (location: string) => string | undefined): string | undefined {
  const up = back ? parentOf?.(left) : undefined
  return up && up !== landed ? up : undefined
}

/**
 * 直接打開的網址（分享的連結、書籤）：在前面補上各上一層的瀏覽紀錄，按返回一層一層回去，不會直接離開 App。
 * 只在這個分頁第一次打開時補（重新載入時瀏覽紀錄已經有了）。
 */
export function seedAncestors(chain: string[]): void {
  if ((history.state as { depth?: number } | null)?.depth !== undefined || chain.length === 0) return
  const to = here()
  chain.forEach((p, i) => (i === 0 ? history.replaceState({ depth: 0 }, '', p) : history.pushState({ depth: i }, '', p)))
  history.pushState({ depth: chain.length }, '', to)
  window.dispatchEvent(new Event(CHANGE))
}

/** 連結要由路由換頁時的路徑（路徑＋查詢字串）；外部連結、不是 App 頁面的靜態檔案（/terms.html）回傳 undefined，交給瀏覽器載入 */
export function appPath(url: URL, origin: string): string | undefined {
  if (url.origin !== origin) return undefined
  const path = url.pathname + url.search
  return parseLocation(path).name === 'notFound' ? undefined : path
}

if (typeof document !== 'undefined') {
  // 上一頁、下一頁的捲動位置由 usePage 在新的頁面畫好後捲回去；瀏覽器自己捲會在舊的頁面上先跳一下
  history.scrollRestoration = 'manual'
  // 站內連結（<a href="/…">）不重新載入，改由路由換頁；新分頁、下載、外部連結、靜態檔案照常
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
    const path = appPath(new URL(a.href), location.origin)
    if (path === undefined) return
    e.preventDefault()
    navigate(path)
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
  // 沒有 id 的頁面兩邊都是 undefined；/edit 換到 /edit/<種類>/<項目> 算換頁
  return (a as { id?: string }).id === (b as { id?: string }).id
}

/** 各自捲動的區塊：手機版是整頁（window）；電腦版是內容區與清單欄 */
const SCROLLERS = ['.shell-main', '.list-pane']

/** 一頁的捲動位置：key 是 window 或 SCROLLERS 的選擇器；畫面上沒有的區塊（例如手機版的清單欄）不記 */
export type ScrollPositions = Record<string, number>

function scrollPositions(): ScrollPositions {
  const positions: ScrollPositions = { window: window.scrollY }
  for (const selector of SCROLLERS) {
    const el = document.querySelector(selector)
    if (el) positions[selector] = el.scrollTop
  }
  return positions
}

/** 捲到記下的位置；沒有記下的區塊捲回頂端（傳 {} 就是全部捲回頂端） */
function scrollToPositions(positions: ScrollPositions) {
  window.scrollTo(0, positions.window ?? 0)
  for (const selector of SCROLLERS) document.querySelector(selector)?.scrollTo(0, positions[selector] ?? 0)
}

/**
 * 換頁後要捲到哪裡：上一頁、下一頁回到離開那一頁時記下的位置（navigate 記在 history.state）；
 * 其他換頁捲回頂端（{}）；還在同一頁時不動（undefined）
 */
export function scrollAfter(from: Page, to: Page, state: unknown): ScrollPositions | undefined {
  const saved = (state as { scroll?: ScrollPositions } | null)?.scroll
  return saved ?? (samePlace(from, to) ? undefined : {})
}

/**
 * 目前的頁面。parentOf：頁面的上一層（parentHref）；系統的「返回」一律回到上一層，
 * 而不是上一個瀏覽紀錄（例如左右滑換過分區、從搜尋點進路線）。沒有上一層的頁面照瀏覽紀錄返回。
 */
export function usePage(parentOf?: (location: string) => string | undefined): Page {
  const [page, setPage] = useState(() => parseLocation(here()))
  const current = useRef(page)
  const scroll = useRef<ScrollPositions>(undefined)
  const parent = useRef(parentOf)
  useLayoutEffect(() => {
    parent.current = parentOf
  })
  useEffect(() => {
    let level = depth()
    let path = here()
    const onChange = () => {
      const next = parseLocation(here())
      scroll.current = scrollAfter(current.current, next, history.state)
      current.current = next
      level = depth()
      path = here()
      setPage(next)
    }
    const onPop = () => {
      const up = backTarget(path, depth() < level, here(), parent.current)
      if (up) history.replaceState({ depth: depth() }, '', up)
      onChange()
    }
    // 站內換頁（navigate）與瀏覽器的上一頁、下一頁
    window.addEventListener(CHANGE, onChange)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener(CHANGE, onChange)
      window.removeEventListener('popstate', onPop)
    }
  }, [])
  // 新的頁面畫好後才捲動：畫好前內容的高度不夠，捲不到記下的位置
  useLayoutEffect(() => {
    if (!scroll.current) return
    scrollToPositions(scroll.current)
    scroll.current = undefined
  }, [page])
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
