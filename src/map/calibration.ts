import { useSyncExternalStore } from 'react'
import type { LatLng } from '../geo'
import { getCloud, subscribeCloud, withCloud } from '../personal/sync'
import { DB_URL } from '../social/model'
import { simulatedLocation } from '../simulate'

/**
 * 比例尺地圖的回報：在明確的地點（救援點、區域邊界、岩壁轉角、步道岔路）記下 GPS 與說明；
 * 不在現場時也可以手動回報：對照航照在地圖上點位置，沒有 GPS。
 * 記錄存在這支手機上，整個 App 共用一份；連上網路時在背景自動上傳，不必停在地圖頁：
 * 登入的上傳到 v2/calibration/<uid>（所有登入者讀得到，修改地圖時當參考，見 reportPins.ts），沒登入的上傳到 v2/anonReports/<裝置代號>
 * （只有管理員讀得到；iPhone 有時無法用 Google 登入，不登入也要能回報）。
 * 再把校正點加進 scripts/gen-scale-map.ts 的控制點。
 * （網頁在背景或螢幕關閉時無法定位，所以不記錄軌跡。）
 */

export interface Fix {
  coords: LatLng
  /** GPS 回報的誤差半徑（公尺） */
  accuracy: number
  time: number
}

/**
 * 回報的是哪裡（從路線頁回報時）：路線的起攀點、休息點、頂端，或整面牆（分區）的牆底。
 * 累積起來可以得到各分區、各路線起攀點在地圖上的位置。
 */
export interface ReportTarget {
  kind: 'start' | 'rest' | 'top' | 'base'
  areaId: string
  sectorId: string
  /** 牆底（base）沒有路線 */
  routeId?: string
}

/** 現場回報：GPS 位置 */
export interface FieldMark extends Fix {
  note: string
  target?: ReportTarget
  /** 回報者在地圖上點出的、自己認為所在的位置（選填）；和 GPS 位置的差距就是地圖或 GPS 的誤差 */
  picked?: LatLng
}

/** 手動回報：不在現場，對照航照在地圖上點的位置（沒有 GPS，不能用來估計誤差） */
export interface ManualMark {
  manual: true
  coords: LatLng
  time: number
  note: string
  target?: ReportTarget
}

export type Mark = FieldMark | ManualMark

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

const lngLat = ([lat, lng]: LatLng) => [lng, lat]
const iso = (time: number) => new Date(time).toISOString()

/**
 * 匯出成 GeoJSON（座標順序為 [經度, 緯度]）：每個回報一個 Point。
 * 現場回報的 Point 是 GPS，在地圖上點的位置放在 properties.picked；手動回報的 Point 是在地圖上點的位置，properties.manual 為 true、沒有 accuracy。
 */
export function toGeoJSON({ marks }: Calibration): object {
  return {
    type: 'FeatureCollection',
    features: marks.map((m) => ({
      type: 'Feature',
      properties: {
        note: m.note,
        ...('manual' in m
          ? { manual: true }
          : { accuracy: Math.round(m.accuracy), ...(m.picked ? { picked: lngLat(m.picked).map((n) => +n.toFixed(6)) } : {}) }),
        time: iso(m.time),
        ...(m.target ? { target: m.target } : {}),
      },
      geometry: { type: 'Point', coordinates: lngLat(m.coords).map((n) => +n.toFixed(6)) },
    })),
  }
}

// ── 手機上的記錄（整個 App 共用一份） ────────────────────────

const STORAGE_KEY = 'longdong.calibration'

function load(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Calibration) : { marks: [] }
  } catch {
    return { marks: [] }
  }
}

let state: Calibration | undefined
/** 模擬位置時的回報：不存在手機上、不上傳 */
let simulated: Mark[] = []
const listeners = new Set<() => void>()
const current = () => (state ??= load())

