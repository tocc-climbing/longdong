import type { RescuePoint } from './data/rescue'

/** 經緯度座標 [緯度, 經度]（WGS84，和救援點座標同一套） */
export type LatLng = [number, number]

const EARTH_RADIUS_M = 6_371_000
const rad = (deg: number) => (deg * Math.PI) / 180

/** 兩點的地表距離（公尺），haversine 公式；龍洞範圍內誤差遠小於 GPS 本身的誤差 */
export function distanceM([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/** 從 from 看 to 的方位角（0–360 度，正北為 0、順時針） */
export function bearingDeg([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** 方位角換成八個方位（每個方位涵蓋 45 度，北方為 337.5–22.5 度） */
export function direction(bearing: number): Direction {
  return DIRECTIONS[Math.round(bearing / 45) % 8]
}

export interface NearbyPoint {
  point: RescuePoint & { coords: LatLng }
  distance: number
  direction: Direction
}

/** 最近的幾個救援點（只算有座標的），由近到遠 */
export function nearestPoints(here: LatLng, points: RescuePoint[], count: number): NearbyPoint[] {
  return points
    .filter((p): p is RescuePoint & { coords: LatLng } => !!p.coords)
    .map((point) => ({ point, distance: distanceM(here, point.coords), direction: direction(bearingDeg(here, point.coords)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
}
