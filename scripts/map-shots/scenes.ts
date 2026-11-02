import type { LatLng } from '../../src/geo'
import type { MapMark } from '../../src/map/ScaleMap'

/** 地圖截圖基準的一個場景（scripts/map-shots.ts）：框的大小、語言、聚焦的對象、疊在上面的東西 */
export interface MapScene {
  name: string
  width: number
  height: number
  lang: 'zh' | 'en' | 'ja'
  /** 聚焦：大區域（其他變淡），或 sectors 的岩壁放大到剛好放進框裡（tight） */
  focus?: { area?: string; coords?: LatLng[]; tight?: boolean }
  focusWalls?: string[]
  /** 畫所有分區的岩壁與分區名稱（同地圖頁）；selectedWall 是選中的那一段（key：分區 ID#第幾條） */
  walls?: boolean
  selectedWall?: string
  /** 編輯：岩壁（wall:分區 ID，標出岩壁面朝向）、大區域（area:key）、步道（trails） */
  edit?: { target: `wall:${string}` | `area:${string}` | 'trails'; selected: number; faces?: boolean }
  hideAreas?: boolean
  /** 正在畫的線（虛線、標出每個點）；closed：多邊形，3 點以上畫出半透明的預覽 */
  draft?: { points: LatLng[]; closed?: boolean }
  marks?: MapMark[]
  here?: { coords: LatLng; accuracy: number }
  pick?: LatLng
}

const GATE_SECTORS = ['longdong/school-gate-4wnzar', 'longdong/school-gate-g6qhy9', 'longdong/school-gate-mi6ob7', 'longdong/school-gate-ppyc81', 'longdong/school-gate-56427g']

export const SCENES: MapScene[] = [
  { name: 'overview-375', width: 375, height: 700, lang: 'zh', walls: true },
  { name: 'overview-en-900', width: 900, height: 600, lang: 'en', walls: true },
  { name: 'overview-ja-375', width: 375, height: 700, lang: 'ja', walls: true },
  { name: 'area-school-gate-375', width: 375, height: 700, lang: 'zh', walls: true, focus: { area: 'school-gate' } },
  { name: 'walls-school-gate-375', width: 375, height: 700, lang: 'zh', walls: true, focusWalls: GATE_SECTORS, selectedWall: 'longdong/school-gate-4wnzar#0' },
  { name: 'edit-wall-faces-375', width: 375, height: 700, lang: 'zh', walls: true, focusWalls: ['longdong/school-gate-4wnzar'], edit: { target: 'wall:longdong/school-gate-4wnzar', selected: 0, faces: true } },
  { name: 'edit-area-375', width: 375, height: 700, lang: 'zh', focus: { area: 'music-hall' }, edit: { target: 'area:music-hall', selected: 0 } },
  { name: 'edit-trails-900', width: 900, height: 600, lang: 'zh', hideAreas: true, edit: { target: 'trails', selected: 3 } },
  {
    name: 'draft-polygon-375',
    width: 375,
    height: 700,
    lang: 'zh',
    focus: { area: 'school-gate' },
    draft: { points: [[25.1131, 121.9213], [25.1129, 121.9219], [25.1124, 121.9217], [25.1125, 121.9211]], closed: true },
  },
  {
    name: 'reports-375',
    width: 375,
    height: 700,
    lang: 'zh',
    focus: { area: 'school-gate' },
    here: { coords: [25.1127, 121.9214], accuracy: 12 },
    pick: [25.1123, 121.9209],
    marks: [
      { at: [25.1129, 121.9216], label: '1' },
      { at: [25.1126, 121.922], picked: [25.1128, 121.9221], label: '2', selected: true },
      { at: [25.1121, 121.9212] },
    ],
  },
]
