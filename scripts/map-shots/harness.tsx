import { createRoot } from 'react-dom/client'
import { indexDataset } from '../../src/data/dataset'
import type { Dataset } from '../../src/data/schema'
import type { LatLng } from '../../src/geo'
import { setLangSetting } from '../../src/i18n'
import { KitMap, type KitMapFocus, type MapEdit } from '../../src/map/KitMap'
import { loadScaleMap, unproject } from '../../src/map/mapData'
import '../../src/styles.css'
import type { MapScene } from './scenes'

/**
 * 地圖截圖基準的頁面（scripts/map-shots.ts 開啟）：照 window.__scene 畫一個 KitMap（mapkit），
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
const area = scene.focus?.area && `${dataset.crag.id}/${scene.focus.area}`
const focus: KitMapFocus | undefined = scene.focusWalls
  ? { key: 'scene', coords: scene.focusWalls.flatMap((id) => (map.walls[id] ?? []).flat()), tight: true }
  : scene.focus && { key: 'scene', ...(area ? { area } : {}), ...(scene.focus.coords ? { coords: scene.focus.coords } : {}), ...(scene.focus.tight ? { tight: true } : {}) }
const selected = scene.selectedWall && { sector: scene.selectedWall.split('#')[0], line: Number(scene.selectedWall.split('#')[1]) }

const root = document.getElementById('root')!
root.style.cssText = `width:${scene.width}px;height:${scene.height}px;position:relative;overflow:hidden`
createRoot(root).render(
  <KitMap
    map={map}
    data={data}
    marks={scene.marks}
    here={scene.here}
    pick={scene.pick ? { at: scene.pick, onPick: () => {} } : undefined}
    focus={focus}
    selected={selected || undefined}
    walls={!!scene.walls}
    sectorLabels={!!scene.walls}
    hideAreas={scene.hideAreas}
    edit={edit}
    editable={!!scene.edit}
    draft={scene.draft}
    onLocate={scene.here ? () => {} : undefined}
  />,
)

// 畫好（底圖載入、框量到大小、SVG 出現）再等兩個畫格（聚焦、編輯的形狀在下一個畫格才畫）
const until = () => new Promise<void>((resolve) => {
  const tick = () => (root.querySelector('svg g[transform]') ? requestAnimationFrame(() => requestAnimationFrame(() => resolve())) : requestAnimationFrame(tick))
  tick()
})
await until()
await document.fonts.ready
window.__ready = true
