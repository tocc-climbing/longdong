import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { fromOrientation, readExif } from '../src/topo/shot'
import { withExif } from './fixtures/exifJpeg'

const jpeg = () => new Uint8Array(createCanvas(8, 8).toBuffer('image/jpeg'))

describe('readExif', () => {
  it('讀出時間、位置、高度、相機朝向、機型與焦距', async () => {
    const file = new Blob([
      withExif(jpeg(), { make: 'Apple', model: 'iPhone 15', time: '2026:10:31 09:12:30', focal35: 26, lat: 25.1105, lng: 121.9228, alt: 12.5, heading: 247.25, headingRef: 'T' }),
    ])
    const shot = await readExif(file)
    expect(shot).toMatchObject({ make: 'Apple', model: 'iPhone 15', focal35: 26, exifHeading: 247.25, exifHeadingRef: 'T', exifAlt: 12.5 })
    expect(shot.exifLat).toBeCloseTo(25.1105, 5)
    expect(shot.exifLng).toBeCloseTo(121.9228, 5)
    // EXIF 的時間沒有時區，以裝置的時區解讀
    expect(new Date(shot.time!).getMinutes()).toBe(12)
  })

  it('沒有 EXIF 的照片：空的', async () => {
    expect(await readExif(new Blob([jpeg()]))).toEqual({})
  })
})

describe('fromOrientation', () => {
  it('存下姿態與 iOS 指南針', () => {
    expect(fromOrientation({ alpha: 10, beta: 80, gamma: -3, absolute: true, webkitCompassHeading: 250, webkitCompassAccuracy: 15 })).toEqual({
      alpha: 10,
      beta: 80,
      gamma: -3,
      absolute: true,
      compass: 250,
      compassAccuracy: 15,
    })
  })

  it('沒有感測器（全是 null）：空的', () => {
    expect(fromOrientation({ alpha: null, beta: null, gamma: null, absolute: false })).toEqual({})
  })
})
