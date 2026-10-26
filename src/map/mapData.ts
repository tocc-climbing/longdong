import { useEffect, useMemo, useState } from 'react'
import type { LatLng } from '../geo'
import type { LoadedData } from '../data/dataset'
import { AREA_RESCUE } from '../data/rescue'
import { localName, type Lang } from '../i18n'
import { LINE_TARGETS, useMapShapes, type LineTarget, type MapShapes } from './shapes'

/**
 * 照比例尺的龍洞簡圖（scripts/gen-scale-map.ts 由救援資訊圖產生，放在 public/rescue/，在離線快取裡）。
 * 畫面上用以 ORIGIN 為原點的平面座標（公尺，x 向東、y 向南），龍洞的範圍只有一兩公里，平面近似的誤差可忽略。
 */

type Position = [number, number]
interface Feature {
  properties: { kind?: string; id?: string; no?: number; zh?: string; en?: string; ja?: string; tone?: PlaceTone; line?: LineLayer }
  geometry:
    | { type: 'MultiPolygon'; coordinates: Position[][][] }
    | { type: 'MultiLineString'; coordinates: Position[][] }
    | { type: 'Point'; coordinates: Position }
}

/** 地圖上的標示：停車場、急救器材（編號同 EMS_LOCATIONS）、船艇接駁點、直升機吊掛點、地名 */
/** 圖上文字的顏色種類（與救援資訊圖相同）：地名、道路、步道、海面、紅色的警示 */
export type PlaceTone = 'place' | 'road' | 'trail' | 'sea' | 'warning'

export type Marker =
  | { kind: 'parking'; at: [number, number] }
  | { kind: 'boat'; at: [number, number] }
  | { kind: 'hoist'; at: [number, number] }
  | { kind: 'ems'; no: number; at: [number, number] }
  | { kind: 'place'; zh: string; en: string; ja?: string; tone: PlaceTone; at: [number, number] }
  /** 危險地形（紅色驚嘆號） */
  | { kind: 'hazard'; at: [number, number] }
interface FeatureCollection {
  features: Feature[]
}

export interface ScaleMapData {
  /** kind → SVG path（land、landNorth、building、highway、tunnel、road、trail） */
  layers: Record<string, string>
  markers: Marker[]
  /** 大區域：SVG path、標籤位置（最大一塊的重心）、面積（平方公尺，標籤重疊時先畫大的） */
  areas: AreaShape[]
  /** 分區的範圍（使用者畫的，見 shapes.ts）：分區 ID 可能重複（一個分區多塊） */
  sectors: (AreaShape & { sector: string })[]
  /** 步道、道路的線段（地圖座標，圖層 → 線段）：編輯時的起點；畫面用 layers */
  lineLayers: Record<LineLayer, [number, number][][]>
  /** 道路、步道的名稱：沿著 line 圖層裡離錨點最近的那條線排字（位置不固定，見 ScaleMap） */
  names: LineName[]
}

export interface LineName {
  zh: string
  en: string
  ja?: string
  tone: PlaceTone
  line: LineLayer
  /** 錨點（地圖座標）：用來找是哪一條線 */
  at: [number, number]
}

/** 可以編輯的線段圖層 */
export type LineLayer = (typeof LINE_TARGETS)[LineTarget]

export interface AreaShape {
  id: string
  path: string
  label: [number, number]
  size: number
  rings: [number, number][][]
}

/** 一個區域（地圖座標的多塊多邊形）：SVG path、標籤在最大一塊的重心、總面積 */
function areaShape(id: string, rings: [number, number][][]): AreaShape {
  const pieces = rings.map((r) => centroid(r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]))
  const largest = pieces.reduce((a, b) => (b.size > a.size ? b : a))
  const path = rings.map((r) => 'M' + r.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z').join('')
  return { id, path, label: largest.at, size: pieces.reduce((s, p) => s + p.size, 0), rings }
}

