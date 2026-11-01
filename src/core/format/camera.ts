import type { Camera } from '../../../vendor/climbio-format/format'
import type { Shot } from '../topo/shot'

/**
 * 拍照資料換成 v2 的 photo.camera。只用照片 EXIF 裡的值：手機定位與姿態是回報畫面開著時的值，照片可能是之前拍的，不一定是拍照的位置與方向。
 * 朝向只收以正北為準的（ref T）；磁北的值不換算，不輸出。焦距 0 在 EXIF 是不明。沒有 EXIF 位置時沒有 camera（position 必填）。
 */
export function toCamera(shot: Shot | undefined): Camera | undefined {
  if (shot?.exifLat === undefined || shot.exifLng === undefined) return undefined
  const { exifLat: lat, exifLng: lng, exifAlt: alt } = shot
  return {
    position: alt === undefined ? [lng, lat] : [lng, lat, alt],
    ...(shot.exifHeading !== undefined && shot.exifHeadingRef === 'T' ? { heading: shot.exifHeading } : {}),
    ...(shot.time !== undefined ? { t: shot.time } : {}),
    ...(shot.focal35 ? { focal: shot.focal35 } : {}),
    ...(shot.model ? { model: shot.model } : {}),
  }
}
