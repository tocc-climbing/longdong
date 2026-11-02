import { readFileSync } from 'node:fs'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { Mark, MapView, Node, Position, Text } from '../../vendor/climbio-format/format'
import { RESCUE_POINTS } from '../../src/data/rescue'
import type { Dataset, LocalizedName } from '../../src/data/schema'
import { BOUNDS } from '../../src/map/bounds'
import { EXTENT_LATLNG } from '../../src/map/extent'
import { unproject } from '../../src/map/mapData'
import { AREA_COLORS } from '../../src/map/mapkitView'
import { LINE_TARGETS, type LineTarget, type MapShapes } from '../../src/map/shapes'
import { fileId, globalId } from './climbio'

/**
 * 龍洞的比例尺地圖（public/rescue/ 的 scale-map、areas、walls，原始版）換成一個 v2 地圖畫面，給 mapkit 用（地圖的截圖基準、demo）。
 * 詞彙見 vendor/climbio-format/VOCABULARY.md 的「地圖」：
 * - 底圖：沒有節點的標註，props.kind 是 land、building、highway、tunnel、road、trail、parking；
 *   救援資訊圖的陸地與建物只畫在它的頁框裡、頁框外用 OpenStreetMap 的，這裡先裁切合併成一塊（evenodd 的洞換成內圈）
 * - 區域（type area）、分區（type sector，岩壁線）、救援點等地點（type poi，props.kind），顏色在標註的 props.style
 * - props.bounds：移動範圍、props.extent：底圖資料的範圍、props.home：一開始的畫面（都是 [西, 南, 東, 北]）
 * 岩場站出口（osm: false）只輸出龍洞自己產生的：不含頁框外 OpenStreetMap 的陸地、建物、線，也不含停車場範圍（外框取自 OpenStreetMap）；
 * 要不要疊 OpenStreetMap 由用的人決定。
 */

type Pos = [number, number]
interface Feature {
  properties: Record<string, string | number | undefined>
  geometry: { type: 'Point'; coordinates: Pos } | { type: 'Polygon'; coordinates: Pos[][] } | { type: 'MultiPolygon'; coordinates: Pos[][][] } | { type: 'MultiLineString'; coordinates: Pos[][] }
}
const read = (name: string) => (JSON.parse(readFileSync(new URL(`../../public/rescue/${name}.geojson`, import.meta.url), 'utf8')) as { features: Feature[] }).features

const text = (n: LocalizedName | { zh: string; en?: string; ja?: string }): Text => ({ 'zh-Hant': n.zh, ...(n.en ? { en: n.en } : {}), ...('ja' in n && n.ja ? { ja: n.ja } : {}) })
const round = (p: Pos): Position => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]

/** evenodd 填色的多塊多邊形：每一圈互相 xor 就是畫出來的範圍 */
const evenOdd = (polys: Pos[][][]): MultiPolygon => polys.flatMap((poly) => poly).reduce<MultiPolygon>((acc, ring) => polygonClipping.xor(acc, [[ring]]), [])

/** 移動範圍（src/map/bounds.ts 的 BOUNDS：救援點與西邊的路口外加邊界）換成經緯度 */
function boundsOf(): [number, number, number, number] {
  const [south, west] = unproject([BOUNDS.x, BOUNDS.y + BOUNDS.h])
  const [north, east] = unproject([BOUNDS.x + BOUNDS.w, BOUNDS.y])
  return [west, south, east, north].map((v) => Math.round(v * 1e6) / 1e6) as [number, number, number, number]
}

const NO_EDITS: MapShapes = { areas: {}, walls: {}, lines: {}, versions: {} }
const lngLat = (lines: [number, number][][]): Pos[][] => lines.map((l) => l.map(([lat, lng]): Pos => [lng, lat]))
const closed = (r: Pos[]): Pos[] => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]])

