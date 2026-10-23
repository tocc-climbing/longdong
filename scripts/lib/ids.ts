import type { Area } from '../../src/data/schema'

export type IdSource = 'legacy' | 'sheet'

/** 上一次發布的路線（用來判斷 ID 是被改掉、還是路線被刪除） */
export interface PublishedRoute {
  id: string
  areaId: string
  number?: string
  name: string
}

export interface PreviousIds {
  idSource?: IdSource
  routes: PublishedRoute[]
}

/** 一次消失超過這麼多個 ID，多半是誤操作（例如整個分頁被清空），擋下 */
export const MAX_REMOVALS_PER_IMPORT = 10

export interface IdCheckResult {
  errors: string[]
  /** 被刪除的路線（放行，記錄在同步紀錄） */
  removed: PublishedRoute[]
}

export function publishedRoutes(areas: Area[]): PublishedRoute[] {
  return areas.flatMap((a) =>
    a.sectors.flatMap((s) => s.routes.map((r) => ({ id: r.id, areaId: a.id, number: r.number, name: r.name.zh }))),
  )
}

/**
 * 路線ID 的防呆檢查：
 * - ID 不可重複
 * - 已發布的 ID 不見了：
 *   - 同編號、同名的路線還在但 ID 不同 → ID 被改掉或清除後重新產生，擋下並提示改回原 ID
 *     （路線編號在全龍洞唯一，搬到別的分頁也找得到；未編號者限同區域）
 *   - 路線本身也不見了 → 視為刪除路線，放行
 *   - 一次刪除超過 MAX_REMOVALS_PER_IMPORT 條 → 多半是誤操作，擋下
 *     （確定要大量刪除時，把 ID 列入 allowRemoved，見 scripts/retired-ids.ts）
 *
 * 從舊規則切換到 Sheet「路線ID」的那一次不檢查消失（舊 ID 本來就會全部換掉）。
 */
export function checkRouteIds(
  idSource: IdSource,
  current: PublishedRoute[],
  previous: PreviousIds | undefined,
  allowRemoved: string[] = [],
): IdCheckResult {
  const errors: string[] = []
  const removed: PublishedRoute[] = []
  if (idSource !== 'sheet') return { errors, removed }

  const byId = new Map<string, PublishedRoute>()
  for (const r of current) {
    const other = byId.get(r.id)
    if (other) errors.push(`路線ID ${r.id} 重複：${other.name}、${r.name}`)
    byId.set(r.id, r)
  }

  if (previous?.idSource !== 'sheet') return { errors, removed }

  const sameRoute = (a: PublishedRoute, b: PublishedRoute) =>
    a.number === b.number && a.name === b.name && (a.number !== undefined || a.areaId === b.areaId)
  const allowed = new Set(allowRemoved)

  for (const old of previous.routes) {
    if (byId.has(old.id)) continue
    const replacement = current.find((r) => sameRoute(r, old))
    if (replacement) {
      errors.push(
        `#${old.number ?? '0'} ${old.name} 的路線ID 從 ${idPart(old.id)} 變成 ${idPart(replacement.id)}，請在 Sheet 把它改回 ${idPart(old.id)}`,
      )
    } else {
      removed.push(old)
    }
  }

  const unexpected = removed.filter((r) => !allowed.has(r.id))
  if (unexpected.length > MAX_REMOVALS_PER_IMPORT) {
    errors.push(
      `一次有 ${unexpected.length} 條路線從 Sheet 消失（超過 ${MAX_REMOVALS_PER_IMPORT} 條），疑似誤刪，已停止同步。` +
        `確定要刪除，請把這些 ID 列入 scripts/retired-ids.ts：${unexpected.map((r) => r.id).join(', ')}`,
    )
  }
  return { errors, removed }
}

function idPart(id: string): string {
  return id.slice(id.indexOf('/') + 1)
}
