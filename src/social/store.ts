import { useEffect, useSyncExternalStore } from 'react'
import { t } from '../i18n'
import { dbUrl, routeKey, type Comment, type Profile, type Rating } from './model'

/**
 * 公開資料用 Realtime Database 的 REST API 讀取（純 fetch，不需要 Firebase SDK），
 * 沒登入的人也能看；Service Worker 會快取最後一次讀到的內容，離線時仍可瀏覽。
 */

interface SocialState {
  /** routeKey → uid → 評分 */
  ratings: Record<string, Record<string, Rating>>
  ratingsLoaded: boolean
  /** uid → 暱稱 */
  profiles: Record<string, Profile>
  /** routeKey → 留言（新到舊，回覆也在裡面，用 parent 分組）；undefined 表示尚未載入 */
  comments: Record<string, Comment[] | undefined>
  /** routeKey → 留言 id → 按讚的人的 uid */
  likes: Record<string, Record<string, string[]>>
  error?: string
}

let state: SocialState = { ratings: {}, ratingsLoaded: false, profiles: {}, comments: {}, likes: {} }
const listeners = new Set<() => void>()
function set(patch: Partial<SocialState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useSocial(): SocialState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** fresh：網址加上一次性參數，Service Worker 的快取對不上，讀不到最新的就失敗，不會拿到舊的 */
export async function get<T>(path: string, fresh = false): Promise<T | null> {
  const url = dbUrl(path)
  const res = await fetch(fresh ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}` : url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T | null
}

let ratingsPromise: Promise<void> | undefined
export function loadRatings(force = false): Promise<void> {
  if (ratingsPromise && !force) return ratingsPromise
  ratingsPromise = Promise.all([
    get<Record<string, Record<string, Rating>>>('v2/ratings'),
    get<Record<string, Profile>>('v2/profiles'),
  ])
    .then(([ratings, profiles]) => set({ ratings: ratings ?? {}, profiles: profiles ?? {}, ratingsLoaded: true }))
    .catch((err: Error) => {
      ratingsPromise = undefined
      set({ ratingsLoaded: true, error: err.message })
    })
  return ratingsPromise
}

export async function loadComments(routeId: string): Promise<void> {
  const key = routeKey(routeId)
  try {
    const raw = await get<Record<string, Omit<Comment, 'id'>>>(`v2/comments/${key}`)
    const list = Object.entries(raw ?? {})
      .map(([id, c]) => ({ id, ...c }))
      .filter((c) => !c.hidden)
      .sort((a, b) => b.createdAt - a.createdAt)
    const likes = await get<Record<string, Record<string, true>>>(`v2/likes/${key}`).catch(() => null)
    set({
      comments: { ...state.comments, [key]: list },
      likes: { ...state.likes, [key]: Object.fromEntries(Object.entries(likes ?? {}).map(([id, byUser]) => [id, Object.keys(byUser)])) },
    })
  } catch (err) {
    set({ comments: { ...state.comments, [key]: state.comments[key] ?? [] }, error: (err as Error).message })
  }
}

/** 路線頁用：進入頁面時載入該路線的留言 */
export function useComments(routeId: string): Comment[] | undefined {
  const social = useSocial()
  useEffect(() => {
    void loadComments(routeId)
  }, [routeId])
  return social.comments[routeKey(routeId)]
}

/** 按讚、取消後更新本機的快取，不必重新下載 */
export function setLocalLike(uid: string, routeId: string, id: string, on: boolean) {
  const key = routeKey(routeId)
  const forRoute = { ...(state.likes[key] ?? {}) }
  const rest = (forRoute[id] ?? []).filter((u) => u !== uid)
  forRoute[id] = on ? [...rest, uid] : rest
  set({ likes: { ...state.likes, [key]: forRoute } })
}

/** 寫入後更新本機的評分快取，不必重新下載 */
export function setLocalRating(uid: string, routeId: string, rating: Rating | null) {
  const key = routeKey(routeId)
  const forRoute = { ...(state.ratings[key] ?? {}) }
  if (rating) forRoute[uid] = rating
  else delete forRoute[uid]
  set({ ratings: { ...state.ratings, [key]: forRoute } })
}

export function setLocalProfile(uid: string, profile: Profile) {
  set({ profiles: { ...state.profiles, [uid]: profile } })
}

export function displayName(profiles: Record<string, Profile>, uid: string): string {
  return profiles[uid]?.name || t('name.default')
}
