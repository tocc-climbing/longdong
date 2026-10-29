import type { LatLng } from '../geo'
import { dbUrl } from '../social/model'
import type { ReportTarget } from './calibration'
import { project } from './mapData'
import { ringDistance } from './reportOptions'

/**
 * 修改地圖時當參考的回報：別人在地圖上回報的位置與說明。
 * 回報上傳時（登入的、沒登入的裝置都一樣），另外存一份去識別的副本到 v2/reportPins/<代碼>：
 * 只有位置、說明、回報的是哪裡，沒有帳號、裝置代號、時間；所有登入者讀得到，只能新增，管理員可以刪除。
 * 代碼是「回報者（帳號或裝置）、時間、位置」的雜湊：同一筆回報不管上傳幾次都是同一個代碼（不會重複），也看不出是誰、什麼時候。
 * 原本的回報（v2/calibration、v2/anonReports）還是只有本人與管理員讀得到。
 */
export interface StoredPin {
  lat: number
  lng: number
  note?: string
  /** GPS 的誤差半徑（公尺）；手動回報沒有 */
  accuracy?: number
  /** 回報者在地圖上點出的、自己認為所在的位置：「緯度,經度」 */
  picked?: string
  manual?: true
  /** 回報的是哪裡（從路線頁回報）：起攀點、休息點、頂端、牆底，與所在的區域、分區、路線 */
  kind?: ReportTarget['kind']
  area?: string
  sector?: string
  route?: string
}

/** 一筆回報（解開之後） */
export interface ReportPin {
  id: string
  /** 現場回報是 GPS 的位置，手動回報是在地圖上點的位置 */
  at: LatLng
  picked?: LatLng
  manual: boolean
  accuracy?: number
  note: string
  target?: ReportTarget
}

interface Feature {
  properties?: { note?: string; manual?: boolean; accuracy?: number; picked?: number[]; time?: string; target?: ReportTarget }
  geometry?: { type?: string; coordinates?: number[] }
}

const fixed = (n: number) => n.toFixed(6)

