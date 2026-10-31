import { routeKey } from '../social/model'
import { mergeRecords, type Best, type Tick } from './model'

/** 雲端（Realtime Database）上一個使用者的資料：/v2/personal/<uid> */
export interface RemotePersonal {
  ticks?: Record<string, Tick>
  best?: Record<string, Best>
}

export function tickPath(uid: string, id: string): string {
  return `v2/personal/${uid}/ticks/${id}`
}

/** 路線清單的最佳攀登方式，以路線 key 存放（每條路線一筆） */
export function bestPath(uid: string, routeId: string): string {
  return `v2/personal/${uid}/best/${routeKey(routeId)}`
}

/** Realtime Database 不接受 undefined，寫入前去掉 */
export function clean<T extends object>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T
}

/**
 * 比對本機與雲端，回傳各自需要更新的紀錄（同一筆以 updatedAt 較新者為準）：
 * - toLocal：雲端較新或本機沒有 → 寫入本機
 * - toRemote：本機較新或雲端沒有 → 以 multi-path update 寫入雲端
 */
export function reconcile(
  uid: string,
  local: { ticks: Tick[]; best?: Best[] },
  remote: RemotePersonal | null,
): { toLocal: { ticks: Tick[]; best: Best[] }; toRemote: Record<string, unknown> } {
  const remoteTicks = Object.values(remote?.ticks ?? {})
  const remoteBest = Object.values(remote?.best ?? {})
  const localBest = local.best ?? []

  const toLocal = {
    ticks: mergeRecords(local.ticks, remoteTicks, (t) => t.id).changed,
    best: mergeRecords(localBest, remoteBest, (b) => b.routeId).changed,
  }

  const toRemote: Record<string, unknown> = {}
  for (const t of mergeRecords(remoteTicks, local.ticks, (t) => t.id).changed) {
    toRemote[tickPath(uid, t.id)] = clean(t)
  }
  for (const b of mergeRecords(remoteBest, localBest, (b) => b.routeId).changed) {
    toRemote[bestPath(uid, b.routeId)] = clean(b)
  }
  return { toLocal, toRemote }
}
