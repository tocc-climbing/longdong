import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { project } from '../src/map/mapData'
import { ORTHO_DOWNLOAD_MB, orthoDownloadUrls } from '../src/map/ortho'

/** 離線下載的圖磚：areas.geojson 的 9 個區域（地圖座標） */
const areas = (JSON.parse(readFileSync('public/rescue/areas.geojson', 'utf8')) as { features: { geometry: { coordinates: number[][][][] } }[] }).features.map((f) => ({
  rings: f.geometry.coordinates.map((poly) => poly[0].map(([lng, lat]) => project([lat, lng]))),
}))
const urls = orthoDownloadUrls(areas)
const zoomOf = (u: string) => Number(u.split('/').at(-3))
const count = (z: number) => urls.filter((u) => zoomOf(u) === z).length

/** 這個緯度、經度在 z 層的圖磚網址（同 ortho.ts 的網址） */
const tileOf = (lat: number, lng: number, z: number) => {
  const n = 2 ** z
  const r = (lat * Math.PI) / 180
  return `${Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) * (n / 2))}/${Math.floor(((lng + 180) / 360) * n)}`
}
const has = (lat: number, lng: number, z: number) => urls.some((u) => u.endsWith(`/${z}/${tileOf(lat, lng, z)}`))

describe('離線航照下載的圖磚', () => {
  it('最清楚的層級（z19）只在 9 個區域與救援點附近：比整個移動範圍少很多', () => {
    expect(count(19)).toBeGreaterThan(40)
    // 整個移動範圍（約 1.4×1.9 公里）的 z19 有 390 張左右，這裡只留區域附近
    expect(count(19)).toBeLessThan(160)
  })

  it('校門口的區域與救援點在 z19，東邊的海面、西邊的山不在', () => {
    expect(has(25.11272, 121.92216, 19)).toBe(true)
    expect(has(25.1105, 121.9228, 19) || has(25.1105, 121.9229, 19)).toBe(true)
    expect(has(25.1105, 121.9253, 19)).toBe(false)
    expect(has(25.1105, 121.9150, 19)).toBe(false)
  })

  it('移動範圍整個到 z18、資料範圍外圈到 z16', () => {
    expect(has(25.1105, 121.9150, 18)).toBe(true)
    expect(count(19) + count(18)).toBeLessThan(urls.length)
    expect(Math.max(...urls.map(zoomOf))).toBe(19)
    expect(has(25.0970, 121.9300, 16)).toBe(true)
    expect(has(25.0970, 121.9300, 17)).toBe(false)
  })

  it('沒有重複；顯示給使用者的大小（MB）和圖磚數相符（每張平均約 14.6 KB）', () => {
    expect(new Set(urls).size).toBe(urls.length)
    expect(ORTHO_DOWNLOAD_MB).toBe(Math.ceil((urls.length * 14.6) / 1000))
  })
})
