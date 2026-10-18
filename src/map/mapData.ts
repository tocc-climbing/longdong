import { useEffect, useState } from 'react'
import type { LatLng } from '../geo'
import type { LoadedData } from '../data/dataset'
import { AREA_RESCUE } from '../data/rescue'
import { localName, type Lang } from '../i18n'

/**
 * 照比例尺的龍洞簡圖（scripts/gen-scale-map.ts 由救援資訊圖產生，放在 public/rescue/，在離線快取裡）。
 * 畫面上用以 ORIGIN 為原點的平面座標（公尺，x 向東、y 向南），龍洞的範圍只有一兩公里，平面近似的誤差可忽略。
 */

type Position = [number, number]
interface Feature {
  properties: { kind?: string; id?: string; no?: number; zh?: string; en?: string }
  geometry:
    | { type: 'MultiPolygon'; coordinates: Position[][][] }
    | { type: 'MultiLineString'; coordinates: Position[][] }
    | { type: 'Point'; coordinates: Position }
}

/** 地圖上的標示：停車場、急救器材（編號同 EMS_LOCATIONS）、船艇接駁點、直升機吊掛點、地名 */
export type Marker =
  | { kind: 'parking'; at: [number, number] }
  | { kind: 'boat'; at: [number, number] }
  | { kind: 'hoist'; at: [number, number] }
  | { kind: 'ems'; no: number; at: [number, number] }
  | { kind: 'place'; zh: string; en: string; at: [number, number] }
interface FeatureCollection {
  features: Feature[]
}

export interface ScaleMapData {
  /** kind → SVG path（land、building、highway、tunnel、road、trail） */
  layers: Record<string, string>
  markers: Marker[]
  /** 大區域：SVG path、標籤位置（最大一塊的重心）、面積（平方公尺，標籤重疊時先畫大的） */
  areas: { id: string; path: string; label: [number, number]; size: number; rings: [number, number][][] }[]
}

const ORIGIN: LatLng = [25.107, 121.92]
const M_PER_DEG_LAT = 6_371_000 * (Math.PI / 180)
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN[0] * Math.PI) / 180)

/** 9 個大區域在地圖上的名稱（大區域 key → 名稱，依語言） */
export function areaNames(data: LoadedData, lang: Lang): Record<string, string> {
  return Object.fromEntries(
    Object.keys(AREA_RESCUE).map((key) => {
      const name = data.areaById.get(`${data.dataset.crag.id}/${key}`)?.name
      return [key, name ? localName(name, lang).main : key]
    }),
  )
}

/** 經緯度 → 畫面座標（公尺） */
export function project([lat, lng]: LatLng): [number, number] {
  return [(lng - ORIGIN[1]) * M_PER_DEG_LNG, (ORIGIN[0] - lat) * M_PER_DEG_LAT]
}

const point = ([lng, lat]: Position) => project([lat, lng]).map((v) => v.toFixed(1)).join(' ')
const linePath = (line: Position[]) => 'M' + line.map(point).join('L')
const polygonPath = (polygons: Position[][][]) => polygons.flatMap((rings) => rings.map((r) => linePath(r) + 'Z')).join('')

function toPath(geometry: Exclude<Feature['geometry'], { type: 'Point' }>): string {
  return geometry.type === 'MultiPolygon' ? polygonPath(geometry.coordinates) : geometry.coordinates.map(linePath).join('')
}

function toMarker({ properties: p, geometry }: Feature): Marker {
  if (geometry.type !== 'Point') throw new Error('標示必須是 Point')
  const at = project([geometry.coordinates[1], geometry.coordinates[0]])
  if (p.kind === 'parking') return { kind: 'parking', at }
  if (p.kind === 'boat') return { kind: 'boat', at }
  if (p.kind === 'hoist') return { kind: 'hoist', at }
  if (p.kind === 'ems' && p.no) return { kind: 'ems', no: p.no, at }
  if (p.kind === 'place' && p.zh && p.en) return { kind: 'place', zh: p.zh, en: p.en, at }
  throw new Error(`不認得的標示：${JSON.stringify(p)}`)
}

/** 多邊形的重心與面積（鞋帶公式） */
export function centroid(ring: [number, number][]): { at: [number, number]; size: number } {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    a += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  return { at: [cx / (3 * a), cy / (3 * a)], size: Math.abs(a / 2) }
}

async function fetchJSON(url: string): Promise<FeatureCollection> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}：${res.status}`)
  return (await res.json()) as FeatureCollection
}

export async function loadScaleMap(): Promise<ScaleMapData> {
  const [base, areas] = await Promise.all([fetchJSON(`${import.meta.env.BASE_URL}rescue/scale-map.geojson`), fetchJSON(`${import.meta.env.BASE_URL}rescue/areas.geojson`)])
  return {
    layers: Object.fromEntries(
      base.features.flatMap((f) => (f.geometry.type === 'Point' ? [] : [[f.properties.kind!, toPath(f.geometry)]])),
    ),
    markers: base.features.filter((f) => f.geometry.type === 'Point').map(toMarker),
    areas: areas.features.map((f) => {
      const rings = (f.geometry.coordinates as Position[][][]).map((polygon) => polygon[0].map(([lng, lat]) => project([lat, lng])))
      const pieces = rings.map(centroid)
      const largest = pieces.reduce((a, b) => (b.size > a.size ? b : a))
      return {
        id: f.properties.id!,
        path: toPath(f.geometry as Exclude<Feature['geometry'], { type: 'Point' }>),
        label: largest.at,
        size: pieces.reduce((s, p) => s + p.size, 0),
        rings,
      }
    }),
  }
}

export type ScaleMapState = { status: 'loading' } | { status: 'ok'; data: ScaleMapData } | { status: 'error'; message: string }

export function useScaleMap(): ScaleMapState {
  const [state, setState] = useState<ScaleMapState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    loadScaleMap().then(
      (data) => alive && setState({ status: 'ok', data }),
      (err: unknown) => alive && setState({ status: 'error', message: String(err) }),
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}
