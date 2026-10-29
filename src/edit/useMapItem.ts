import { useMemo, useState } from 'react'
import type { LatLng } from '../geo'
import { project, unproject, type ScaleMapData } from '../map/mapData'
import type { MapEdit, MapLine } from '../map/ScaleMap'
import { LINE_TARGETS, isLineTarget, isOpenTarget, sectorOf, simplifyLine, useMapShapes, type EditTarget } from '../map/shapes'
import { canSubmitDraft, changeDraft, checkpointDraft, redoDraft, setDraftRings, undoDraft, useDrafts } from './mapDrafts'

export { tidyShapes } from './mapDrafts'

/** 自動產生的步道、道路頂點很密，載入編輯時先簡化到這個誤差（公尺），比較容易拖曳 */
const SIMPLIFY_M = 1.5
/** 畫步道支線時，點在既有路徑這個距離（螢幕像素）內就接到路徑上 */
const SNAP_PX = 12

/** 點到線段上最近的位置（地圖座標） */
function nearestOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [a[0] + t * dx, a[1] + t * dy]
}

/**
 * 目前地圖上的形狀（最新版本、原始版；自動產生的步道與道路先簡化）
 */
export function currentShapes(target: EditTarget, map: ScaleMapData | undefined, latest: LatLng[][] | undefined): LatLng[][] {
  // 提交過的最新版本優先：地圖上畫的就是它（只有還沒人改過時才用自動產生的），編輯框才不會和畫出來的形狀不同
  if (latest && !target.startsWith('wall:')) return latest
  if (isLineTarget(target)) return (map?.lineLayers[LINE_TARGETS[target]] ?? []).map((l) => simplifyLine(l, SIMPLIFY_M / 2).map(unproject))
  // 大區域的原始版是精修過的，不簡化
  if (target.startsWith('area:')) return (map?.areas.find((a) => a.id === target.slice(5))?.rings ?? []).map((r) => r.map(unproject))
  if (target.startsWith('wall:')) return latest ?? map?.walls[sectorOf(target)] ?? []
  return latest ?? []
}

/**
 * 編輯模式的地圖項目（大區域、分區的岩壁、步道與道路）：從地圖上目前的形狀開始，拖曳頂點、加刪頂點、新增或刪除一塊（一條），
 * 可以復原、重做。修改只存在草稿（mapDrafts.ts），切到別的項目再回來還在；提交是全部項目一起（submitDrafts）。
 * 步道與道路的新路段起點、終點會接到既有的線。
 */
export function useMapItem({ target, map }: { target: EditTarget; map?: ScaleMapData }) {
  const shapes = useMapShapes()
  const { drafts, submitting } = useDrafts()
  const draft = drafts[target]
  const latest = shapes.versions[target]?.at(-1)?.shapes
  const closed = !isOpenTarget(target)
  // 沒有草稿時，形狀就是地圖上目前的（資料庫最新版或原始版）：重新讀到新版本時跟著換，不用另外載入
  const saved = useMemo(() => (map ? currentShapes(target, map, latest) : []), [map, latest])
  const rings = draft?.rings ?? saved
  const [selectedRing, setSelectedRing] = useState<number | undefined>(0)
  const selected = selectedRing !== undefined && selectedRing < rings.length ? selectedRing : undefined
  /** 正在點出的新多邊形或線段 */
  const [drawing, setDrawing] = useState<LatLng[]>()

  const change = (next: LatLng[][], sel = selected) => {
    changeDraft(target, saved, () => next)
    setSelectedRing(sel)
  }

  /** 畫步道、道路時接到既有路徑：離最近的線段 SNAP_PX 內（換算成公尺）就用線段上的那一點；岩壁各段分開，不接 */
  const snap = (at: LatLng, metersPerPixel: number): LatLng => {
    if (!isLineTarget(target)) return at
    const p = project(at)
    const best = rings
      .flatMap((r) => r.slice(1).map((b, i) => nearestOnSegment(p, project(r[i]), project(b))))
      .reduce<[number, number] | undefined>((a, q) => (!a || Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(a[0] - p[0], a[1] - p[1]) ? q : a), undefined)
    return best && Math.hypot(best[0] - p[0], best[1] - p[1]) <= SNAP_PX * metersPerPixel ? unproject(best) : at
  }

  const minPoints = closed ? 3 : 2
  const actions = {
    draw: () => setDrawing([]),
    undoPoint: () => drawing && setDrawing(drawing.slice(0, -1)),
    finishDrawing: () => {
      if (!drawing || drawing.length < minPoints) return
      change([...rings, drawing], rings.length)
      setDrawing(undefined)
    },
    cancel: () => (drawing ? setDrawing(undefined) : setSelectedRing(undefined)),
    removeSelected: () => selected !== undefined && change(rings.filter((_, i) => i !== selected), undefined),
    undo: () => {
      undoDraft(target)
      setSelectedRing(undefined)
    },
    redo: () => {
      redoDraft(target)
      setSelectedRing(undefined)
    },
  }

  // 提交中整個鎖住：不能拖曳、新增
  const edit: MapEdit | undefined =
    drawing || submitting
      ? undefined
      : {
          rings,
          closed,
          selected,
          onChange: (next) => setDraftRings(target, saved, next),
          onChangeStart: () => checkpointDraft(target, saved),
          onSelect: setSelectedRing,
        }
  const pick = drawing && !submitting ? { onPick: (at: LatLng, metersPerPixel: number) => setDrawing([...drawing, snap(at, metersPerPixel)]) } : undefined
  // 多邊形還沒閉環：點本身不補起點，暫時封閉的區域由地圖用半透明顯示（MapLine.closed）
  const draftLine: MapLine | undefined = drawing && { key: 'edit-draft', points: drawing, draft: true, closed }

  return {
    ready: !!map,
    rings,
    closed,
    edit,
    pick,
    draftLine,
    drawing,
    selected,
    count: rings.length,
    locked: submitting,
    canUndo: !!draft?.past.length && !submitting,
    canRedo: !!draft?.future.length && !submitting,
    canFinish: !!drawing && drawing.length >= minPoints,
    canSubmitThis: !draft || canSubmitDraft(target, draft),
    versions: shapes.versions[target] ?? [],
    actions,
  }
}
