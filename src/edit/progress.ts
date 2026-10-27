import type { Marks } from '../topo/model'
import type { EditItem } from './Catalog'

/** 完成度：done 個，共 total 個 */
export interface Progress {
  done: number
  total: number
}

/** 地圖、說明：已經有人修改過的項目數 */
export function itemProgress(items: EditItem[], kind: EditItem['kind']): Progress {
  const of = items.filter((i) => i.kind === kind)
  return { done: of.filter((i) => i.edited).length, total: of.length }
}

/** Topo：在任一張照片目前顯示的版本裡，已經畫了線段的路線數（同一條路線出現在多張照片只算一次） */
export function topoProgress(routeIds: string[], latestMarks: Marks[]): Progress {
  const marked = new Set(
    latestMarks.flatMap((m) =>
      Object.entries(m)
        .filter(([, r]) => r.line?.length)
        .map(([id]) => id),
    ),
  )
  return { done: routeIds.filter((id) => marked.has(id)).length, total: routeIds.length }
}