/** 套上使用者編輯的最新版本：大區域、步道取代自動產生的；加上分區的範圍 */
export function withShapes(base: ScaleMapData, shapes: MapShapes): ScaleMapData {
  const toRings = (rings: LatLng[][]) => rings.map((r) => r.map(project))
  const edited = (Object.entries(LINE_TARGETS) as [LineTarget, LineLayer][]).filter(([target]) => shapes.lines[target])
  const lineLayers = { ...base.lineLayers, ...Object.fromEntries(edited.map(([target, layer]) => [layer, toRings(shapes.lines[target]!)])) }
  const linePath = (lines: [number, number][][]) => lines.map((l) => 'M' + l.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')).join('')
  return {
    ...base,
    layers: edited.length ? { ...base.layers, ...Object.fromEntries(edited.map(([, layer]) => [layer, linePath(lineLayers[layer])])) } : base.layers,
    areas: base.areas.map((a) => (shapes.areas[a.id] ? areaShape(a.id, toRings(shapes.areas[a.id])) : a)),
    sectors: shapes.sectors.map((s) => ({ ...areaShape(s.id, toRings([s.ring])), sector: s.sector })),
    lineLayers: edited.length ? lineLayers : base.lineLayers,
  }
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

/** 畫面座標（公尺）→ 經緯度（project 的反函數；回報時在地圖上點的位置） */
export function unproject([x, y]: [number, number]): LatLng {
  return [ORIGIN[0] - y / M_PER_DEG_LAT, ORIGIN[1] + x / M_PER_DEG_LNG]
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
  if (p.kind === 'place' && p.zh && p.en) return { kind: 'place', zh: p.zh, en: p.en, ja: p.ja, tone: p.tone ?? 'place', at }
  if (p.kind === 'hazard') return { kind: 'hazard', at }
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

async function readScaleMap(): Promise<ScaleMapData> {
  const [base, areas] = await Promise.all([fetchJSON(`${import.meta.env.BASE_URL}rescue/scale-map.geojson`), fetchJSON(`${import.meta.env.BASE_URL}rescue/areas.geojson`)])
  return {
    layers: Object.fromEntries(
      base.features.flatMap((f) => (f.geometry.type === 'Point' ? [] : [[f.properties.kind!, toPath(f.geometry)]])),
    ),
    markers: base.features.filter((f) => f.geometry.type === 'Point' && f.properties.kind !== 'name').map(toMarker),
    names: base.features.flatMap((f) =>
      f.properties.kind === 'name' && f.geometry.type === 'Point' && f.properties.zh && f.properties.en && f.properties.line
        ? [{ zh: f.properties.zh, en: f.properties.en, ja: f.properties.ja, tone: f.properties.tone ?? 'road', line: f.properties.line, at: project([f.geometry.coordinates[1], f.geometry.coordinates[0]]) }]
        : [],
    ),
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
    sectors: [],
    lineLayers: Object.fromEntries(
      Object.values(LINE_TARGETS).map((layer) => [
        layer,
        base.features.flatMap((f) =>
          f.properties.kind === layer && f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.map((l) => l.map(([lng, lat]) => project([lat, lng]))) : [],
        ),
      ]),
    ) as Record<LineLayer, [number, number][][]>,
  }
}

let cache: Promise<ScaleMapData> | undefined

/** 地圖資料只下載、換算一次，各頁的地圖共用（路線頁每次都會用到）；失敗時不留著，下次打開地圖再重新載入 */
export function loadScaleMap(): Promise<ScaleMapData> {
  cache ??= readScaleMap().catch((err) => {
    cache = undefined
    throw err
  })
  return cache
}

export type ScaleMapState = { status: 'loading' } | { status: 'ok'; data: ScaleMapData } | { status: 'error'; message: string }

/** 地圖資料，套上使用者編輯的最新版本（讀到後即時更新） */
export function useScaleMap(): ScaleMapState {
  const base = useBaseScaleMap()
  const shapes = useMapShapes()
  return useMemo(() => (base.status === 'ok' ? { status: 'ok', data: withShapes(base.data, shapes) } : base), [base, shapes])
}

function useBaseScaleMap(): ScaleMapState {
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
