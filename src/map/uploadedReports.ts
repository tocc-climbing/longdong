import { distanceM, type LatLng } from '../geo'
import type { CalibrationUploads } from '../personal/firebase'
import type { ReportTarget } from './calibration'

/** 一筆地圖回報（尚未編號） */
export interface UploadedReport {
  note: string
  /** 從路線頁回報時，回報的區域與分區（分區已不存在時寫明舊 ID） */
  place?: string
  /** 回報者（暱稱，或「未登入的手機 xxxx」） */
  who: string
  /** GPS 位置 */
  coords: LatLng
  accuracy: number
  time: number
  /** 回報者在地圖上點的位置（選填）與離 GPS 幾公尺 */
  picked?: LatLng
  offset?: number
}

type Feature = { properties: { note: string; accuracy: number; time: string; picked?: [number, number]; target?: ReportTarget }; geometry: { coordinates: [number, number] } }

/** latest：每個人（或沒登入的每台手機）只看最新上傳的那一份（每次上傳都是完整的一份）；all：所有上傳，同一筆回報只算一次 */
export type UploadScope = 'latest' | 'all'

export function reportsOf(all: CalibrationUploads, who: (id: string) => string, place: (target: ReportTarget) => string, scope: UploadScope): UploadedReport[] {
  return Object.entries(all).flatMap(([id, uploads]) => {
    const list = Object.values(uploads)
    const chosen = scope === 'all' ? list : [list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))]
    const seen = new Set<string>()
    return chosen
      .flatMap((upload) => (JSON.parse(upload.geojson) as { features: Feature[] }).features)
      .filter((f) => {
        const key = JSON.stringify([f.properties.time, f.geometry.coordinates, f.properties.note])
        return !seen.has(key) && seen.add(key)
      })
      .map((f) => {
        const coords: LatLng = [f.geometry.coordinates[1], f.geometry.coordinates[0]]
        const picked: LatLng | undefined = f.properties.picked && [f.properties.picked[1], f.properties.picked[0]]
        return {
          note: f.properties.note,
          place: f.properties.target && place(f.properties.target),
          who: who(id),
          coords,
          accuracy: f.properties.accuracy,
          time: Date.parse(f.properties.time),
          picked,
          offset: picked && Math.round(distanceM(coords, picked)),
        }
      })
  })
}
