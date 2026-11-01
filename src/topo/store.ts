import { useEffect, useSyncExternalStore } from 'react'
import { get } from '../social/store'
import { decodeEdit, type StoredEdit, type TopoEdit, type TopoPhoto } from './model'

/**
 * Topo 用 Realtime Database 的 REST API 讀取（同 social/store.ts）：沒登入也能看，
 * Service Worker 快取最後一次讀到的內容與照片，離線時仍可瀏覽。
 */

interface TopoState {
  /** 照片 id → 照片；undefined 表示尚未載入 */
  photos?: Record<string, TopoPhoto>
  /** 照片 id → 所有版本（舊到新）；undefined 表示尚未載入 */
  edits: Record<string, TopoEdit[] | undefined>
  /** 所有照片的版本都讀過了（loadAllEdits）：這時沒有版本的照片就是還沒人標記 */
  allEdits?: boolean
  error?: string
}

let state: TopoState = { edits: {} }
const listeners = new Set<() => void>()
function set(patch: Partial<TopoState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useTopoState(): TopoState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

let photosPromise: Promise<void> | undefined
export function loadPhotos(force = false): Promise<void> {
  if (photosPromise && !force) return photosPromise
  photosPromise = get<Record<string, Omit<TopoPhoto, 'id'>>>('v2/topos')
    .then((raw) => set({ photos: Object.fromEntries(Object.entries(raw ?? {}).map(([id, p]) => [id, { id, ...p }])) }))
    .catch((err: Error) => {
      photosPromise = undefined
      set({ photos: state.photos ?? {}, error: err.message })
    })
  return photosPromise
}

const editPromises = new Map<string, Promise<void>>()
export function loadEdits(photo: string, force = false): Promise<void> {
  const pending = editPromises.get(photo)
  if (pending && !force) return pending
  const p = get<Record<string, StoredEdit>>(`v2/topoEdits/${photo}`)
    .then((raw) => {
      const list = Object.entries(raw ?? {})
        .map(([id, e]) => decodeEdit(id, e))
        .sort((a, b) => a.createdAt - b.createdAt)
      set({ edits: { ...state.edits, [photo]: list } })
    })
    .catch((err: Error) => {
      editPromises.delete(photo)
      set({ edits: { ...state.edits, [photo]: state.edits[photo] ?? [] }, error: err.message })
    })
  editPromises.set(photo, p)
  return p
}

/** 所有照片的所有版本，一次讀完（編輯模式首頁的最新更新用；個別照片仍用 loadEdits） */
let allEditsPromise: Promise<void> | undefined
export function loadAllEdits(force = false): Promise<void> {
  if (allEditsPromise && !force) return allEditsPromise
  allEditsPromise = get<Record<string, Record<string, StoredEdit>>>('v2/topoEdits')
    .then((raw) => {
      const edits = Object.fromEntries(
        Object.entries(raw ?? {}).map(([photo, list]) => [photo, Object.entries(list).map(([id, e]) => decodeEdit(id, e)).sort((a, b) => a.createdAt - b.createdAt)]),
      )
      set({ edits: { ...state.edits, ...edits }, allEdits: true })
    })
    .catch((err: Error) => {
      allEditsPromise = undefined
      set({ error: err.message })
    })
  return allEditsPromise
}

export interface SectorTopo {
  photo: TopoPhoto
  /** 目前顯示的版本；還沒有人標記時 undefined */
  latest?: TopoEdit
}

/** 分區的 Topo（舊到新）與各自最新的版本；undefined 表示尚未載入 */
export function useSectorTopos(sector: string): SectorTopo[] | undefined {
  const s = useTopoState()
  const photos = s.photos && Object.values(s.photos).filter((p) => p.sector === sector)
  const ids = photos?.map((p) => p.id).join(' ')
  useEffect(() => {
    void loadPhotos()
  }, [])
  useEffect(() => {
    for (const id of ids ? ids.split(' ') : []) void loadEdits(id)
  }, [ids])
  if (!photos) return undefined
  if (photos.some((p) => !s.edits[p.id])) return undefined
  return photos.sort((a, b) => a.createdAt - b.createdAt).map((photo) => ({ photo, latest: s.edits[photo.id]!.at(-1) }))
}
