import { distanceM, type LatLng } from './geo'
import { withCloud } from './personal/sync'

/**
 * 比例尺地圖的現場校正記錄：在明確的地點（救援點、區域邊界、岩壁轉角、步道岔路）記下 GPS 與說明，
 * 走步道時可記錄軌跡。記錄存在這支手機上，登入後上傳到資料庫（v2/calibration/<uid>，只有本人與管理員讀得到），
 * 再把校正點加進 scripts/gen-scale-map.ts 的控制點。
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
  track: Fix[]
  /** 最後一次上傳的時間，與當時的點數（之後有新增記錄時提醒還沒上傳） */
  uploaded?: { time: number; marks: number; track: number }
  /** 沒有網路時按了上傳：連上網路後自動上傳 */
  queued?: boolean
}

/** 有記錄還沒上傳（從沒上傳過，或上傳後點數有變） */
export function hasUnuploaded({ marks, track, uploaded }: Calibration): boolean {
  if (marks.length === 0 && track.length === 0) return false
  return !uploaded || uploaded.marks !== marks.length || uploaded.track !== track.length
}

/** 上傳目前的全部記錄（每次上傳都是完整的一份，新的一份取代舊的） */
export async function uploadCalibration(data: Calibration): Promise<Calibration['uploaded']> {
  const { m, uid } = await withCloud()
  await m.uploadCalibration(uid, JSON.stringify(toGeoJSON(data)))
  return { time: Date.now(), marks: data.marks.length, track: data.track.length }
}

/** 軌跡只收誤差在這以內的點：岩壁下的 GPS 常飄幾十公尺，畫進軌跡只會誤導 */
export const TRACK_MAX_ACCURACY_M = 25
/** 和上一個軌跡點相距不到這個距離就不收（站著不動時不累積） */
export const TRACK_MIN_STEP_M = 5

/** 軌跡加入新的定位；不符合條件時回傳原本的陣列 */
export function appendTrack(track: Fix[], fix: Fix): Fix[] {
  if (fix.accuracy > TRACK_MAX_ACCURACY_M) return track
  const last = track[track.length - 1]
  if (last && distanceM(last.coords, fix.coords) < TRACK_MIN_STEP_M) return track
  return [...track, fix]
}

const STORAGE_KEY = 'longdong.calibration'
const EMPTY: Calibration = { marks: [], track: [] }

export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Calibration) : EMPTY
  } catch {
    return EMPTY
  }
}

/** 存在這支手機上；存不了（私密瀏覽、空間不足）時丟出錯誤，由畫面提醒先匯出 */
export function saveCalibration(data: Calibration): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

const lngLat = ([lat, lng]: LatLng) => [lng, lat]
const iso = (time: number) => new Date(time).toISOString()

/** 匯出成 GeoJSON（座標順序為 [經度, 緯度]）：每個記錄點一個 Point，軌跡一條 LineString */
export function toGeoJSON({ marks, track }: Calibration): object {
  return {
    type: 'FeatureCollection',
    features: [
      ...marks.map((m) => ({
        type: 'Feature',
        properties: { note: m.note, accuracy: Math.round(m.accuracy), time: iso(m.time) },
        geometry: { type: 'Point', coordinates: lngLat(m.coords) },
      })),
      ...(track.length >= 2
        ? [
            {
              type: 'Feature',
              properties: { kind: 'track', accuracy: track.map((f) => Math.round(f.accuracy)), time: track.map((f) => iso(f.time)) },
              geometry: { type: 'LineString', coordinates: track.map((f) => lngLat(f.coords)) },
            },
          ]
        : []),
    ],
  }
}
