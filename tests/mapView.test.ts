import { describe, expect, it } from 'vitest'
import { project, unproject } from '../src/map/mapData'
import { centerPending } from '../src/map/mapView'

describe('地圖範圍', () => {
  it('龍洞的救援點在範圍內；台北不在', async () => {
    const { inMapBounds } = await import('../src/map/bounds')
    expect(inMapBounds([25.111367, 121.922917])).toBe(true)
    expect(inMapBounds([25.0478, 121.517])).toBe(false)
  })

  it('資料範圍：移動範圍四周各多 300 公尺以上（北邊停在鼻頭隧道以南）；畫面最寬就是資料範圍的寬', async () => {
    const { BOUNDS, EXTENT } = await import('../src/map/bounds')
    expect(BOUNDS.x - EXTENT.x).toBeGreaterThan(300)
    expect(EXTENT.x + EXTENT.w - (BOUNDS.x + BOUNDS.w)).toBeGreaterThan(300)
    expect(BOUNDS.y - EXTENT.y).toBeGreaterThan(300)
    expect(EXTENT.y + EXTENT.h - (BOUNDS.y + BOUNDS.h)).toBeGreaterThan(300)
    // 範圍的北邊在鼻頭隧道（北緯 25.1191）以南
    expect(unproject([0, EXTENT.y])[0]).toBeLessThan(25.1191)
  })

  it('龍洞街與台二線的路口（121.9121）在移動範圍的西邊之內，西邊只多一點點', async () => {
    const { BOUNDS } = await import('../src/map/bounds')
    const x = project([25.1126, 121.9121])[0]
    expect(x).toBeGreaterThan(BOUNDS.x)
    expect(x - BOUNDS.x).toBeLessThan(150)
  })
})

describe('定位到時要不要自動移到目前位置', () => {
  it('打開時沒有聚焦，之後從清單選了救援點：定位到也不移過去', () => {
    const atOpen = { focus: undefined }
    expect(centerPending(atOpen, undefined)).toBe(true)
    expect(centerPending(atOpen, 'rescue:12-b1:1')).toBe(false)
  })

  it('聚焦後按「回到我的位置」：在同一個聚焦下定位到就移過去；之後又選了別的就不移', () => {
    const request = { focus: 'rescue:12-b1:1' }
    expect(centerPending(request, 'rescue:12-b1:1')).toBe(true)
    expect(centerPending(request, 'ems:6:2')).toBe(false)
    expect(centerPending(undefined, undefined)).toBe(false)
  })
})
