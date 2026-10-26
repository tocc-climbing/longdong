import type { LatLng } from '../geo'
import type { ReportTarget } from './calibration'
import { project } from './mapData'
import { insideRing } from './reportOptions'

/**
 * 修改地圖時當參考的回報：別人在地圖上回報的位置與說明（v2/calibration，所有登入者讀得到）。
 * 只留位置、說明、回報的是哪裡；不留是誰、什麼時候回報的（上傳的 GeoJSON 裡有時間，資料夾名稱是帳號，這裡都丟掉）。
 * 每次上傳是那支手機當時全部的記錄，同一個回報會出現在好幾次上傳裡，依「帳號、時間、位置」去掉重複。
 */
export interface ReportPin {
  id: string
  /** 現場回報是 GPS 的位置，手動回報是在地圖上點的位置 */
  at: LatLng
  /** 回報者在地圖上點出的、自己認為所在的位置 */
  picked?: LatLng
  manual: boolean
  /** GPS 的誤差半徑（公尺） */
  accuracy?: number
  note: string
  target?: ReportTarget
}

type Uploads = Record<string, Record<string, { geojson: string }>>
interface Feature {
  properties?: { note?: string; manual?: boolean; accuracy?: number; picked?: number[]; time?: string; target?: ReportTarget }
  geometry?: { type?: string; coordinates?: number[] }
}

const latLng = (c: number[] | undefined): LatLng | undefined => (c && c.length >= 2 && c.every(Number.isFinite) ? [c[1], c[0]] : undefined)

export function parseReportPins(uploads: Uploads): ReportPin[] {
  const seen = new Set<string>()
  const pins: { time: string; pin: ReportPin }[] = []
  for (const [uid, list] of Object.entries(uploads)) {
    for (const upload of Object.values(list)) {
      let features: Feature[] = []
      try {
        features = (JSON.parse(upload.geojson) as { features?: Feature[] }).features ?? []
      } catch {
        continue
      }
      for (const f of features) {
        const at = f.geometry?.type === 'Point' ? latLng(f.geometry.coordinates) : undefined
        if (!at) continue
        const time = f.properties?.time ?? ''
        const key = `${uid}|${time}|${at.join(',')}`
        if (seen.has(key)) continue
        seen.add(key)
        const p = f.properties ?? {}
        pins.push({
          time,
          pin: { id: '', at, picked: latLng(p.picked), manual: !!p.manual, accuracy: p.accuracy, note: (p.note ?? '').trim(), target: p.target },
        })
      }
    }
  }
  // 順序固定（編號不會每次不同）：依時間，但不把時間留在結果裡
  return pins.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)).map(({ pin }, i) => ({ ...pin, id: String(i) }))
}

/**
 * 一個區域（或分區）相關的回報：
 * 有指定回報的是哪裡（從路線頁回報）的，看它指的區域或分區；沒有指定的，看位置在不在這個區域的範圍裡。
 * sectorId 有值（修改分區的範圍、岩壁）時只留這個分區的，加上沒指定分區、位置在區域裡的。
 * rings 是區域目前的範圍（地圖座標）。
 */
export function pinsForArea(pins: ReportPin[], area: { key: string; sectorId?: string; rings: [number, number][][] }): ReportPin[] {
  const within = (p: ReportPin) => area.rings.some((r) => insideRing(project(p.at), r))
  return pins.filter((p) => {
    if (area.sectorId) return p.target?.sectorId ? p.target.sectorId === area.sectorId : within(p)
    return p.target?.areaId ? p.target.areaId.endsWith(`/${area.key}`) : within(p)
  })
}
