import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { useSyncExternalStore } from 'react'
import { mergeRecords, newId, NOTE_MAX, type Best, type BestStyle, type PersonalExport, type Tick } from './model'

interface PersonalDB extends DBSchema {
  ticks: { key: string; value: Tick; indexes: { byRoute: string } }
  best: { key: string; value: Best }
}

let dbPromise: Promise<IDBPDatabase<PersonalDB>> | undefined

function db(): Promise<IDBPDatabase<PersonalDB>> {
  // 版本 2：新增 best（路線清單的最佳攀登方式）；從版本 1 升級時保留原有的紀錄
  dbPromise ??= openDB<PersonalDB>('longdong-personal', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore('ticks', { keyPath: 'id' }).createIndex('byRoute', 'routeId')
      if (oldVersion < 2) d.createObjectStore('best', { keyPath: 'routeId' })
    },
  })
  return dbPromise
}

/* ---------- 記憶體快照：資料量小，全部載入，畫面用 useSyncExternalStore 訂閱 ---------- */

export interface PersonalState {
  ready: boolean
  /** 未刪除的紀錄，日期新到舊 */
  ticks: Tick[]
  /** 路線清單勾選的最佳攀登方式：routeId → 方式 */
  best: Map<string, BestStyle>
  error?: string
}

let state: PersonalState = { ready: false, ticks: [], best: new Map() }
const listeners = new Set<() => void>()

function emit(next: PersonalState) {
  state = next
  for (const l of listeners) l()
}

export async function refresh(): Promise<void> {
  try {
    const d = await db()
    const [ticks, best] = await Promise.all([d.getAll('ticks'), d.getAll('best')])
    emit({
      ready: true,
      ticks: ticks.filter((t) => !t.deleted).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      best: new Map(best.filter((b) => !b.deleted).map((b) => [b.routeId, b.style])),
    })
  } catch (err) {
    // 私密瀏覽等情況可能無法使用 IndexedDB
    emit({ ...state, ready: true, error: (err as Error).message })
  }
}

let started = false
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    started = true
    void refresh()
  }
  return () => listeners.delete(listener)
}

export function usePersonal(): PersonalState {
  return useSyncExternalStore(subscribe, () => state)
}

/* ---------- 寫入 ---------- */

const now = () => new Date().toISOString()

/** 本機寫入後通知（雲端同步用） */
export type LocalWrite = { tick: Tick } | { best: Best }
const writeListeners = new Set<(w: LocalWrite) => void>()
export function onLocalWrite(listener: (w: LocalWrite) => void): () => void {
  writeListeners.add(listener)
  return () => writeListeners.delete(listener)
}
function notify(w: LocalWrite) {
  for (const l of writeListeners) l(w)
}

export async function addTick(input: Pick<Tick, 'routeId' | 'date' | 'style' | 'note'>): Promise<void> {
  // 超過上限的備註會被資料庫規則拒絕，同步時不斷重寫；在寫入本機前就拒絕
  if (input.note && input.note.length > NOTE_MAX) throw new Error(`note longer than ${NOTE_MAX}`)
  const t = now()
  const tick: Tick = { id: newId(), ...input, createdAt: t, updatedAt: t }
  if (!tick.note) delete tick.note
  await (await db()).put('ticks', tick)
  await refresh()
  notify({ tick })
}

export async function deleteTick(id: string): Promise<void> {
  const d = await db()
  const tick = await d.get('ticks', id)
  if (!tick) return
  // 刪除標記不留備註：已刪除的不需要，也讓本機留有超過上限備註的舊紀錄能被刪掉並同步
  const deleted: Tick = { id: tick.id, routeId: tick.routeId, date: tick.date, style: tick.style, createdAt: tick.createdAt, updatedAt: now(), deleted: true }
  await d.put('ticks', deleted)
  await refresh()
  notify({ tick: deleted })
}

/** 路線清單：設定一條路線的最佳攀登方式；null 為清除 */
export async function setBest(routeId: string, style: BestStyle | null): Promise<void> {
  const d = await db()
  const existing = await d.get('best', routeId)
  const t = now()
  const best: Best = { routeId, style: style ?? existing?.style ?? 'redpoint', createdAt: existing?.createdAt ?? t, updatedAt: t, deleted: style === null }
  await d.put('best', best)
  await refresh()
  notify({ best })
}

/* ---------- 整批讀寫（雲端同步用） ---------- */

export async function exportAll(): Promise<PersonalExport> {
  const d = await db()
  const [ticks, best] = await Promise.all([d.getAll('ticks'), d.getAll('best')])
  // 刪除標記也一起帶上，同步到其他裝置時才不會把刪掉的紀錄救回來
  return { format: 'longdong-personal', version: 1, exportedAt: now(), ticks, best }
}

/** 依「較新者為準」寫入一批紀錄（雲端同步用），回傳實際更新的筆數 */
export async function applyRecords(ticksIn: Tick[], bestIn: Best[] = []): Promise<{ ticks: number; best: number }> {
  const d = await db()
  const [ticks, best] = await Promise.all([d.getAll('ticks'), d.getAll('best')])
  const tk = mergeRecords(ticks, ticksIn, (t) => t.id).changed
  const bs = mergeRecords(best, bestIn, (b) => b.routeId).changed
  if (tk.length === 0 && bs.length === 0) return { ticks: 0, best: 0 }
  const tx = d.transaction(['ticks', 'best'], 'readwrite')
  await Promise.all([
    ...tk.map((t) => tx.objectStore('ticks').put(t)),
    ...bs.map((b) => tx.objectStore('best').put(b)),
    tx.done,
  ])
  await refresh()
  return { ticks: tk.length, best: bs.length }
}

/** 清空本機的紀錄（切換成另一個帳號、且使用者選擇不合併時） */
export async function clearAll(): Promise<void> {
  const d = await db()
  const tx = d.transaction(['ticks', 'best'], 'readwrite')
  await Promise.all([tx.objectStore('ticks').clear(), tx.objectStore('best').clear(), tx.done])
  await refresh()
}
