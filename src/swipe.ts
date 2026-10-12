import { useEffect, useRef, type RefObject } from 'react'
import type { LoadedData } from './data/dataset'
import type { LocalizedName } from './data/schema'
import { applyView, filterCount, type ListView } from './listView'
import { href, type Page } from './router'

/**
 * 手機版左右滑動切換區域與路線：
 * - 區域頁（含只有一個區域的大區域）：依序走過整個岩場的區域，大區域的最後一區接到下一個大區域
 * - 有多個區域的大區域頁：切換大區域
 * - 路線頁：依岩場內的順序切換路線，區域的最後一條接到下一區的第一條；
 *   有設定清單的篩選條件時，只在符合條件的路線之間切換，順序與各區域清單的排序相同
 */

export interface Neighbor {
  hash: string
  name: LocalizedName
  /** 路線編號（切換路線時） */
  number?: string
  /** 跨到另一個區域時，那個區域的名稱 */
  sector?: LocalizedName
}

export interface Neighbors {
  kind: 'area' | 'route'
  prev?: Neighbor
  next?: Neighbor
  /** 路線依篩選條件切換 */
  filtered?: boolean
}

/** 切換路線時套用的清單篩選與排序；ratingOf 給依評分排序用 */
export interface RouteOrder {
  view: ListView
  ratingOf: (id: string) => number | undefined
}

type NavData = Pick<LoadedData, 'dataset' | 'areaById' | 'sectorById' | 'routes'>

/** 各區域分別套用篩選與排序（和區域頁的清單一樣），再依區域順序接起來 */
function routeSequence(data: NavData, order: RouteOrder): NavData['routes'] {
  const out: NavData['routes'] = []
  for (let i = 0; i < data.routes.length; ) {
    let j = i
    while (j < data.routes.length && data.routes[j].sector.id === data.routes[i].sector.id) j++
    out.push(...applyView(data.routes.slice(i, j), order.view, order.ratingOf))
    i = j
  }
  return out
}

export function neighbors(page: Page, data: NavData, order?: RouteOrder): Neighbors | undefined {
  if (page.name === 'route') {
    // 目前的路線不符合篩選條件時（例如從搜尋點進來），照原本的順序切換
    const custom = order && (filterCount(order.view.filter) > 0 || order.view.sort !== 'default' || order.view.desc)
    const ordered = custom ? routeSequence(data, order) : undefined
    const useOrdered = !!ordered?.some((r) => r.route.id === page.id)
    const list = useOrdered ? ordered! : data.routes
    const at = list.findIndex((r) => r.route.id === page.id)
    if (at < 0) return undefined
    const here = list[at].sector.id
    const pick = (i: number): Neighbor | undefined => {
      const ref = list[i]
      if (!ref) return undefined
      return {
        hash: href.route(ref.route.id),
        name: ref.route.name,
        number: ref.route.number,
        sector: ref.sector.id === here ? undefined : ref.sector.name,
      }
    }
    return { kind: 'route', prev: pick(at - 1), next: pick(at + 1), filtered: useOrdered && filterCount(order!.view.filter) > 0 }
  }

  let list: (Neighbor & { id: string })[]
  let current: string
  const area = page.name === 'area' ? data.areaById.get(page.id) : undefined

  if (area && area.sectors.length > 1) {
    list = data.dataset.areas.map((a) => ({ id: a.id, hash: href.area(a.id), name: a.name }))
    current = area.id
  } else if (area || page.name === 'sector') {
    // 只有一個區域的大區域用大區域頁當作那一區
    list = data.dataset.areas.flatMap((a) =>
      a.sectors.length === 1
        ? [{ id: a.id, hash: href.area(a.id), name: a.name }]
        : a.sectors.map((s) => ({ id: s.id, hash: href.sector(s.id), name: s.name })),
    )
    current = area ? area.id : (page as { id: string }).id
  } else {
    return undefined
  }

  const at = list.findIndex((x) => x.id === current)
  if (at < 0) return undefined
  const pick = (i: number) => (list[i] ? { hash: list[i].hash, name: list[i].name } : undefined)
  return { kind: 'area', prev: pick(at - 1), next: pick(at + 1) }
}

/** 螢幕左右邊緣這個寬度內起滑的不算：留給 iOS／Android 的「返回」手勢 */
const EDGE = 24

export type Dir = 'next' | 'prev'

/** 手指移動超過 10px 後判斷方向：水平距離至少是垂直的 1.5 倍才算左右滑，否則交給頁面上下捲動 */
export function lockAxis(dx: number, dy: number): 'h' | 'v' | undefined {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return undefined
  return Math.abs(dx) >= 1.5 * Math.abs(dy) ? 'h' : 'v'
}

/** 拖曳時畫面的位移：有下一個時跟著手指（阻尼 0.35）；沒有時只小幅回彈（最多 24px） */
export function dragOffset(dx: number, canGo: boolean): number {
  return canGo ? 0.35 * dx : Math.max(-24, Math.min(24, 0.12 * dx))
}

/** 放開時切換的距離門檻：螢幕寬的 1/6，介於 60–90px；慢慢拖超過這個距離也會切換 */
export function commitDistance(viewportWidth: number): number {
  return Math.min(90, Math.max(60, viewportWidth / 6))
}

