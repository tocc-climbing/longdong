import type { Camera } from '../../../vendor/climbio-format/format'
import type { Shot } from '../topo/shot'

/**
 * 龍洞的磁偏角（度，東為正）：NOAA WMM-2025 於 2026-11 在 25.11°N、121.92°E 為 -5.13°，每年變化 -0.04°，誤差約 0.3°。
 * 磁北的朝向加上它就是以正北為準。
 */
export const LONGDONG_DECLINATION = -5.1

/**
 * 拍照資料換成 v2 的 photo.camera。只用照片 EXIF 裡的值：手機定位與姿態是回報畫面開著時的值，照片可能是之前拍的，不一定是拍照的位置與方向。
 * 朝向以正北為準：磁北的值（ref M）以龍洞的磁偏角換算；沒有標基準的不輸出。焦距 0 在 EXIF 是不明。沒有 EXIF 位置時沒有 camera（position 必填）。
 */
export function toCamera(shot: Shot | undefined): Camera | undefined {
  if (shot?.exifLat === undefined || shot.exifLng === undefined) return undefined
  const { exifLat: lat, exifLng: lng, exifAlt: alt } = shot
  const heading = trueHeading(shot)
  return {
    position: alt === undefined ? [lng, lat] : [lng, lat, alt],
    ...(heading !== undefined ? { heading } : {}),
    ...(shot.time !== undefined ? { t: shot.time } : {}),
    ...(shot.focal35 ? { focal: shot.focal35 } : {}),
    ...(shot.model ? { model: shot.model } : {}),
  }
}

/** 0 以上、小於 360（EXIF 的 360 就是 0） */
function trueHeading({ exifHeading: h, exifHeadingRef: ref }: Shot): number | undefined {
  if (h === undefined || ref === undefined) return undefined
  const deg = ref === 'T' ? h : h + LONGDONG_DECLINATION
  return ((deg % 360) + 360) % 360
}
