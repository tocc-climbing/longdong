import type { LatLng } from '../geo'

/** 折線的文字格式（岩壁、地圖編輯共用）：「緯度,經度」以空格分隔，小數 6 位（約 0.1 公尺） */
export function encodeLine(points: LatLng[]): string {
  return points.map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(' ')
}

export function decodeLine(line: string): LatLng[] {
  return line.split(' ').map((p) => p.split(',').map(Number) as LatLng)
}
