import type { RouteInfo } from '../core/topo/TopoView'
import type { Route } from '../data/schema'

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
