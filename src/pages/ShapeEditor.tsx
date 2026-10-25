import { useEffect, useState, type ReactNode } from 'react'
import type { LoadedData } from '../data/dataset'
import type { LatLng } from '../geo'
import { LOCALES, localName, useLang } from '../i18n'
import { areaNames, project, unproject, type ScaleMapData } from '../map/mapData'
import type { MapEdit, MapLine } from '../map/ScaleMap'
import { encodeShapes, loadMapShapes, sectorTarget, simplifyLine, simplifyRing, useMapShapes, type EditTarget } from '../map/shapes'
import { withCloud } from '../personal/sync'
import { displayName, useSocial } from '../social/store'

/** 自動產生的形狀頂點很密，載入編輯時先簡化到這個誤差（公尺），比較容易拖曳 */
const SIMPLIFY_M = 1.5
/** 畫步道支線時，點在既有路徑這個距離（螢幕像素）內就接到路徑上 */
const SNAP_PX = 12

interface EditorState {
  target: EditTarget | ''
  rings: LatLng[][]
  selected?: number
  /** 正在點出的新多邊形或線段 */
  drawing?: LatLng[]
  dirty: boolean
  saving: boolean
  history: boolean
  /** 刪除版本後，等地圖資料更新再重新載入形狀 */
  reload?: boolean
}

/** 點到線段上最近的位置（地圖座標） */
function nearestOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [a[0] + t * dx, a[1] + t * dy]
}

/**
 * 編輯地圖（電腦版地圖頁，登入者；版本同 Topo）：選一個大區域、分區或步道，
 * 拖曳頂點、加刪頂點、新增或刪除一塊多邊形（步道是一條線段，畫支線時起點、終點會接到既有路徑），提交成新版本（src/map/shapes.ts）。
 * 修改紀錄列出這個對象的所有版本；本人與管理員可以刪除版本，地圖回到前一版。
 * 回傳給地圖用的 edit、pick、草稿線，與工具列。
 */
