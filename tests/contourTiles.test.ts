import { describe, expect, it } from 'vitest'
import { COAST_RGB, CONTOUR_RGB, keepContours } from '../src/map/contourTiles'

describe('地形圖只留等高線', () => {
  it('洋紅色（等高線）、藍色（海岸線）各換成自己的顏色；黑色的高程點、注記與其他顏色變透明', () => {
    const px = Uint8ClampedArray.from([255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])
    keepContours(px)
    expect([...px.slice(0, 4)]).toEqual([...CONTOUR_RGB, 255])
    expect([...px.slice(4, 8)]).toEqual([...COAST_RGB, 255])
    expect([px[11], px[15]]).toEqual([0, 0])
  })
})
