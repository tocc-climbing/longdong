import type { Route } from '../data/schema'

/** 一條路線標記時用到的說明：種類（運攀藍色，其他紅色）、難度、名稱，各 bolt／anchor 的材質 */
export interface RouteInfo {
  kind: 'sport' | 'other'
  grade?: string
  name?: string
  /** 位置（B01、A01）→ 材質（316-TW）；沒有代號的是空字串 */
  bolts: Record<string, string>
}

/** 材質代號（316-TW、Ti-U…）才顯示；「共用」「待查」之類的特殊值不顯示 */
const isMaterialCode = (m: string) => /^[A-Za-z0-9-]+$/.test(m)

export function routeInfo(routes: Route[], nameOf: (r: Route) => string): Map<string, RouteInfo> {
  return new Map(
    routes.map((r) => [
      r.id,
      {
        kind: r.type === 'sport' ? 'sport' : 'other',
        grade: r.grade || undefined,
        name: nameOf(r),
        bolts: Object.fromEntries([...r.bolts, ...r.anchors].map((b) => [b.position, isMaterialCode(b.material) ? b.material : ''])),
      },
    ]),
  )
}