export function useShapeEditor({ data, map, uid, admin, onToast }: { data: LoadedData; map?: ScaleMapData; uid?: string; admin: boolean; onToast: (text: string) => void }) {
  const { lang, t } = useLang()
  const shapes = useMapShapes()
  const { profiles } = useSocial()
  const [state, setState] = useState<EditorState>()
  const names = areaNames(data, lang)

  /** 載入要編輯的形狀：目前地圖上的（最新版本或自動產生的，先簡化） */
  const ringsOf = (target: EditTarget): LatLng[][] => {
    if (target === 'trails') return (map?.trailLines ?? []).map((l) => simplifyLine(l, SIMPLIFY_M / 2).map(unproject))
    if (target.startsWith('area:')) return (map?.areas.find((a) => a.id === target.slice(5))?.rings ?? []).map((r) => simplifyRing(r, SIMPLIFY_M).map(unproject))
    return shapes.versions[target]?.at(-1)?.shapes ?? []
  }
  const discardOk = () => !state?.dirty || confirm(t('shape.confirmDiscard'))
  const choose = (target: EditTarget | '') => {
    if (!discardOk()) return
    const rings = target ? ringsOf(target) : []
    setState({ target, rings, selected: rings.length ? 0 : undefined, dirty: false, saving: false, history: false })
  }
  const update = (patch: Partial<EditorState>) => setState((s) => s && { ...s, ...patch })
  // 刪除版本後地圖回到前一版：重新載入目前地圖上的形狀
  useEffect(() => {
    if (!state?.reload || !state.target) return
    const rings = ringsOf(state.target)
    setState({ ...state, rings, selected: rings.length ? 0 : undefined, reload: false })
  }, [state?.reload, map, shapes])
  const close = () => discardOk() && setState(undefined)

  const save = async () => {
    if (!state?.target) return
    const target = state.target
    update({ saving: true })
    try {
      const { m, uid: me } = await withCloud()
      const text = encodeShapes(state.rings)
      await m.addMapEdit(me, target, target === 'trails' ? { lines: text } : { rings: text })
      await loadMapShapes(true)
      update({ saving: false, dirty: false })
      onToast(t('shape.saved'))
    } catch (err) {
      update({ saving: false })
      onToast(t('shape.saveFailed', { error: (err as Error).message }))
    }
  }

  const deleteVersion = async (target: EditTarget, id: string) => {
    if (!confirm(t('shape.confirmDeleteVersion'))) return
    try {
      const { m } = await withCloud()
      await m.deleteMapEdit(target, id)
      await loadMapShapes(true)
      onToast(t('shape.versionDeleted'))
      if (!state?.dirty) update({ reload: true })
    } catch (err) {
      onToast(t('shape.saveFailed', { error: (err as Error).message }))
    }
  }

  if (!state) return { active: false, start: () => setState({ target: '', rings: [], dirty: false, saving: false, history: false }) }

  const target = state.target
  const closed = target !== 'trails'
  const drawing = state.drawing
  const minPoints = closed ? 3 : 2
  /** 畫步道時接到既有路徑：離最近的線段 SNAP_PX 內（換算成公尺）就用線段上的那一點 */
  const snap = (at: LatLng, metersPerPixel: number): LatLng => {
    if (closed) return at
    const p = project(at)
    const best = state.rings
      .flatMap((r) => r.slice(1).map((b, i) => nearestOnSegment(p, project(r[i]), project(b))))
      .reduce<[number, number] | undefined>((a, q) => (!a || Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(a[0] - p[0], a[1] - p[1]) ? q : a), undefined)
    return best && Math.hypot(best[0] - p[0], best[1] - p[1]) <= SNAP_PX * metersPerPixel ? unproject(best) : at
  }
  const edit: MapEdit | undefined =
    drawing || !target
      ? undefined
      : {
          rings: state.rings,
          closed,
          selected: state.selected,
          onChange: (rings) => update({ rings, dirty: true }),
          onSelect: (selected) => update({ selected }),
        }
  const pick = drawing ? { onPick: (at: LatLng, metersPerPixel: number) => update({ drawing: [...drawing, snap(at, metersPerPixel)] }) } : undefined
  const draftLine: MapLine | undefined = drawing && { key: 'shape-draft', points: closed && drawing.length >= 3 ? [...drawing, drawing[0]] : drawing, draft: true }
  const versions = target ? (shapes.versions[target] ?? []) : []
  const time = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const canSave = state.dirty && !state.saving && (target.startsWith('sector:') || state.rings.length > 0)

  const bar: ReactNode = (
    <div className="map-pick-bar shape-bar" role="status">
      <select value={target} onChange={(e) => choose(e.target.value as EditTarget | '')} aria-label={t('shape.choose')} disabled={!!drawing}>
        <option value="">{t('shape.choose')}</option>
        <option value="trails">{t('shape.trails')}</option>
        <optgroup label={t('shape.areas')}>
          {Object.entries(names).map(([key, name]) => (
            <option key={key} value={`area:${key}`}>
              {name}
            </option>
          ))}
        </optgroup>
        {data.dataset.areas.map((a) => (
          <optgroup key={a.id} label={localName(a.name, lang).main}>
            {a.sectors.map((s) => (
              <option key={s.id} value={sectorTarget(s.id)}>
                {localName(s.name, lang).main}
                {shapes.versions[sectorTarget(s.id)]?.at(-1)?.shapes.length ? ' ✓' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {drawing ? (
        <>
          <span>{t(closed ? 'shape.drawHint' : 'shape.drawLineHint', { n: drawing.length })}</span>
          <button type="button" className="action" disabled={drawing.length === 0} onClick={() => update({ drawing: drawing.slice(0, -1) })}>
            {t('wall.undo')}
          </button>
          <button
            type="button"
            className="action primary"
            disabled={drawing.length < minPoints}
            onClick={() => update({ rings: [...state.rings, drawing], selected: state.rings.length, drawing: undefined, dirty: true })}
          >
            {t(closed ? 'shape.finish' : 'shape.finishLine')}
          </button>
          <button type="button" className="action" onClick={() => update({ drawing: undefined })}>
            {t('map.cancel')}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="action" disabled={!target} onClick={() => update({ drawing: [] })}>
            {t(closed ? 'shape.add' : 'shape.addLine')}
          </button>
          <button
            type="button"
            className="action"
            disabled={state.selected === undefined}
            onClick={() => update({ rings: state.rings.filter((_, i) => i !== state.selected), selected: undefined, dirty: true })}
          >
            {t('shape.removeRing')}
          </button>
          <button type="button" className="action primary" disabled={!canSave} onClick={() => void save()}>
            {t('shape.save')}
          </button>
          <button type="button" className="action" disabled={!target} aria-pressed={state.history} onClick={() => update({ history: !state.history })}>
            {t('shape.history', { n: versions.length })}
          </button>
          <button type="button" className="action" onClick={close}>
            {t('shape.close')}
          </button>
          {target && <span className="shape-hint">{t('shape.hint')}</span>}
        </>
      )}
      {state.history && target && (
        <ul className="shape-history">
          {versions.length === 0 && <li>{t('shape.noVersions')}</li>}
          {[...versions].reverse().map((v, i) => (
            <li key={v.id}>
              <span>
                {displayName(profiles, v.uid)} · {time(v.createdAt)}
                {i === 0 && <strong> · {t('shape.current')}</strong>}
              </span>
              {(v.uid === uid || admin) && (
                <button type="button" className="link-button" onClick={() => void deleteVersion(target, v.id)}>
                  {t('shape.deleteVersion')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return { active: true, bar, edit, pick, draftLine }
}
