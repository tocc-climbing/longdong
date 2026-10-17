import type { LatLng } from './geo'
import { withCloud } from './personal/sync'

/**
 * 比例尺地圖的現場回報：在明確的地點（救援點、區域邊界、岩壁轉角、步道岔路）記下 GPS 與說明。
 * 記錄存在這支手機上，登入後上傳到資料庫（v2/calibration/<uid>，只有本人與管理員讀得到），
 * 再把校正點加進 scripts/gen-scale-map.ts 的控制點。
 * （網頁在背景或螢幕關閉時無法定位，所以不記錄軌跡。）
 */

export interface Fix {
  coords: LatLng
  /** GPS 回報的誤差半徑（公尺） */
  accuracy: number
  time: number
}

export interface Mark extends Fix {
  note: string
}

export interface Calibration {
  marks: Mark[]
  /** 最後一次上傳的時間，與當時的點數（之後有新增記錄時提醒還沒上傳） */
  uploaded?: { time: number; marks: number }
  /** 有記錄等著上傳：登入且連上網路時自動上傳 */
  queued?: boolean
}

/** 有記錄還沒上傳（從沒上傳過，或上傳後點數有變） */
export function hasUnuploaded({ marks, uploaded }: Calibration): boolean {
  if (marks.length === 0) return false
  return !uploaded || uploaded.marks !== marks.length
}

/** 上傳目前的全部記錄（每次上傳都是完整的一份，新的一份取代舊的） */
export async function uploadCalibration(data: Calibration): Promise<Calibration['uploaded']> {
  const { m, uid } = await withCloud()
  await m.uploadCalibration(uid, JSON.stringify(toGeoJSON(data)))
  return { time: Date.now(), marks: data.marks.length }
}

const STORAGE_KEY = 'longdong.calibration'

export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { marks: [] }
    // 舊版還有軌跡（track），只留下回報的點
    const { marks = [], uploaded, queued } = JSON.parse(raw) as Partial<Calibration>
    return { marks, uploaded: uploaded && { time: uploaded.time, marks: uploaded.marks }, queued }
  } catch {
    return { marks: [] }
  }
}

/** 存在這支手機上；存不了（私密瀏覽、空間不足）時丟出錯誤，由畫面提醒 */
export function saveCalibration(data: Calibration): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

const lngLat = ([lat, lng]: LatLng) => [lng, lat]
const iso = (time: number) => new Date(time).toISOString()

/** 匯出成 GeoJSON（座標順序為 [經度, 緯度]）：每個回報一個 Point */
export function toGeoJSON({ marks }: Calibration): object {
  return {
    type: 'FeatureCollection',
    features: marks.map((m) => ({
      type: 'Feature',
      properties: { note: m.note, accuracy: Math.round(m.accuracy), time: iso(m.time) },
      geometry: { type: 'Point', coordinates: lngLat(m.coords) },
    })),
  }
}