/** 雜湊成 32 個十六進位字（不能用 crypto.subtle 時用隨機的，只是同一筆可能存兩份） */
async function hash(text: string): Promise<string> {
  try {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
    return [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return crypto.randomUUID().replaceAll('-', '')
  }
}

/**
 * 一次上傳的 GeoJSON → 去識別的副本（代碼 → 內容）。owner 是帳號或裝置代號，只用來算代碼，不會存起來。
 * 壞掉的 JSON、不是點的資料略過。
 */
export async function pinsFromGeoJSON(geojson: string, owner: string, skip = 0): Promise<[string, StoredPin][]> {
  let features: Feature[] = []
  try {
    features = (JSON.parse(geojson) as { features?: Feature[] }).features ?? []
  } catch {
    return []
  }
  const out: [string, StoredPin][] = []
  for (const f of features.slice(skip)) {
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : undefined
    if (!c || c.length < 2 || !c.slice(0, 2).every(Number.isFinite)) continue
    const p = f.properties ?? {}
    const [lng, lat] = c
    const picked = p.picked && p.picked.length >= 2 && p.picked.slice(0, 2).every(Number.isFinite) ? `${fixed(p.picked[1])},${fixed(p.picked[0])}` : undefined
    const note = (p.note ?? '').trim().slice(0, 300)
    const pin: StoredPin = {
      lat: +fixed(lat),
      lng: +fixed(lng),
      ...(note ? { note } : {}),
      ...(typeof p.accuracy === 'number' && p.manual !== true ? { accuracy: Math.max(0, Math.round(p.accuracy)) } : {}),
      ...(picked ? { picked } : {}),
      ...(p.manual ? { manual: true as const } : {}),
      ...(p.target ? { kind: p.target.kind, area: p.target.areaId, sector: p.target.sectorId, ...(p.target.routeId ? { route: p.target.routeId } : {}) } : {}),
    }
    out.push([await hash(`${owner}|${p.time ?? ''}|${fixed(lat)}|${fixed(lng)}`), pin])
  }
  return out
}

/**
 * 把副本寫進資料庫（REST，沒登入也能寫）；已經有的（規則不允許覆蓋，會被拒絕）略過。回傳新增了幾筆。
 */
export async function writePins(entries: [string, StoredPin][]): Promise<number> {
  let added = 0
  for (let i = 0; i < entries.length; i += 10) {
    const results = await Promise.all(
      entries.slice(i, i + 10).map(async ([key, pin]) => {
        const res = await fetch(dbUrl(`v2/reportPins/${key}`), { method: 'PUT', body: JSON.stringify(pin) })
        // 401：已經有了（規則只允許新增）
        if (res.ok) return 1
        if (res.status === 401) return 0
        throw new Error(`HTTP ${res.status}`)
      }),
    )
    added += results.reduce<number>((sum, n) => sum + n, 0)
  }
  return added
}

/** 資料庫裡的副本 → 回報；順序依代碼（固定，編號不會每次不同） */
export function decodePins(stored: Record<string, StoredPin> | null | undefined): ReportPin[] {
  return Object.entries(stored ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([, p], i): ReportPin[] => {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return []
      const picked = p.picked?.split(',').map(Number)
      return [
        {
          id: String(i),
          at: [p.lat, p.lng],
          picked: picked && picked.length === 2 && picked.every(Number.isFinite) ? [picked[0], picked[1]] : undefined,
          manual: !!p.manual,
          accuracy: p.accuracy,
          note: p.note ?? '',
          target: p.kind && p.sector ? { kind: p.kind, areaId: p.area ?? '', sectorId: p.sector, routeId: p.route } : undefined,
        },
      ]
    })
}

/** 沒指定回報的是哪裡的回報，離區域範圍多近（公尺）算這個區域的：GPS 的誤差本來就有十幾公尺，剛好在範圍外的回報正是修改範圍時要參考的 */
export const PIN_NEAR_M = 50

/**
 * 一個區域相關的回報：
 * 有指定回報的是哪裡（從路線頁回報）的，看它指的區域；沒有指定的，看位置在不在這個區域的範圍裡或附近（PIN_NEAR_M）。
 * rings 是區域目前的範圍（地圖座標）。
 */
export function pinsForArea(pins: ReportPin[], area: { key: string; rings: [number, number][][] }): ReportPin[] {
  const within = (p: ReportPin) => area.rings.some((r) => ringDistance(project(p.at), r) <= PIN_NEAR_M)
  return pins.filter((p) => {
    return p.target?.areaId ? p.target.areaId.endsWith(`/${area.key}`) : within(p)
  })
}

/** 同一個點附近的回報合併成一個（公尺）：GPS 的誤差本來就有這麼大 */
export const MERGE_RADIUS_M = 8

/** 合併後的一個點：位置取平均；相同的說明合在一起並算有幾筆 */
export interface PinGroup {
  id: string
  at: LatLng
  picked?: LatLng
  /** 有幾筆回報合併在這裡 */
  count: number
  /** 說明（相同的合在一起，多的在前面）與各有幾筆；沒有寫說明的回報算在 blank */
  notes: { text: string; count: number }[]
  blank: number
  targets: ReportTarget[]
  /** 全部都是手動回報 */
  manual: boolean
  /** 現場回報裡最小的 GPS 誤差（公尺） */
  accuracy?: number
}

const mean = (points: LatLng[]): LatLng => [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]

/**
 * 合併同一個點附近（MERGE_RADIUS_M 以內）的回報：由前面的開始，把離它夠近的歸成一組；位置取平均。
 * 沒有指定回報的是哪裡、或指定的相同時才合併（同一個位置不同路線的起攀點不合）。
 */
export function mergePins(pins: ReportPin[], radiusM = MERGE_RADIUS_M): PinGroup[] {
  const sameTarget = (a?: ReportTarget, b?: ReportTarget) => (a?.routeId ?? a?.sectorId ?? '') === (b?.routeId ?? b?.sectorId ?? '') && (a?.kind ?? '') === (b?.kind ?? '')
  const groups: ReportPin[][] = []
  for (const pin of pins) {
    const [x, y] = project(pin.at)
    const home = groups.find((g) => {
      const [gx, gy] = project(mean(g.map((p) => p.at)))
      return Math.hypot(gx - x, gy - y) <= radiusM && sameTarget(g[0].target, pin.target)
    })
    if (home) home.push(pin)
    else groups.push([pin])
  }
  return groups.map((g, i) => {
    const picked = g.flatMap((p) => (p.picked ? [p.picked] : []))
    const accuracies = g.flatMap((p) => (p.accuracy !== undefined ? [p.accuracy] : []))
    const targets = g.flatMap((p) => (p.target ? [p.target] : [])).filter((t, k, all) => all.findIndex((u) => sameTarget(u, t) && u.sectorId === t.sectorId) === k)
    return {
      id: String(i),
      at: mean(g.map((p) => p.at)),
      picked: picked.length ? mean(picked) : undefined,
      count: g.length,
      notes: [...g.reduce((m, p) => (p.note ? m.set(p.note, (m.get(p.note) ?? 0) + 1) : m), new Map<string, number>())]
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count),
      blank: g.filter((p) => !p.note).length,
      targets,
      manual: g.every((p) => p.manual),
      accuracy: accuracies.length ? Math.min(...accuracies) : undefined,
    }
  })
}
