import { useSyncExternalStore } from 'react'
import type { LatLng } from '../geo'
import { project, unproject } from '../map/mapData'
import { currentMapShapes, encodeShapes, isLineTarget, isOpenTarget, loadMapShapes, sectorOf, simplifyLine, simplifyRing, type EditTarget, type MapShapes } from '../map/shapes'
import { withCloud } from '../personal/sync'

/**
 * 地圖修改的草稿：提交前所有修改（可以跨好幾個區域）只存在記憶體，一次全部提交，提交前不和伺服器通訊。
 * 提交時整頁鎖住（submitting），全部寫入並讀回確認後才解鎖；成功的項目清掉草稿，失敗的保留並記下原因，可以再按提交。
 */

export interface Draft {
  rings: LatLng[][]
  past: LatLng[][][]
  future: LatLng[][][]
}

interface DraftState {
  drafts: Readonly<Record<string, Draft>>
  submitting: boolean
  /** 上次提交失敗的項目 → 原因 */
  errors: Readonly<Record<string, string>>
}

/** 復原最多記幾步 */
const UNDO_LIMIT = 100
/** 提交前合併的誤差（公尺）：幾乎在一條直線上、或靠得很近的點刪掉（約航照兩個像素，看不出差別） */
const SUBMIT_SIMPLIFY_M = 0.5

let state: DraftState = { drafts: {}, submitting: false, errors: {} }
const listeners = new Set<() => void>()
const update = (next: Partial<DraftState>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

/** 有改過、還沒提交的項目 */
export const changedTargets = (drafts: DraftState['drafts']) => (Object.entries(drafts) as [EditTarget, Draft][]).filter(([, d]) => isChanged(d)).map(([t]) => t)

export function useDrafts(): DraftState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** 目前的草稿狀態（hook 以外的地方讀，例如測試） */
export const draftsSnapshot = () => state

/** 修改某個項目：from 是沒有草稿時的起點（目前地圖上的形狀），change 回傳新的形狀；記下修改前的形狀供復原 */
export function changeDraft(target: EditTarget, from: LatLng[][], change: (rings: LatLng[][]) => LatLng[][]): void {
  if (state.submitting) return
  const d = state.drafts[target] ?? { rings: from, past: [], future: [] }
  update({ drafts: { ...state.drafts, [target]: { rings: change(d.rings), past: [...d.past, d.rings].slice(-UNDO_LIMIT), future: [] } } })
}

/** 拖曳中：形狀即時更新，復原的檢查點在拖曳開始時另外記（checkpointDraft） */
export function setDraftRings(target: EditTarget, from: LatLng[][], rings: LatLng[][]): void {
  if (state.submitting) return
  const d = state.drafts[target] ?? { rings: from, past: [], future: [] }
  update({ drafts: { ...state.drafts, [target]: { ...d, rings } } })
}

export function checkpointDraft(target: EditTarget, from: LatLng[][]): void {
  if (state.submitting) return
  const d = state.drafts[target] ?? { rings: from, past: [], future: [] }
  update({ drafts: { ...state.drafts, [target]: { rings: d.rings, past: [...d.past, d.rings].slice(-UNDO_LIMIT), future: [] } } })
}

export function undoDraft(target: EditTarget): void {
  const d = state.drafts[target]
  if (state.submitting || !d?.past.length) return
  update({ drafts: { ...state.drafts, [target]: { rings: d.past.at(-1)!, past: d.past.slice(0, -1), future: [d.rings, ...d.future] } } })
}

export function redoDraft(target: EditTarget): void {
  const d = state.drafts[target]
  if (state.submitting || !d?.future.length) return
  update({ drafts: { ...state.drafts, [target]: { rings: d.future[0], past: [...d.past, d.rings], future: d.future.slice(1) } } })
}

/** 放棄全部草稿 */
export function discardDrafts(): void {
  if (state.submitting) return
  update({ drafts: {}, errors: {} })
}

/** 有改過（復原到原樣的草稿不算，不提交一模一樣的新版本） */
export const isChanged = (d: Draft) => d.past.length > 0

/** 可以提交嗎：岩壁可以全部刪掉（空）；大區域、步道、道路至少要有一塊 */
export const canSubmitDraft = (target: EditTarget, d: Draft) => target.startsWith('wall:') || d.rings.length > 0

/** 把草稿套在資料庫讀到的形狀上（地圖上顯示的就是這個：沒提交的修改也看得到） */
export function applyDrafts(shapes: MapShapes, drafts: DraftState['drafts']): MapShapes {
  const out: MapShapes = { ...shapes, areas: { ...shapes.areas }, walls: { ...shapes.walls }, lines: { ...shapes.lines } }
  for (const [target, { rings }] of Object.entries(drafts).filter(([, d]) => isChanged(d))) {
    if (target.startsWith('area:')) out.areas[target.slice('area:'.length)] = rings
    else if (target.startsWith('wall:')) out.walls[sectorOf(target)] = rings
    else if (isLineTarget(target)) out.lines[target] = rings
  }
  return out
}

/** 提交前整理：每塊（每條）以 Douglas–Peucker 刪掉多餘的點；多邊形至少留三點、線段兩點，整理後不夠就保留原樣 */
export function tidyShapes(shapes: LatLng[][], closed: boolean): LatLng[][] {
  return shapes.map((r) => {
    const pts = r.map(project)
    const out = (closed ? simplifyRing(pts, SUBMIT_SIMPLIFY_M) : simplifyLine(pts, SUBMIT_SIMPLIFY_M)).map(unproject)
    return out.length >= (closed ? 3 : 2) ? out : r
  })
}

export interface SubmitResult {
  submitted: number
  failed: number
  /** 自動合併掉的多餘頂點數 */
  merged: number
  /** 寫入了但沒有讀回來（資料庫已有新版本，畫面還沒同步） */
  unsynced: boolean
}

/**
 * 全部提交：依序寫入每個有草稿的項目，再重新讀取確認每個新版本都讀回來了才解鎖。
 * 中途失敗的項目保留草稿與原因，成功的清掉。
 */
export async function submitDrafts(): Promise<SubmitResult> {
  if (state.submitting) return { submitted: 0, failed: 0, merged: 0, unsynced: false }
  update({ submitting: true, errors: {} })
  const written: [EditTarget, string][] = []
  const errors: Record<string, string> = {}
  let merged = 0
  try {
    const { m, uid } = await withCloud()
    for (const [target, draft] of Object.entries(state.drafts) as [EditTarget, Draft][]) {
      if (!isChanged(draft) || !canSubmitDraft(target, draft)) continue
      const closed = !isOpenTarget(target)
      try {
        const tidy = tidyShapes(draft.rings, closed)
        merged += draft.rings.flat().length - tidy.flat().length
        const text = encodeShapes(tidy)
        written.push([target, await m.addMapEdit(uid, target, closed ? { rings: text } : { lines: text })])
      } catch (err) {
        errors[target] = (err as Error).message
      }
    }
  } catch (err) {
    for (const target of Object.keys(state.drafts)) errors[target] = (err as Error).message
  }
  const read = written.length ? await loadMapShapes(true) : true
  const unsynced = !read || written.some(([target, id]) => !currentMapShapes().versions[target]?.some((v) => v.id === id))
  // 讀回來之後才清掉草稿：清掉的瞬間，地圖上就已經是新版本，不會閃回舊的
  update({ drafts: Object.fromEntries(Object.entries(state.drafts).filter(([target]) => !written.some(([t]) => t === target))), submitting: false, errors })
  return { submitted: written.length, failed: Object.keys(errors).length, merged, unsynced }
}
