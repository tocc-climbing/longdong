import { describe, expect, it } from 'vitest'
import { validate, type Topo } from '../vendor/climbio-format/format'
import { toCamera } from '../src/core/format/camera'

const exif = { exifLat: 25.1041, exifLng: 121.9232, exifAlt: 12, exifHeading: 312, exifHeadingRef: 'T' as const, time: 1761620000000, model: 'iPhone 15', focal35: 26 }

describe('拍照資料換成 photo.camera', () => {
  it('位置經度在前，帶高度；朝向、時間、焦距、機型照抄，通過官方驗證', () => {
    const camera = toCamera(exif)
    expect(camera).toEqual({ position: [121.9232, 25.1041, 12], heading: 312, t: 1761620000000, focal: 26, model: 'iPhone 15' })
    const doc: Topo = {
      climbio: 2,
      kind: 'topo',
      id: 'p',
      name: 'n',
      license: 'CC-BY-SA-4.0',
      t: 1,
      photo: { href: 'p.webp', w: 10, h: 10, mime: 'image/webp', license: 'CC-BY-SA-4.0', attribution: 'KK', origin: 'self', camera },
      routes: {},
    }
    expect(validate(doc)).toEqual([])
  })

  it('沒有高度只寫經緯度', () => {
    expect(toCamera({ exifLat: 25, exifLng: 121 })).toEqual({ position: [121, 25] })
  })

  it('沒有 EXIF 位置就沒有 camera；手機定位與姿態不拿來用', () => {
    expect(toCamera({ lat: 25, lng: 121, accuracy: 5, alpha: 300, beta: 90, gamma: 0, absolute: true, compass: 310, ...{ ...exif, exifLat: undefined } })).toBeUndefined()
    expect(toCamera(undefined)).toBeUndefined()
    expect(toCamera({ ...exif, lat: 1, lng: 2, accuracy: 5, compass: 10 })).toEqual(toCamera(exif))
  })

  it('磁北的朝向、沒有標基準的朝向不輸出；焦距 0（不明）不輸出', () => {
    expect(toCamera({ ...exif, exifHeadingRef: 'M' })).not.toHaveProperty('heading')
    expect(toCamera({ ...exif, exifHeadingRef: undefined })).not.toHaveProperty('heading')
    expect(toCamera({ ...exif, focal35: 0 })).not.toHaveProperty('focal')
  })
})
