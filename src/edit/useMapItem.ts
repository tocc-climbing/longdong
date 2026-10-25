import { useEffect, useState } from 'react'
import type { LatLng } from '../geo'
import { useLang } from '../i18n'
import { project, unproject, type ScaleMapData } from '../map/mapData'
import type { MapEdit, MapLine } from '../map/ScaleMap'
import { encodeShapes, loadMapShapes, simplifyLine, simplifyRing, useMapShapes, type EditTarget } from '../map/shapes'
import { withCloud } from '../personal/sync'

/** 自動產生的形狀頂點很密，載入編輯時先簡化到這個誤差（公尺），比較容易拖曳 */
const SIMPLIFY_M = 1.5
/** 畫步道支線時，點在既有路徑這個距離（螢幕像素）內就接到路徑上 */
const SNAP_PX = 12
/** 復原最多記幾步 */
const UNDO_LIMIT = 100

/** 點到線段上最近的位置（地圖座標） */
function nearestOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [a[0] + t * dx, a[1] + t * dy]
}

/** 目前地圖上的形狀（最新版本或自動產生的，先簡化） */
export function currentShapes(target: EditTarget, map: ScaleMapData | undefined, latest: LatLng[][] | undefined): LatLng[][] {
  if (target === 'trails') return (map?.trailLines ?? []).map((l) => simplifyLine(l, SIMPLIFY_M / 2).map(unproject))
  if (target.startsWith('area:')) return (map?.areas.find((a) => a.id === target.slice(5))?.rings ?? []).map((r) => simplifyRing(r, SIMPLIFY_M).map(unproject))
  return latest ?? []
}

interface State {
  rings: LatLng[][]
  selected?: number
  /** 正在點出的新多邊形或線段 */
  drawing?: LatLng[]
  past: LatLng[][][]
  future: LatLng[][][]
  dirty: boolean
  saving: boolean
}

/**
 * 修改模式的地圖項目（大區域、分區範圍、步道）：載入目前的形狀，拖曳頂點、加刪頂點、新增或刪除一塊（一條），
 * 可以復原、重做；提交成新版本（src/map/shapes.ts）。步道的新路徑起點、終點會接到既有路徑。
 */
export function useMapItem({ target, map, onToast }: { target: EditTarget; map?: ScaleMapData; onToast: (text: string) => void }) {
  const { t } = useLang()
  const shapes = useMapShapes()
  const [state, setState] = useState<State>()
  const latest = shapes.versions[target]?.at(-1)?.shapes
  const closed = target !== 'trails'

  // 地圖資料載入後載入目前的形狀（換項目時元件重新建立，見 EditPage）
  const load = () => {
    const rings = currentShapes(target, map, latest)
    setState({ rings, selected: rings.length ? 0 : undefined, past: [], future: [], dirty: false, saving: false })
  }
  useEffect(() => {
    if (map && !state) load()
  }, [!!map])

  const s = state ?? { rings: [], past: [], future: [], dirty: false, saving: false }
  const set = (patch: Partial<State>) => setState((x) => x && { ...x, ...patch })
  /** 記下修改前的形狀（復原用），清掉重做 */
  const checkpoint = () => setState((x) => x && { ...x, past: [...x.past, x.rings].slice(-UNDO_LIMIT), future: [] })
  const change = (rings: LatLng[][], selected = s.selected) => setState((x) => x && { ...x, past: [...x.past, x.rings].slice(-UNDO_LIMIT), future: [], rings, selected, dirty: true })

  /** 畫步道時接到既有路徑：離最近的線段 SNAP_PX 內（換算成公尺）就用線段上的那一點 */
  const snap = (at: LatLng, metersPerPixel: number): LatLng => {
    if (closed) return at
    const p = project(at)
    const best = s.rings
      .flatMap((r) => r.slice(1).map((b, i) => nearestOnSegment(p, project(r[i]), project(b))))
      .reduce<[number, number] | undefined>((a, q) => (!a || Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(a[0] - p[0], a[1] - p[1]) ? q : a), undefined)
    return best && Math.hypot(best[0] - p[0], best[1] - p[1]) <= SNAP_PX * metersPerPixel ? unproject(best) : at
  }

  const minPoints = closed ? 3 : 2
  const actions = {
    draw: () => set({ drawing: [] }),
    undoPoint: () => s.drawing && set({ drawing: s.drawing.slice(0, -1) }),
    finishDrawing: () => {
      if (!s.drawing || s.drawing.length < minPoints) return
      const drawing = s.drawing
      setState((x) => x && { ...x, past: [...x.past, x.rings].slice(-UNDO_LIMIT), future: [], rings: [...x.rings, drawing], selected: x.rings.length, drawing: undefined, dirty: true })
    },
    cancel: () => (s.drawing ? set({ drawing: undefined }) : set({ selected: undefined })),
    removeSelected: () => s.selected !== undefined && change(s.rings.filter((_, i) => i !== s.selected), undefined),
    undo: () =>
      setState((x) => (x && x.past.length ? { ...x, rings: x.past.at(-1)!, past: x.past.slice(0, -1), future: [x.rings, ...x.future], selected: undefined, dirty: true } : x)),
    redo: () =>
      setState((x) => (x && x.future.length ? { ...x, rings: x.future[0], future: x.future.slice(1), past: [...x.past, x.rings], selected: undefined, dirty: true } : x)),
    reload: load,
    submit: async () => {
      if (!state) return
      set({ saving: true })
      try {
        const { m, uid } = await withCloud()
        const text = encodeShapes(state.rings)
        await m.addMapEdit(uid, target, target === 'trails' ? { lines: text } : { rings: text })
        await loadMapShapes(true)
        set({ saving: false, dirty: false })
        onToast(t('shape.saved'))
      } catch (err) {
        set({ saving: false })
        onToast(t('shape.saveFailed', { error: (err as Error).message }))
      }
    },
  }

  const edit: MapEdit | undefined = s.drawing
    ? undefined
    : {
        rings: s.rings,
        closed,
        selected: s.selected,
        onChange: (rings) => set({ rings, dirty: true }),
        onChangeStart: checkpoint,
        onSelect: (selected) => set({ selected }),
      }
  const pick = s.drawing ? { onPick: (at: LatLng, metersPerPixel: number) => set({ drawing: [...s.drawing!, snap(at, metersPerPixel)] }) } : undefined
  const draftLine: MapLine | undefined = s.drawing && { key: 'edit-draft', points: closed && s.drawing.length >= 3 ? [...s.drawing, s.drawing[0]] : s.drawing, draft: true }

  return {
    ready: !!state,
    rings: s.rings,
    closed,
    edit,
    pick,
    draftLine,
    drawing: s.drawing,
    selected: s.selected,
    count: s.rings.length,
    dirty: s.dirty,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    canFinish: !!s.drawing && s.drawing.length >= minPoints,
    canSubmit: s.dirty && !s.saving && (target.startsWith('sector:') || s.rings.length > 0),
    versions: shapes.versions[target] ?? [],
    actions,
  }
}