/** shapes：地圖編輯的最新版本（取代原始版，同 App 的 withShapes）；osm：含不含 OpenStreetMap 的部分 */
export function longdongMap(dataset: Dataset, shapes: MapShapes = NO_EDITS, osm = true): MapView {
  const base = read('scale-map')
  const kind = (k: string) => base.find((f) => f.properties.kind === k)!.geometry
  const polys = (k: string): Pos[][][] => {
    const g = kind(k)
    return g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
  }
  const original = (k: string): Pos[][] => base.filter((f) => f.properties.kind === k).flatMap((f) => (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []))
  /** 頁框裡的線：有編輯就用最新版本 */
  const lines = (k: string) => {
    const edited = shapes.lines[(Object.keys(LINE_TARGETS) as LineTarget[]).find((t) => LINE_TARGETS[t] === k)!]
    return edited ? lngLat(edited) : original(k)
  }
  const page: MultiPolygon = [polys('page')[0]]
  const inPage = (k: string) => polygonClipping.intersection(evenOdd(polys(k)), page)
  const clipped = (inner: string, outer: string) => (osm ? polygonClipping.union(inPage(inner), polygonClipping.difference(evenOdd(polys(outer)), page)) : inPage(inner))

  const area = (m: Pos[][][]) => ({ type: 'MultiPolygon' as const, coordinates: m.map((p) => p.map((r) => r.map(round))) })
  const multiLine = (ls: Pos[][]) => ({ type: 'MultiLineString' as const, coordinates: ls.map((l) => l.map(round)) })
  // 救援資訊圖的線與頁框外 OpenStreetMap 的線分開（編輯、排道路名稱只用前者，同 App）
  const osmLine = (outer: string, kind: string): Mark[] => (osm ? [{ geometry: multiLine(original(outer)), props: { kind, source: 'osm' } }] : [])
  const marks: Mark[] = [
    { geometry: area(clipped('land', 'outerLand')), props: { kind: 'land' } },
    { geometry: area(clipped('building', 'outerBuilding')), props: { kind: 'building' } },
    ...(osm ? [{ geometry: area(polys('parking')), props: { kind: 'parking' } }] : []),
    { geometry: multiLine(lines('highway')), props: { kind: 'highway' } },
    ...osmLine('outerHighway', 'highway'),
    { geometry: multiLine(lines('tunnel')), props: { kind: 'tunnel' } },
    { geometry: multiLine(lines('road')), props: { kind: 'road' } },
    ...osmLine('outerRoad', 'road'),
    { geometry: multiLine(lines('trail')), props: { kind: 'trail' } },
    ...osmLine('outerTrail', 'trail'),
  ]
  const nodes: Node[] = []

  // 大區域：多邊形（編輯過的每一圈是一塊）；分區：岩壁線，顏色同區域的外框
  const crag = globalId(dataset.crag.id)
  for (const f of read('areas')) {
    const key = String(f.properties.id)
    const a = dataset.areas.find((x) => x.id === `${dataset.crag.id}/${key}`)!
    const edited = shapes.areas[key]
    nodes.push({ id: globalId(a.id), type: 'area', parent: crag, name: text(a.name), props: { code: a.id } })
    marks.push({ node: globalId(a.id), geometry: area(edited ? lngLat(edited).map((r) => [closed(r)]) : (f.geometry as { coordinates: Pos[][][] }).coordinates), props: { style: AREA_COLORS[key] } })
  }
  const walls = new Map(read('walls').map((f) => [String(f.properties.sector), (f.geometry as { coordinates: Pos[][] }).coordinates]))
  for (const [id, edited] of Object.entries(shapes.walls)) walls.set(id, lngLat(edited))
  for (const [id, ls] of walls) {
    const shown = ls.filter((l) => l.length >= 2)
    if (!shown.length) continue
    const a = dataset.areas.find((x) => x.sectors.some((s) => s.id === id))!
    const s = a.sectors.find((x) => x.id === id)!
    nodes.push({ id: globalId(id), type: 'sector', parent: globalId(a.id), name: text(s.name), props: { code: id } })
    marks.push({ node: globalId(id), geometry: multiLine(shown), props: { style: { stroke: AREA_COLORS[a.id.split('/')[1]].stroke } } })
  }

  // 地點：救援點（編號）、停車場、急救器材（編號）、船艇接駁點、直升機吊掛點、危險地形、地名，道路與步道的名稱
  let n = 0
  const poi = (props: Record<string, unknown>, at: Pos, name?: Text) => {
    const id = `poi-${++n}`
    nodes.push({ id, type: 'poi', ...(name ? { name } : {}), props })
    marks.push({ node: id, geometry: { type: 'Point', coordinates: round(at) } })
  }
  for (const p of RESCUE_POINTS) if (p.coords) poi({ kind: 'rescue', label: String(p.no) }, [p.coords[1], p.coords[0]], text(p.name))
  for (const f of base) {
    if (f.geometry.type !== 'Point') continue
    const p = f.properties
    const at = f.geometry.coordinates
    if (p.kind === 'parking') poi({ kind: 'parking' }, at)
    else if (p.kind === 'ems') poi({ kind: 'first-aid', label: String(p.no) }, at)
    else if (p.kind === 'boat') poi({ kind: 'boat' }, at)
    else if (p.kind === 'hoist') poi({ kind: 'helicopter' }, at)
    else if (p.kind === 'hazard') poi({ kind: 'hazard' }, at)
    else if (p.kind === 'place') poi({ kind: 'place', tone: p.tone ?? 'place' }, at, text(p as { zh: string; en: string; ja?: string }))
    else if (p.kind === 'name') poi({ kind: 'line-name', tone: p.tone ?? 'road', line: p.line }, at, text(p as { zh: string; en: string; ja?: string }))
    else throw new Error(`不認得的地點：${JSON.stringify(p)}`)
  }

  const areaPts = read('areas').flatMap((f) => (f.geometry as { coordinates: Pos[][][] }).coordinates.flat(2))
  const bbox = (pts: Pos[]): [number, number, number, number] => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
  return {
    climbio: 2,
    kind: 'view',
    surface: 'map',
    id: fileId(dataset.crag.id, osm ? 'basemap' : 'map'),
    name: text(dataset.crag.name),
    t: Math.max(Date.parse(dataset.updatedAt), ...Object.values(shapes.versions).flatMap((vs) => vs.map((v) => v.createdAt))),
    ...(osm
      ? { license: 'ODbL-1.0', attribution: '臺灣戶外攀岩協會（TOCC）救援資訊圖；國土測繪中心；© OpenStreetMap contributors' }
      : { license: 'CC-BY-SA-4.0', attribution: '臺灣戶外攀岩協會（TOCC）龍洞岩場救援資訊圖' }),
    origin: 'self',
    props: {
      bounds: boundsOf(),
      extent: [EXTENT_LATLNG.west, EXTENT_LATLNG.south, EXTENT_LATLNG.east, EXTENT_LATLNG.north],
      home: bbox(areaPts),
    },
    nodes,
    marks,
  }
}