/** 上傳或存檔的結果，給地圖頁顯示提示 */
export type CalibrationEvent = { kind: 'sent' } | { kind: 'failed'; error: string } | { kind: 'saveError' } | { kind: 'simulated' }
const eventListeners = new Set<(e: CalibrationEvent) => void>()
const emit = (e: CalibrationEvent) => eventListeners.forEach((l) => l(e))

function commit(next: Calibration) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 私密瀏覽、空間不足：這次還在記憶體裡，提醒先登入上傳
    emit({ kind: 'saveError' })
  }
  listeners.forEach((l) => l())
}

/** 模擬位置時的回報（沒有送出，地圖上照樣標出來） */
export function useSimulatedMarks(): Mark[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => simulated,
  )
}

export function useCalibration(): Calibration {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    current,
  )
}

export function onCalibrationEvent(l: (e: CalibrationEvent) => void): () => void {
  eventListeners.add(l)
  return () => eventListeners.delete(l)
}

/** 新增一筆回報，排進上傳 */
export function addMark(mark: Mark): void {
  // 模擬位置時（src/simulate.ts）不存、不上傳：只在這次瀏覽的地圖上標出來
  if (simulatedLocation()) {
    simulated = [...simulated, mark]
    listeners.forEach((l) => l())
    emit({ kind: 'simulated' })
    return
  }
  const c = current()
  commit({ ...c, marks: [...c.marks, mark], queued: true })
  void flush()
}

// ── 背景上傳 ────────────────────────────────────────────────

const DEVICE_KEY = 'longdong.device'

/** 這台手機的隨機代號（沒登入時用來把同一台手機的回報放在一起；不含任何個人資料） */
let device: string | undefined
function deviceId(): string {
  if (device) return device
  try {
    device = localStorage.getItem(DEVICE_KEY) ?? undefined
    if (!device) localStorage.setItem(DEVICE_KEY, (device = crypto.randomUUID()))
  } catch {
    // 私密瀏覽等情況存不了：這次開啟 App 期間用同一個代號
    device ??= crypto.randomUUID()
  }
  return device
}

/** 沒登入：用 REST 上傳（不必載入 Firebase），資料庫規則只允許新增 */
async function uploadAnonymous(geojson: string): Promise<void> {
  const res = await fetch(`${DB_URL}/v2/anonReports/${deviceId()}.json`, {
    method: 'POST',
    body: JSON.stringify({ geojson, createdAt: { '.sv': 'timestamp' } }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

let uploading = false

/**
 * 有排隊的記錄、連上網路時上傳（每次都是完整的一份，新的一份取代舊的）。
 * 已登入用帳號上傳；沒登入用裝置代號上傳；登入狀態還在載入時先等（載入完會再呼叫）。
 */
async function flush(): Promise<void> {
  const cloud = getCloud()
  if (uploading || !current().queued || cloud.status === 'loading') return
  const signedIn = cloud.status === 'signed-in'
  if (signedIn ? !cloud.connected : !navigator.onLine) return
  uploading = true
  const sent = current()
  try {
    const geojson = JSON.stringify(toGeoJSON(sent))
    if (signedIn) {
      const { m, uid } = await withCloud()
      await m.uploadCalibration(uid, geojson)
    } else {
      await uploadAnonymous(geojson)
    }
    const latest = current()
    const uploaded = { time: Date.now(), marks: sent.marks.length }
    // 上傳途中又新增的記錄，留著下一次上傳
    commit({ ...latest, uploaded, queued: hasUnuploaded({ ...latest, uploaded }) })
    emit({ kind: 'sent' })
  } catch (err) {
    // 失敗時不馬上重試（避免一直失敗一直重試），等下一次登入狀態、連線改變或新增回報
    emit({ kind: 'failed', error: (err as Error).message })
    return
  } finally {
    uploading = false
  }
  // 上傳途中又新增的記錄
  if (current().queued) void flush()
}

/** App 啟動時呼叫：登入、連上網路（含 Firebase 重新連線）時檢查有沒有要上傳的回報 */
export function startCalibrationSync(): void {
  subscribeCloud(() => void flush())
  window.addEventListener('online', () => void flush())
  void flush()
}
