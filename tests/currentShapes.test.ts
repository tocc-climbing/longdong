import { describe, expect, it } from 'vitest'
import { currentShapes } from '../src/edit/useMapItem'
import { project, unproject, type ScaleMapData } from '../src/map/mapData'

describe('currentShapes：編輯框的形狀', () => {
  // 一塊中間有個離直線只有 1 公尺的點：最新版本、原始版都要原樣給編輯框
  const [x, y] = project([25.107, 121.92])
  const ring = [[x, y], [x + 50, y + 1], [x + 100, y], [x + 100, y + 100], [x, y + 100]].map((p) => unproject(p as [number, number]))
  const map = { areas: [{ id: 'a', rings: [ring.map(project)] }], lineLayers: {} } as unknown as ScaleMapData

  it('有提交過的最新版本：原樣使用，和地圖上畫的一致', () => {
    expect(currentShapes('area:a', map, [ring])).toEqual([ring])
  })

  it('沒有最新版本：用原始版，不簡化（精修過的細節要留著）', () => {
    expect(currentShapes('area:a', map, undefined)[0]).toHaveLength(ring.length)
  })
})
