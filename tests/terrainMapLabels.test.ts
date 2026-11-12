import { describe, expect, it } from 'vitest'
import { layoutTerrainLabels, type TerrainLabel } from '../src/map/terrainMapLabels'

const label = (id: string, kind: string, priority: number): TerrainLabel => ({ id, kind, priority, text: id, title: id, at: [160, 210], width: 64, height: 22, detail: Infinity })
describe('3D 地圖標示避讓', () => {
  it('圖示留在原地，名稱只在旁邊排，重疊時保留救援優先', () => {
    // 突變：取消佔位檢查、允許圖示移位、反轉優先順序。
    const placed = layoutTerrainLabels([label('place', 'place', 8), label('area', 'area', 6), label('aid', 'first-aid', 1), label('rescue', 'rescue', 0)], 360, 640, 4, [[0, 0, 220, 60]])
    expect(placed.map((l) => l.id)).toEqual(['rescue', 'area', 'place'])
    expect(placed[0].x).toBe(160)
    expect(placed[0].y).toBe(210)
    for (const l of placed) expect(Math.hypot(Math.max(0, Math.abs(l.x-l.at[0])-l.width/2), Math.max(0, Math.abs(l.y-l.at[1])-l.height/2))).toBeLessThanOrEqual(18)
    const nearby = layoutTerrainLabels([label('rescue', 'rescue', 0), { ...label('aid', 'first-aid', 1), at: [190, 210] }], 360, 640, 4, [])
    expect(nearby.map((l) => l.id)).toEqual(['rescue'])
    for (let i = 0; i < placed.length; i++) for (let j = i+1; j < placed.length; j++) {
      const a = placed[i].rect, b = placed[j].rect
      expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true)
    }
    expect(layoutTerrainLabels([label('edge', 'area', 1)], 100, 60, 1, [])).toEqual([])
  })
  it('分區與道路細節依比例尺展開，視窗外的標示不黏在邊緣', () => {
    // 突變：拿掉比例尺或視窗篩選。
    const candidates = [{ ...label('sector', 'sector', 8), detail: 1.6 }, { ...label('offscreen', 'place', 7), at: [-20, 300] as [number, number] }]
    expect(layoutTerrainLabels(candidates, 360, 640, 4, [])).toHaveLength(0)
    expect(layoutTerrainLabels(candidates, 360, 640, 1, []).map((l) => l.id)).toEqual(['sector'])
  })
  it('分區以名稱查詢，不再為藍色定位點保留額外佔位', () => {
    // 突變：恢復定位點佔位，附近有圖示時名稱就無法排在旁邊。
    const sector = { ...label('sector', 'sector', 8), detail: 1 }
    const [placed] = layoutTerrainLabels([sector], 360, 640, 0.5, [])
    expect([placed.x, placed.y]).toEqual(sector.at)
    const [beside] = layoutTerrainLabels([sector], 360, 640, 0.5, [[155, 205, 165, 215]])
    expect(beside.rect[3]).toBeLessThanOrEqual(205)
  })
})
