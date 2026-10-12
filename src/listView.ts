import { useSyncExternalStore } from 'react'
import type { Route, Safety } from './data/schema'
import { gradeBand, type GradeBand } from './format'

/**
 * 路線清單的排序與篩選。狀態在各清單之間共用：
 * 在一個區域設定「5.10、運攀、綠燈」，換到下一個區域（例如用方向鍵）時條件保留。
 */

export type SortKey = 'default' | 'grade' | 'rating'
export type Kind = 'sport' | 'other'

export interface ListFilter {
  bands: GradeBand[]
  kinds: Kind[]
  safety: Safety[]
}

export interface ListView {
  sort: SortKey
  desc: boolean
  filter: ListFilter
}

export const EMPTY_FILTER: ListFilter = { bands: [], kinds: [], safety: [] }
const INITIAL: ListView = { sort: 'default', desc: false, filter: EMPTY_FILTER }

export function kindOf(route: Pick<Route, 'type'>): Kind | undefined {
  if (!route.type) return undefined
  return route.type === 'sport' ? 'sport' : 'other'
}

export function matches(route: Route, f: ListFilter): boolean {
  if (f.bands.length > 0 && !f.bands.includes(gradeBand(route.gradeValue)!)) return false
  if (f.kinds.length > 0 && !f.kinds.includes(kindOf(route)!)) return false
  if (f.safety.length > 0 && !f.safety.includes(route.safety!)) return false
  return true
}

export function filterCount(f: ListFilter): number {
  return f.bands.length + f.kinds.length + f.safety.length
}

/**
 * 篩選後排序。default 保持原本順序（區域內依編號、搜尋依相關度）；
 * 沒有難度或沒有評分的路線不論升降冪都排在最後。
 */
export function applyView<T extends { route: Route }>(items: T[], view: ListView, ratingOf: (id: string) => number | undefined): T[] {
  const shown = items.filter((item) => matches(item.route, view.filter))
  if (view.sort === 'default') return view.desc ? shown.reverse() : shown
  const key = (item: T) => (view.sort === 'grade' ? item.route.gradeValue : ratingOf(item.route.id))
  const dir = view.desc ? -1 : 1
  return shown.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka === undefined || kb === undefined) return (ka === undefined ? 1 : 0) - (kb === undefined ? 1 : 0)
    return (ka - kb) * dir
  })
}

/** 點欄位標題：同一欄切換升降冪，換欄時用該欄的自然方向（評分由高到低，其他由低到高） */
export function nextSort(view: ListView, key: SortKey): Pick<ListView, 'sort' | 'desc'> {
  if (view.sort === key) return { sort: key, desc: !view.desc }
  return { sort: key, desc: key === 'rating' }
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

let state: ListView = INITIAL
const listeners = new Set<() => void>()

export function setListView(patch: Partial<ListView>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useListView(): ListView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