/**
 * 放開時是否切換：拖得夠遠，或快速往同方向撥（至少 30px、0.5 px/ms）。
 * 最後往反方向撥回、或過程中頁面上下捲動了，就不切換。
 */
export function shouldCommit(dx: number, velocity: number, viewportWidth: number, scrolled: number): boolean {
  if (Math.abs(scrolled) > 10) return false
  const reversed = Math.sign(velocity) === -Math.sign(dx) && Math.abs(velocity) >= 0.15
  if (reversed) return false
  const far = Math.abs(dx) >= commitDistance(viewportWidth)
  const flick = Math.abs(dx) >= 30 && Math.sign(velocity) === Math.sign(dx) && Math.abs(velocity) >= 0.5
  return far || flick
}

/** 從觸控點往上找：表單欄位、可以橫向捲動的元素（例如 Bolt 表格）裡的滑動，留給該元素 */
function ignoreTouch(target: EventTarget | null, x: number): boolean {
  if (x < EDGE || x > window.innerWidth - EDGE) return true
  if ((window.visualViewport?.scale ?? 1) > 1.01) return true // 放大檢視時留給平移
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, textarea, select, [contenteditable], [data-noswipe]')) return true
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

export interface SwipeHandlers {
  /** 這個方向有沒有下一個 */
  can: (dir: Dir) => boolean
  /** 判斷為左右滑時（dir）與結束時（null）：顯示／隱藏「下一個」的提示 */
  onLock: (dir: Dir | null) => void
  /** 拖曳距離是否已超過門檻（放開就會切換） */
  onArmed: (armed: boolean) => void
  onCommit: (dir: Dir) => void
}

/**
 * 左右滑動：手指拖動時 moving 元素跟著移動，放開時依距離與速度決定切換或彈回。
 * 只監聽 area 元素內開始的觸控；enabled 為 false（例如電腦版）時不監聽。
 */
export function useSwipe(
  enabled: boolean,
  area: RefObject<HTMLElement | null>,
  moving: RefObject<HTMLElement | null>,
  handlers: SwipeHandlers,
): void {
  const h = useRef(handlers)
  h.current = handlers
  useEffect(() => {
    const root = area.current
    if (!enabled || !root) return
    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let g:
      | { x0: number; y0: number; sy0: number; lock?: 'h' | 'v'; dir: Dir; dx: number; armed: boolean; samples: { x: number; t: number }[] }
      | undefined

    const place = (offset: number, animate: boolean) => {
      const el = moving.current
      if (!el) return
      el.style.transition = animate && !reduced() ? 'transform 0.18s ease-out' : ''
      el.style.transform = offset ? `translateX(${offset.toFixed(1)}px)` : ''
    }
    const end = (animateBack: boolean) => {
      const locked = g?.lock === 'h'
      g = undefined
      place(0, animateBack)
      if (locked) {
        h.current.onArmed(false)
        h.current.onLock(null)
      }
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length > 1) return end(true)
      const p = e.touches[0]
      g = ignoreTouch(e.target, p.clientX)
        ? undefined
        : { x0: p.clientX, y0: p.clientY, sy0: window.scrollY, dir: 'next', dx: 0, armed: false, samples: [{ x: p.clientX, t: e.timeStamp }] }
    }
    const onMove = (e: TouchEvent) => {
      if (!g) return
      if (e.touches.length > 1) return end(true)
      const p = e.touches[0]
      const dx = p.clientX - g.x0
      if (!g.lock) {
        g.lock = lockAxis(dx, p.clientY - g.y0)
        if (!g.lock) return
        if (g.lock === 'v') return
        g.dir = dx < 0 ? 'next' : 'prev'
        h.current.onLock(g.dir)
      }
      if (g.lock !== 'h') return
      if (e.cancelable) e.preventDefault() // 左右滑時不讓頁面跟著上下晃
      g.dx = dx
      g.samples.push({ x: p.clientX, t: e.timeStamp })
      while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift()
      const dir: Dir = dx < 0 ? 'next' : 'prev'
      const can = dir === g.dir && h.current.can(dir)
      place(dragOffset(dx, can), false)
      const armed = can && Math.abs(dx) >= commitDistance(window.innerWidth)
      if (armed !== g.armed) h.current.onArmed((g.armed = armed))
    }
    const onEnd = (e: TouchEvent) => {
      if (!g || e.touches.length > 0) return
      if (g.lock !== 'h') return end(false)
      const recent = g.samples.filter((s) => e.timeStamp - s.t <= 100)
      const first = recent[0]
      const last = recent[recent.length - 1]
      const velocity = first && last !== first ? (last.x - first.x) / Math.max(1, e.timeStamp - first.t) : 0
      const dir: Dir = g.dx < 0 ? 'next' : 'prev'
      const commit = dir === g.dir && h.current.can(dir) && shouldCommit(g.dx, velocity, window.innerWidth, window.scrollY - g.sy0)
      end(!commit)
      if (commit) h.current.onCommit(dir)
    }
    const onCancel = () => end(true)

    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchmove', onMove, { passive: false })
    root.addEventListener('touchend', onEnd, { passive: true })
    root.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      end(false)
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onCancel)
    }
  }, [enabled, area, moving])
}
