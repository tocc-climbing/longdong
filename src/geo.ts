import { EMS_LOCATIONS, RESCUE_POINTS, type EmsLocation, type RescuePoint } from './data/rescue'

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

export interface Nearby<T> {
  point: T & { coords: LatLng }
  distance: number
  direction: Direction
}

/**
 * 離最近的救援點超過這個距離，就不在龍洞岩場附近：救援點涵蓋的範圍南北約 1.3 公里，
 * 在步道、停車場、龍洞村都在 1 公里內。
 */
export const NEAR_CRAG_M = 1000

/** 最近的幾個點（只算有座標的），由近到遠 */
export function nearestPoints<T extends { coords?: LatLng }>(here: LatLng, points: T[], count: number): Nearby<T>[] {
  return points
    .filter((p): p is T & { coords: LatLng } => !!p.coords)
    .map((point) => ({ point, distance: distanceM(here, point.coords), direction: direction(bearingDeg(here, point.coords)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
}

/** 救援頁依位置決定顯示什麼：在岩場附近時是最近的救援點（通報的地點）與最近的急救器材，否則是離岩場多遠 */
export type Whereabouts =
  | { kind: 'crag'; point: Nearby<RescuePoint>; ems: Nearby<EmsLocation> }
  | { kind: 'outside'; distance: number }

export function whereabouts(here: LatLng): Whereabouts {
  const [point] = nearestPoints(here, RESCUE_POINTS, 1)
  if (point.distance > NEAR_CRAG_M) return { kind: 'outside', distance: point.distance }
  return { kind: 'crag', point, ems: nearestPoints(here, EMS_LOCATIONS, 1)[0] }
}
