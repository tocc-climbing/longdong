import { describe, expect, it } from 'vitest'
import { validate, type PhotoView } from '../vendor/climbio-format/format'
import { LONGDONG_DECLINATION, toCamera } from '../src/core/format/camera'

const exif = { exifLat: 25.1041, exifLng: 121.9232, exifAlt: 12, exifHeading: 312, exifHeadingRef: 'T' as const, time: 1761620000000, model: 'iPhone 15', focal35: 26 }

describe('拍照資料換成 photo.camera', () => {
  it('位置經度在前，帶高度；朝向、時間、焦距、機型照抄，通過官方驗證', () => {
    const camera = toCamera(exif)
    expect(camera).toEqual({ position: [121.9232, 25.1041, 12], heading: 312, t: 1761620000000, focal: 26, model: 'iPhone 15' })
    const doc: PhotoView = {
      climbio: 2,
      kind: 'view',
      surface: 'photo',
      id: 'v0yvmgjsjo884v1g',
      license: 'CC-BY-SA-4.0',
      attribution: 'KK',
      origin: 'self',
      t: 1,
      href: 'p.webp',
      w: 10,
      h: 10,
      mime: 'image/webp',
      camera,
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

  it('磁北的朝向加上龍洞的磁偏角換成正北，結果在 0 到 360 之間；沒有標基準的朝向不輸出', () => {
    expect(toCamera({ ...exif, exifHeadingRef: 'M' })!.heading).toBeCloseTo(312 + LONGDONG_DECLINATION)
    expect(toCamera({ ...exif, exifHeading: 2, exifHeadingRef: 'M' })!.heading).toBeCloseTo(360 + 2 + LONGDONG_DECLINATION)
    expect(toCamera({ ...exif, exifHeading: 360, exifHeadingRef: 'T' })!.heading).toBe(0)
    expect(toCamera({ ...exif, exifHeadingRef: undefined })).not.toHaveProperty('heading')
  })

  it('焦距 0（不明）不輸出', () => {
    expect(toCamera({ ...exif, focal35: 0 })).not.toHaveProperty('focal')
  })
})
