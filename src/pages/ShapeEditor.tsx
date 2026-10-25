import { useState, type ReactNode } from 'react'
import type { LoadedData } from '../data/dataset'
import type { LatLng } from '../geo'
import { localName, useLang } from '../i18n'
import { areaNames, unproject, type ScaleMapData } from '../map/mapData'
import type { MapEdit, MapLine } from '../map/ScaleMap'
import { encodeRings, loadMapShapes, simplifyRing, useMapShapes } from '../map/shapes'
import { encodeLine } from '../map/walls'
import { withCloud } from '../personal/sync'

/** 自動產生的形狀頂點很密，載入編輯時先簡化到這個誤差（公尺），比較容易拖曳 */
const SIMPLIFY_M = 1.5

interface EditorState {
  /** 「area:<大區域>」或「sector:<分區 ID>」；空字串表示還沒選 */
  target: string
  rings: LatLng[][]
  selected?: number
  /** 正在點出的新多邊形 */
  drawing?: LatLng[]
  dirty: boolean
  saving: boolean
}

/**
 * 管理員編輯地圖多邊形（電腦版地圖頁）：選一個大區域（調整形狀）或分區（畫範圍，可以有多塊），
 * 拖曳頂點、加刪頂點、新增或刪除一塊多邊形，存到資料庫（src/map/shapes.ts），所有人即時看到。
 * 回傳給地圖用的 edit、pick、草稿線，與工具列。
 */
export function useShapeEditor({ data, map, onToast }: { data: LoadedData; map?: ScaleMapData; onToast: (text: string) => void }) {
  const { lang, t } = useLang()
  const shapes = useMapShapes()
  const [state, setState] = useState<EditorState>()
  const names = areaNames(data, lang)

  /** 載入要編輯的形狀：大區域用目前地圖上的（已調整的或自動產生的，先簡化）；分區用已畫的幾塊 */
  const ringsOf = (target: string): LatLng[][] => {
    const [kind, id] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)]
    if (kind === 'area') return (map?.areas.find((a) => a.id === id)?.rings ?? []).map((r) => simplifyRing(r, SIMPLIFY_M).map(unproject))
    if (kind === 'sector') return shapes.sectors.filter((s) => s.sector === id).map((s) => s.ring)
    return []
  }
  const discardOk = () => !state?.dirty || confirm(t('shape.confirmDiscard'))
  const choose = (target: string) => {
    if (!discardOk()) return
    const rings = ringsOf(target)
    setState({ target, rings, selected: rings.length ? 0 : undefined, dirty: false, saving: false })
  }
  const update = (patch: Partial<EditorState>) => setState((s) => s && { ...s, ...patch })
  const close = () => discardOk() && setState(undefined)

  const save = async () => {
    if (!state) return
    const [kind, id] = [state.target.slice(0, state.target.indexOf(':')), state.target.slice(state.target.indexOf(':') + 1)]
    update({ saving: true })
    try {
      const { m, uid } = await withCloud()
      if (kind === 'area') await m.saveAreaShape(uid, id, encodeRings(state.rings))
      else
        await m.saveSectorShapes(
          uid,
          id,
          shapes.sectors.filter((s) => s.sector === id).map((s) => s.id),
          state.rings.map(encodeLine),
        )
      await loadMapShapes(true)
      update({ saving: false, dirty: false })
      onToast(t('shape.saved'))
    } catch (err) {
      update({ saving: false })
      onToast(t('shape.saveFailed', { error: (err as Error).message }))
    }
  }

  const resetArea = async (area: string) => {
    if (!confirm(t('shape.confirmReset'))) return
    try {
      const { m } = await withCloud()
      await m.deleteAreaShape(area)
      await loadMapShapes(true)
      setState(undefined)
      onToast(t('shape.resetDone'))
    } catch (err) {
      onToast(t('shape.saveFailed', { error: (err as Error).message }))
    }
  }

  if (!state) return { active: false, start: () => setState({ target: '', rings: [], dirty: false, saving: false }) }

  const area = state.target.startsWith('area:') ? state.target.slice(5) : undefined
  const drawing = state.drawing
  const edit: MapEdit | undefined = drawing
    ? undefined
    : {
        rings: state.rings,
        selected: state.selected,
        onChange: (rings) => update({ rings, dirty: true }),
        onSelect: (selected) => update({ selected }),
      }
  const pick = drawing ? { onPick: (at: LatLng) => update({ drawing: [...drawing, at] }) } : undefined
  const draftLine: MapLine | undefined = drawing && { key: 'shape-draft', points: drawing.length >= 3 ? [...drawing, drawing[0]] : drawing, draft: true }

  const bar: ReactNode = (
    <div className="map-pick-bar shape-bar" role="status">
      <select value={state.target} onChange={(e) => choose(e.target.value)} aria-label={t('shape.choose')} disabled={!!drawing}>
        <option value="">{t('shape.choose')}</option>
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
              <option key={s.id} value={`sector:${s.id}`}>
                {localName(s.name, lang).main}
                {shapes.sectors.some((x) => x.sector === s.id) ? ' ✓' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {drawing ? (
        <>
          <span>{t('shape.drawHint', { n: drawing.length })}</span>
          <button type="button" className="action" disabled={drawing.length === 0} onClick={() => update({ drawing: drawing.slice(0, -1) })}>
            {t('wall.undo')}
          </button>
          <button
            type="button"
            className="action primary"
            disabled={drawing.length < 3}
            onClick={() => update({ rings: [...state.rings, drawing], selected: state.rings.length, drawing: undefined, dirty: true })}
          >
            {t('shape.finish')}
          </button>
          <button type="button" className="action" onClick={() => update({ drawing: undefined })}>
            {t('map.cancel')}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="action" disabled={!state.target} onClick={() => update({ drawing: [] })}>
            {t('shape.add')}
          </button>
          <button
            type="button"
            className="action"
            disabled={state.selected === undefined}
            onClick={() => update({ rings: state.rings.filter((_, i) => i !== state.selected), selected: undefined, dirty: true })}
          >
            {t('shape.removeRing')}
          </button>
          {area && shapes.areas[area] && (
            <button type="button" className="action" onClick={() => void resetArea(area)}>
              {t('shape.reset')}
            </button>
          )}
          <button type="button" className="action primary" disabled={!state.dirty || state.saving || (!!area && state.rings.length === 0)} onClick={() => void save()}>
            {t('shape.save')}
          </button>
          <button type="button" className="action" onClick={close}>
            {t('shape.close')}
          </button>
          {state.target && <span className="shape-hint">{t('shape.hint')}</span>}
        </>
      )}
    </div>
  )

  return { active: true, bar, edit, pick, draftLine }
}
