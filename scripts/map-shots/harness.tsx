import { createRoot } from 'react-dom/client'
import { indexDataset } from '../../src/data/dataset'
import type { Dataset } from '../../src/data/schema'
import type { LatLng } from '../../src/geo'
import { localName, setLangSetting } from '../../src/i18n'
import { areaNames, loadScaleMap, sectorWalls, unproject } from '../../src/map/mapData'
import { ScaleMap, type MapEdit, type MapFocus, type MapLine, type MapMark } from '../../src/map/ScaleMap'
import { wallLabelAt } from '../../src/map/shapes'
import '../../src/styles.css'
import type { MapScene } from './scenes'

/**
 * 地圖截圖基準的頁面（scripts/map-shots.ts 開啟）：照 window.__scene 畫一個 ScaleMap，
 * 岩壁、分區名稱同地圖頁（MapPage），沒有使用者的修改（原始版）、沒有航照與等高線。畫好後設 window.__ready。
 */
declare global {
  interface Window {
    __scene: MapScene
    __ready?: boolean
  }
}

const scene = window.__scene
await setLangSetting(scene.lang)
const [map, dataset] = await Promise.all([loadScaleMap(), fetch('/data/longdong.json').then((r) => r.json() as Promise<Dataset>)])
const data = indexDataset(dataset)
const empty = { areas: {}, walls: {}, lines: {}, versions: {} }
const walls = sectorWalls(map, empty)
const areaOf = (sector: string) => data.sectorById.get(sector)?.area.id.split('/').pop()

const lines: MapLine[] = [
  ...(scene.walls ? walls.map((w) => ({ key: w.key, points: w.points, label: localName(data.sectorById.get(w.sector)!.sector.name, scene.lang).main, area: areaOf(w.sector), selected: w.key === scene.selectedWall })) : []),
  ...(scene.draft ? [{ key: 'draft', points: scene.draft.points, draft: true, closed: scene.draft.closed }] : []),
]
const sectorLabels = scene.walls
  ? [...data.sectorById].flatMap(([id, { sector }]) => {
      const at = wallLabelAt(walls.filter((w) => w.sector === id).map((w) => w.points))
      return at ? [{ id, text: localName(sector.name, scene.lang).main, at }] : []
    })
  : undefined
const ringsOf = (target: NonNullable<MapScene['edit']>['target']): LatLng[][] =>
  target.startsWith('wall:') ? map.walls[target.slice(5)] : target.startsWith('area:') ? map.areas.find((a) => a.id === target.slice(5))!.rings.map((r) => r.map(unproject)) : map.lineLayers.trail.map((l) => l.map(unproject))
const edit: MapEdit | undefined = scene.edit && {
  rings: ringsOf(scene.edit.target),
  closed: scene.edit.target.startsWith('area:'),
  selected: scene.edit.selected,
  faces: scene.edit.faces,
  onChange: () => {},
  onSelect: () => {},
}
const focus: MapFocus | undefined = scene.focusWalls
  ? { key: 'scene', coords: scene.focusWalls.flatMap((id) => (map.walls[id] ?? []).flat()), tight: true }
  : scene.focus && { key: 'scene', ...scene.focus }
const marks: MapMark[] = scene.marks ?? []

const root = document.getElementById('root')!
root.style.cssText = `width:${scene.width}px;height:${scene.height}px;position:relative;overflow:hidden`
createRoot(root).render(
  <ScaleMap
    map={map}
    areaNames={scene.hideAreas ? {} : areaNames(data, scene.lang)}
    marks={marks}
    here={scene.here}
    pick={scene.pick ? { at: scene.pick, onPick: () => {} } : undefined}
    focus={focus}
    lines={lines}
    sectorLabels={sectorLabels}
    edit={edit}
    hideAreas={scene.hideAreas}
    onLocate={scene.here ? () => {} : undefined}
  />,
)

// 畫好（框量到大小、SVG 出現）再等一個畫格
const until = () => new Promise<void>((resolve) => {
  const tick = () => (root.querySelector('svg g[transform]') ? requestAnimationFrame(() => resolve()) : requestAnimationFrame(tick))
  tick()
})
await until()
await document.fonts.ready
window.__ready = true
