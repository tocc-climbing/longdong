import { rotate, type Pt } from './heroFit'
import { terrainView } from './terrain'

export type TerrainBox = [number, number, number, number]

export const normalizeBearing = (angle: number) => ((angle+180)%360+360)%360-180

/** 指定高程平面的反投影，與 terrainView 的先旋轉、再傾斜順序相反。 */
export function terrainGround(screen: Pt, height: number, bearing: number, pitch: number): Pt {
  const tilt = pitch*Math.PI/180
  return rotate([screen[0], (screen[1]+height*Math.sin(tilt))/Math.cos(tilt)], -bearing)
}

/** 改變朝向時，保留錨點下方的位置與每像素公尺數。 */
export function reorientTerrainBox(box: TerrainBox, height: number, from: { bearing: number; pitch: number }, to: { bearing: number; pitch: number }, anchor: Pt = [0.5, 0.5]): TerrainBox {
  const ground = terrainGround([box[0]+box[2]*anchor[0], box[1]+box[3]*anchor[1]], height, from.bearing, from.pitch)
  const center = terrainView(ground, height, to.bearing, to.pitch)
  return [center[0]-box[2]*anchor[0], center[1]-box[3]*anchor[1], box[2], box[3]]
}

/** 每一幀計算帶正負號的轉角，跨越 ±180 度時仍連續。 */
export function touchRotation(before: Pt[], after: Pt[]): number {
  const angle = (points: Pt[]) => Math.atan2(points[1][1]-points[0][1], points[1][0]-points[0][0])*180/Math.PI
  return normalizeBearing(angle(after)-angle(before))
}
