import { useEffect, useSyncExternalStore } from 'react'
import { get } from '../social/store'
import { routeKey } from '../social/model'

/**
 * 區域、路線說明的修改（所有登入者，版本同 Topo 與地圖編輯）：
 *   /v2/textEdits/area:<大區域>/<版本>        { uid, createdAt, text }   區域說明（資料裡原本沒有）
 *   /v2/textEdits/route:<路線 key>/<版本>     { uid, createdAt, text }   取代路線說明（TOCC 原文仍可展開查看）
 * 顯示最新的版本；最新版本是空字串表示改回原文（或沒有說明）。難度、Bolt、拉測、安全評級不開放修改。
 * 任何人都能讀（REST，Service Worker 快取最後一次讀到的）；本人與管理員可以刪除版本。
 */

export type TextTarget = `area:${string}` | `route:${string}`

export interface TextVersion {
  id: string
  uid: string
  createdAt: number
  text: string
}

export const textTarget = {
  /** 大區域 key（school-gate） */
  area: (key: string): TextTarget => `area:${key}`,
  route: (routeId: string): TextTarget => `route:${routeKey(routeId)}`,
}

type Stored = Record<string, Record<string, Omit<TextVersion, 'id'>>>

export function decodeTextEdits(raw: Stored | null): Record<string, TextVersion[]> {
  return Object.fromEntries(
    Object.entries(raw ?? {}).map(([target, list]) => [
      target,
      Object.entries(list)
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => a.createdAt - b.createdAt),
    ]),
  )
}

/** 目前顯示的說明：最新的版本有內容時；空字串（改回原文）或沒有版本時 undefined */
export function currentText(versions: TextVersion[] | undefined): TextVersion | undefined {
  const latest = versions?.at(-1)
  return latest?.text.trim() ? latest : undefined
}

let state: Record<string, TextVersion[]> = {}
let loading: Promise<void> | undefined
const listeners = new Set<() => void>()

export function loadTextEdits(force = false): Promise<void> {
  if (loading && !force) return loading
  loading = get<Stored>('v2/textEdits').then(
    (raw) => {
      state = decodeTextEdits(raw)
      listeners.forEach((l) => l())
    },
    (err: Error) => {
      loading = undefined
      console.warn('textEdits', err)
    },
  )
  return loading
}

/** 所有說明的版本（對象 → 舊到新） */
export function useTextEdits(): Record<string, TextVersion[]> {
  useEffect(() => {
    void loadTextEdits()
  }, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
