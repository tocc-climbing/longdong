import type { Pt } from './heroFit'

export type LabelRect = [number, number, number, number]
export interface TerrainLabel {
  id: string
  kind: string
  text: string
  title: string
  at: Pt
  width: number
  height: number
  priority: number
  detail: number
  area?: string
  sector?: string
}
export interface PlacedTerrainLabel extends TerrainLabel {
  x: number
  y: number
  rect: LabelRect
}
const overlaps = (a: LabelRect, b: LabelRect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/** 全部圖示、地名與線名共用同一份螢幕佔位，重要地點先排，空間不足的名稱放大再顯示。 */
export function layoutTerrainLabels(labels: TerrainLabel[], width: number, height: number, metersPerPixel: number, reserved: LabelRect[]): PlacedTerrainLabel[] {
  const occupied = [...reserved], result: PlacedTerrainLabel[] = []
  for (const label of [...labels].sort((a, b) => a.priority-b.priority || a.id.localeCompare(b.id))) {
    if (metersPerPixel > label.detail || label.at[0] < 0 || label.at[0] > width || label.at[1] < 0 || label.at[1] > height) continue
    // 圖示釘在實際位置；名稱只在錨點旁排，不能移遠後再靠引線指回。
    const text = ['area', 'sector', 'place', 'line-name'].includes(label.kind)
    const beside: Pt[] = [[0, -label.height/2-18], [0, label.height/2+18], [-label.width/2-18, 0], [label.width/2+18, 0]]
    const offsets: Pt[] = text ? [[0, 0], ...beside] : [[0, 0]]
    for (const [dx, dy] of offsets) {
      const x = label.at[0]+dx, y = label.at[1]+dy
      const rect: LabelRect = [x-label.width/2-3, y-label.height/2-3, x+label.width/2+3, y+label.height/2+3]
      if (rect[0] < 6 || rect[2] > width-6 || rect[1] < 6 || rect[3] > height-20 || occupied.some((r) => overlaps(rect, r))) continue
      occupied.push(rect); result.push({ ...label, x, y, rect }); break
    }
  }
  return result
}
