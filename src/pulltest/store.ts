import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { useSyncExternalStore } from 'react'
import { newId, today } from '../personal/model'
import type { Route } from '../data/schema'
import { newRouteEntry, type Outing, type OutingPhoto } from './model'

/**
 * 拉測回報的本機資料：出勤草稿與照片都存在 IndexedDB，離線也能填寫，關掉 App 不會遺失。
 * 「拉測志工」設定存在這台裝置（localStorage）。
 */

interface PullTestDB extends DBSchema {
  outings: { key: string; value: Outing }
  photos: { key: string; value: OutingPhoto; indexes: { byOuting: string } }
}

let dbPromise: Promise<IDBPDatabase<PullTestDB>> | undefined

function db(): Promise<IDBPDatabase<PullTestDB>> {
  dbPromise ??= openDB<PullTestDB>('longdong-pulltest', 1, {
    upgrade(d) {
      d.createObjectStore('outings', { keyPath: 'id' })
      d.createObjectStore('photos', { keyPath: 'id' }).createIndex('byOuting', 'outingId')
    },
  })
  return dbPromise
}

/* ---------- 拉測志工設定 ---------- */

const VOLUNTEER_KEY = 'longdong.pulltest.volunteer'

function readVolunteer(): boolean {
  try {
    return localStorage.getItem(VOLUNTEER_KEY) === '1'
  } catch {
    return false
  }
}

let volunteer = readVolunteer()
const volunteerListeners = new Set<() => void>()

export function setVolunteer(on: boolean): void {
  volunteer = on
  try {
    if (on) localStorage.setItem(VOLUNTEER_KEY, '1')
    else localStorage.removeItem(VOLUNTEER_KEY)
  } catch {
    /* 私密瀏覽等情況，只在這次使用有效 */
  }
  for (const l of volunteerListeners) l()
}

export function useVolunteer(): boolean {
  return useSyncExternalStore(
    (l) => {
      volunteerListeners.add(l)
      return () => volunteerListeners.delete(l)
    },
    () => volunteer,
  )
}

/* ---------- 出勤草稿：全部載入記憶體（照片不載入），畫面用 useSyncExternalStore 訂閱 ---------- */

export interface PullTestState {
  ready: boolean
  /** 日期新到舊 */
  outings: Outing[]
  /** 出勤 id → 照片（不含檔案內容）：路線 id + 位置 → 照片 id */
  photos: Map<string, Map<string, string[]>>
  error?: string
}

let state: PullTestState = { ready: false, outings: [], photos: new Map() }
const listeners = new Set<() => void>()

const photoKey = (routeId: string, position: string) => `${routeId}|${position}`

export async function refresh(): Promise<void> {
  try {
    const d = await db()
    const [outings, photos] = await Promise.all([d.getAll('outings'), d.getAll('photos')])
    const byOuting = new Map<string, Map<string, string[]>>()
    for (const p of photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const m = byOuting.get(p.outingId) ?? new Map<string, string[]>()
      const k = photoKey(p.routeId, p.position)
      m.set(k, [...(m.get(k) ?? []), p.id])
      byOuting.set(p.outingId, m)
    }
    state = {
      ready: true,
      outings: outings.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      photos: byOuting,
    }
  } catch (err) {
    // 私密瀏覽等情況可能無法使用 IndexedDB
    state = { ...state, ready: true, error: (err as Error).message }
  }
  for (const l of listeners) l()
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

/** 目前的快照（畫面以外用；畫面用 usePullTests） */
export const currentState = (): PullTestState => state

export function usePullTests(): PullTestState {
  return useSyncExternalStore(subscribe, currentState)
}

/** 一顆 bolt 的照片 id */
export function photosOf(s: PullTestState, outingId: string, routeId: string, position: string): string[] {
  return s.photos.get(outingId)?.get(photoKey(routeId, position)) ?? []
}

/* ---------- 寫入 ---------- */

const now = () => new Date().toISOString()

export async function createOuting(routeEntries: Outing['routes'] = []): Promise<Outing> {
  const t = now()
  const outing: Outing = { id: newId(), date: today(), crew: [], routes: routeEntries, createdAt: t, updatedAt: t }
  await (await db()).put('outings', outing)
  await refresh()
  return outing
}

export async function saveOuting(outing: Outing): Promise<void> {
  await (await db()).put('outings', { ...outing, updatedAt: now() })
  await refresh()
}

/** 刪除出勤草稿與它的照片 */
export async function deleteOuting(id: string): Promise<void> {
  const d = await db()
  const tx = d.transaction(['outings', 'photos'], 'readwrite')
  const photoIds = await tx.objectStore('photos').index('byOuting').getAllKeys(id)
  await Promise.all([tx.objectStore('outings').delete(id), ...photoIds.map((p) => tx.objectStore('photos').delete(p)), tx.done])
  await refresh()
}

export async function addPhoto(outingId: string, routeId: string, position: string, blob: Blob): Promise<void> {
  await (await db()).put('photos', { id: newId(), outingId, routeId, position, blob, createdAt: now() })
  await refresh()
}

export async function deletePhoto(id: string): Promise<void> {
  await (await db()).delete('photos', id)
  await refresh()
}

/** 刪掉一條路線的照片（從出勤移除路線時） */
export async function deleteRoutePhotos(outingId: string, routeId: string): Promise<void> {
  const d = await db()
  const photos = await d.getAllFromIndex('photos', 'byOuting', outingId)
  const tx = d.transaction('photos', 'readwrite')
  await Promise.all([...photos.filter((p) => p.routeId === routeId).map((p) => tx.store.delete(p.id)), tx.done])
  await refresh()
}

/** 一次出勤的所有照片（含檔案內容，上傳用） */
export async function outingPhotos(outingId: string): Promise<OutingPhoto[]> {
  return (await db()).getAllFromIndex('photos', 'byOuting', outingId)
}

export async function photoBlob(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('photos', id))?.blob
}

/** 把路線加入今天的出勤（沒有就新建一次出勤），回傳出勤 id */
export async function recordRoute(route: Route): Promise<string> {
  await refresh()
  const todays = state.outings.find((o) => o.date === today())
  if (!todays) return (await createOuting([newRouteEntry(route)])).id
  if (!todays.routes.some((r) => r.routeId === route.id)) await saveOuting({ ...todays, routes: [...todays.routes, newRouteEntry(route)] })
  return todays.id
}

/** 出過勤的人員（這台裝置記錄過的），常出現的在前面 */
export function knownCrew(s: PullTestState): string[] {
  const n = new Map<string, number>()
  for (const o of s.outings) for (const c of o.crew) n.set(c, (n.get(c) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}
