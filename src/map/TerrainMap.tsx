import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { MapView, Position, Text } from '../../vendor/climbio-format/format'
import { CSS as mapkitCSS, readMap, fitRectView, clampView, type MapViewInfo } from '../../vendor/climbio-mapkit/index.js'
import type { LoadedData } from '../data/dataset'
import type { LatLng } from '../geo'
import { localName, useLang } from '../i18n'
import { loadTerrain } from '../components/TerrainHero'
import type { Pt } from './heroFit'
import { project, unproject, type ScaleMapData } from './mapData'
import { drape, elevation, terrainView, type Terrain } from './terrain'
import { rasterTerrain } from './terrainRaster'
import { coastalIslands, terrainColor } from './terrainRegions'
import { loadKitBase, type KitMapMark } from './KitMap'
import { BOUNDS, EXTENT, inMapBounds } from './bounds'
import { layoutTerrainLabels, type TerrainLabel, type LabelRect } from './terrainMapLabels'
import { TerrainMapMarker } from './TerrainMapMarker'
import { loadTerrainOrtho, terrainOrthoOverview, terrainOrthoPlan, type TerrainOrtho } from './terrainOrtho'

type Box = [number, number, number, number]
type PhotoFrame = { atlas: TerrainOrtho; box: Box; size: { w: number; h: number } }
type PhotoImage = { all: string; box: Box; tiles: number; pixels: string }

/** 新 SVG 影像觸發 load 前保留舊影像，避免解碼或合成時露底。 */
function TerrainPhoto({ image }: { image?: PhotoImage }) {
  const [ready, setReady] = useState<PhotoImage>()
  const layers = ready?.all === image?.all ? [image] : [ready, image]
  return <>{layers.map((layer) => layer && <image key={layer.all} data-surface={layer === image ? 'ortho' : 'ortho-previous'} data-image-ready={ready?.all === layer.all || undefined} data-ortho-tiles={layer.tiles} data-ortho-pixels={layer.pixels} href={layer.all} x={layer.box[0]} y={layer.box[1]} width={layer.box[2]} height={layer.box[3]} onLoad={() => { if (layer === image) setReady(layer) }} />)}</>
}

/** 操作時更新 SVG 視窗與圖示比例，手勢結束才重新取樣地形，不在每一幀編碼 PNG。 */
export function TerrainMap({ map, data, here, marks, selected, onWallTap, onAreaPress, onLocate, topLeft, ortho, savedView }: {
  map: ScaleMapData; data: LoadedData; here?: { coords: LatLng; accuracy?: number }; marks: KitMapMark[]
  selected?: { sector: string; line: number }
  ortho?: boolean
  savedView?: RefObject<MapViewInfo | undefined>
  onWallTap: (sector: string, line: number) => void
  onAreaPress: (area: string) => void
  onLocate?: () => void
  topLeft: ReactNode
}) {
  const { lang, t } = useLang()
  const svg = useRef<SVGSVGElement>(null)
  const [terrain, setTerrain] = useState<Terrain>()
  const [base, setBase] = useState<MapView>()
  const [error, setError] = useState<string>()
  const [photo, setPhoto] = useState<PhotoFrame>()
  const [overview, setOverview] = useState<PhotoFrame>()
  const [photoError, setPhotoError] = useState<string>()
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<Box>()
  const current = useRef<Box>(undefined)
  const committed = useRef<Box>(undefined)
  const camera = useRef<{ bounds: { x: number; y: number; w: number; h: number; maxW?: number }; w: number; h: number }>(undefined)
  const initialView = useRef(savedView?.current)
  const saveView = useRef<() => void>(() => {})
  useEffect(() => () => saveView.current(), [])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pointers = useRef(new Map<number, Pt>())
  const dragged = useRef(false)
  const regions = useMemo(() => map.areas.map((shape) => {
    const area = data.dataset.areas.find((a) => a.id.split('/').at(-1) === shape.id)
    return { ...shape, color: terrainColor(shape.id, area?.color ?? '#8fa3b0'), walls: (area?.sectors ?? []).flatMap((s) => (map.walls[s.id] ?? []).map((line) => line.map(project))) }
  }), [map, data])
  useEffect(() => {
    let alive = true
    Promise.all([loadTerrain('map'), loadKitBase()]).then(([v, b]) => { if (alive) { initialView.current = savedView?.current; setTerrain(v); setBase(b) } }, (e: Error) => { if (alive) setError(e.message) })
    const element = svg.current!
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
      setView(undefined)
    })
    observer.observe(element)
    return () => { alive = false; observer.disconnect(); clearTimeout(timer.current) }
  }, [])
  const geometry = useMemo(() => {
    if (!terrain || !base || !size.w || !size.h) return undefined
    const islands = coastalIslands(terrain, regions)
    const metrics = document.createElement('canvas').getContext('2d')!
    metrics.font = `650 13px ${getComputedStyle(svg.current!).fontFamily}`
    const at = (p: Pt) => { const z = elevation(terrain, p); return z === undefined ? undefined : terrainView(p, z, 0) }
    const flat = readMap(base), fitted = fitRectView(flat.home, flat.bounds, size)
    const [lng, lat] = initialView.current?.center ?? flat.proj.unproject([fitted.cx, fitted.cy])
    const anchor = project([lat, lng]), center = at(anchor)!
    const scale = initialView.current?.metersPerPixel ?? fitted.s
    const boundsCenter = at([BOUNDS.x+BOUNDS.w/2, BOUNDS.y+BOUNDS.h/2])!
    // 傾斜只改變投影，不重新放大填滿畫面；每像素公尺數沿用平面地圖。
    const bounds = { ...BOUNDS, y: boundsCenter[1]-BOUNDS.h/2, maxW: EXTENT.w }
    const ground = ([lng, lat]: Position) => project([lat, lng])
    const nameOf = (name?: Text) => typeof name === 'string' ? name : name?.[lang === 'zh' ? 'zh-Hant' : lang] ?? name?.['zh-Hant'] ?? name?.en ?? ''
    const nodes = new Map((base.nodes ?? []).map((n) => [n.id, n]))
    const iconKinds = new Set(['rescue', 'first-aid', 'parking', 'boat', 'helicopter', 'hazard'])
    const poiLabels: TerrainLabel[] = (base.marks ?? []).flatMap((m) => {
      const node = m.node && nodes.get(m.node)
      if (!node || m.geometry.type !== 'Point') return []
      const kind = String(node.props?.kind), anchor = at(ground(m.geometry.coordinates))
      if (!anchor) return []
      const text = iconKinds.has(kind) ? String(node.props?.label ?? '') : nameOf(node.name)
      const title = kind === 'parking' ? t('map.parking') : kind === 'hazard' ? t('map.hazard') : kind === 'boat' ? t('map.boat') : kind === 'helicopter' ? t('map.hoist') : kind === 'first-aid' ? t('map.ems', { n: text }) : kind === 'rescue' ? `#${text} ${nameOf(node.name)}` : text
      const priority = ['rescue', 'first-aid', 'hazard', 'parking', 'helicopter', 'boat'].indexOf(kind)
      return [{ id: node.id, kind, text, title, at: anchor, width: iconKinds.has(kind) ? kind === 'first-aid' ? 40 : 24 : metrics.measureText(text).width, height: 24, priority: priority >= 0 ? priority : kind === 'line-name' ? 9 : 7, detail: kind === 'line-name' ? 4 : kind === 'boat' || kind === 'helicopter' ? 2.4 : Infinity }]
    })
    const outerLines = (base.marks ?? []).flatMap((m) => m.props?.source === 'osm' && m.geometry.type === 'MultiLineString' ? [{ id: String(m.props.kind), lines: m.geometry.coordinates.map((l) => l.map(ground)) }] : [])
    const polygons = (base.marks ?? []).flatMap((m) => {
      const kind = String(m.props?.kind)
      if (!['building', 'parking'].includes(kind)) return []
      const polygons = m.geometry.type === 'MultiPolygon' ? m.geometry.coordinates : m.geometry.type === 'Polygon' ? [m.geometry.coordinates] : []
      return polygons.map((poly, i) => ({ id: `${kind}-${i}`, kind, d: poly.map((ring) => drape(terrain, [ring.map(ground)], 0, 0, 5)+'Z').join('') }))
    })
    const sectors: TerrainLabel[] = Object.entries(map.walls).flatMap(([sector, lines]) => {
      const found = data.sectorById.get(sector), ps = lines.flat().map(project)
      if (!found || !ps.length) return []
      const anchor = at([ps.reduce((n, p) => n+p[0], 0)/ps.length, ps.reduce((n, p) => n+p[1], 0)/ps.length])
      const text = localName(found.sector.name, lang).main
      return anchor ? [{ id: sector, kind: 'sector', sector, text, title: text, at: anchor, width: metrics.measureText(text).width, height: 20, priority: 8, detail: 0.75 }] : []
    })
    return {
      initial: [center[0]-size.w*scale/2, center[1]-size.h*scale/2, size.w*scale, size.h*scale] as Box,
      anchor,
      bounds,
      range: [EXTENT.x, EXTENT.x+EXTENT.w],
      at,
      polygons,
      islands: islands.map((i) => ({ ...i, d: drape(terrain, [[...i.ring, i.ring[0]]], 0, 0, 4)+'Z' })),
      // SVG 疊層沒有地形深度衝突，應直接貼地，不為了避開 z-fighting 抬高線條。
      walls: Object.entries(map.walls).flatMap(([sector, lines]) => lines.map((line, index) => ({ sector, index, d: drape(terrain, [line.map(project)], 0, 0, 2) }))),
      trails: [...Object.entries(map.lineLayers).map(([id, lines]) => ({ id, lines })), ...outerLines].map(({ id, lines }, i) => ({ id: `${id}-${i}`, kind: id, d: drape(terrain, lines, 0, 0, 5) })),
      poiCount: poiLabels.length,
      labels: [...poiLabels, ...sectors, ...regions.flatMap((r): TerrainLabel[] => {
        const area = data.dataset.areas.find((a) => a.id.split('/').at(-1) === r.id)!
        const points = r.walls.flat().length ? r.walls.flat() : r.rings.flat()
        const center: Pt = [points.reduce((n, p) => n+p[0], 0)/points.length, points.reduce((n, p) => n+p[1], 0)/points.length]
        const anchor = at(center)
        const name = localName(area.name, lang).main
        return anchor ? [{ id: area.id, kind: 'area', area: area.id, text: name, title: name, width: metrics.measureText(name).width, height: 24, at: anchor, priority: 6, detail: Infinity }] : []
      })],
    }
  }, [terrain, base, regions, map, data, lang, size, t])
  const box = view ?? geometry?.initial
  useEffect(() => {
    if (!ortho || !terrain) { setOverview(undefined); return }
    const controller = new AbortController(), box = terrainOrthoOverview(terrain)
    const size = { w: 768, h: 768*box[3]/box[2] }
    loadTerrainOrtho(terrainOrthoPlan(terrain, box, size.w, 1, 4), controller.signal).then((atlas) => {
      if (!controller.signal.aborted) setOverview({ atlas, box, size })
    }, (error: Error) => {
      if (!controller.signal.aborted) { controller.abort(); setPhotoError(error.message) }
    })
    return () => controller.abort()
  }, [ortho, terrain])
  useEffect(() => {
    setPhotoError(undefined)
    if (!ortho || !terrain || !box || !size.w || !overview) { setPhoto(undefined); return }
    const controller = new AbortController()
    const plan = terrainOrthoPlan(terrain, box, size.w, window.devicePixelRatio || 1)
    loadTerrainOrtho(plan, controller.signal).then((atlas) => {
      if (!controller.signal.aborted) setPhoto({ atlas, box, size })
    }, (error: Error) => {
      if (!controller.signal.aborted) { controller.abort(); setPhotoError(error.message) }
    })
    return () => controller.abort()
  }, [ortho, terrain, box, size, overview])
  camera.current = geometry ? { bounds: geometry.bounds, ...size } : undefined
  // 航照非同步載入不能把手勢中的鏡頭退回上次停止的位置。
  if (committed.current !== box) { current.current = box; committed.current = box }
  saveView.current = () => {
    const b = current.current
    if (!savedView || !geometry || !b) return
    const first = geometry.initial
    const [lat, lng] = unproject([geometry.anchor[0]+b[0]+b[2]/2-first[0]-first[2]/2, geometry.anchor[1]+2*(b[1]+b[3]/2-first[1]-first[3]/2)])
    savedView.current = { center: [lng, lat], metersPerPixel: b[2]/size.w, rotation: 0 }
  }
  const raster = useMemo(() => {
    if (ortho || !terrain || !geometry || !box || !size.w) return undefined
    // 北向上的投影不改變 x；只輸出實際顯色帶，省去兩側大面積透明像素的編碼。
    const left = Math.max(box[0], geometry.range[0]), right = Math.min(box[0]+box[2], geometry.range[1])
    const imageBox: Box = right > left ? [left, box[1], right-left, box[3]] : box
    const image = rasterTerrain(terrain, regions, 0, imageBox, size.w*imageBox[2]/box[2], size.h, { maxVertices: 90000, context: true })
    return image && { ...image, box: imageBox }
  }, [ortho, terrain, geometry, regions, box, size])
  const overviewRaster = useMemo(() => {
    if (!ortho || !terrain || !overview) return undefined
    const image = rasterTerrain(terrain, regions, 0, overview.box, overview.size.w, overview.size.h, { maxVertices: 90000, context: true, photo: overview.atlas })
    return image && { ...image, box: overview.box }
  }, [ortho, terrain, regions, overview])
  const photoRaster = useMemo(() => {
    if (!ortho || !terrain || !photo) return undefined
    const image = rasterTerrain(terrain, regions, 0, photo.box, photo.size.w, photo.size.h, { maxVertices: 90000, context: true, photo: photo.atlas })
    return image && { ...image, box: photo.box, tiles: photo.atlas.columns*photo.atlas.rows, pixels: `${photo.atlas.canvas.width}x${photo.atlas.canvas.height}` }
  }, [ortho, terrain, regions, photo])
  const displayView = (next: Box) => {
    const el = svg.current
    if (!el) return
    el.setAttribute('viewBox', next.join(' '))
    const unit = next[2]/el.getBoundingClientRect().width
    // 圖示與文字維持螢幕尺寸；只重排標示與重繪地形需要等手勢結束。
    el.querySelectorAll<SVGGElement>('[data-terrain-screen-scale]').forEach((g) => g.transform.baseVal.getItem(1).setScale(unit, unit))
    el.querySelectorAll<SVGPathElement>('[data-terrain-screen-stroke]').forEach((path) => path.setAttribute('stroke-width', String(Number(path.dataset.terrainScreenStroke)*unit)))
  }
  const update = (next: Box) => {
    const frame = camera.current
    if (frame) {
      const clamped = clampView({ cx: next[0]+next[2]/2, cy: next[1]+next[3]/2, s: next[2]/frame.w, r: 0 }, frame.bounds, frame)
      next = [clamped.cx-frame.w*clamped.s/2, clamped.cy-frame.h*clamped.s/2, frame.w*clamped.s, frame.h*clamped.s]
    }
    current.current = next
    displayView(next)
    clearTimeout(timer.current)
    if (!pointers.current.size) timer.current = setTimeout(() => setView(current.current), 120)
  }
  const zoom = (factor: number, anchor: Pt = [0.5, 0.5]) => {
    const b = current.current
    if (!b) return
    const width = b[2]/factor
    if (width < 45 || width > 5000) return
    const height = b[3]/factor
    update([b[0]+(b[2]-width)*anchor[0], b[1]+(b[3]-height)*anchor[1], width, height])
  }
  const reset = () => {
    clearTimeout(timer.current)
    current.current = geometry?.initial
    setView(undefined)
    if (geometry) displayView(geometry.initial)
  }
  useEffect(() => {
    const el = svg.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoom(Math.exp(-e.deltaY*0.002), [(e.clientX-rect.x)/rect.width, (e.clientY-rect.y)/rect.height])
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])
  const move = (id: number, point: Pt) => {
    const b = current.current, old = pointers.current.get(id)
    if (!b || !old) return
    const before = [...pointers.current.values()]
    pointers.current.set(id, point)
    const after = [...pointers.current.values()]
    const mid = (points: Pt[]): Pt => [points.reduce((n, p) => n+p[0], 0)/points.length, points.reduce((n, p) => n+p[1], 0)/points.length]
    const a = mid(before), c = mid(after)
    if (Math.hypot(point[0]-old[0], point[1]-old[1]) > 1) dragged.current = true
    const rect = svg.current!.getBoundingClientRect()
    update([b[0]-(c[0]-a[0])*b[2]/rect.width, b[1]-(c[1]-a[1])*b[3]/rect.height, b[2], b[3]])
    if (after.length === 2) {
      const distance = (points: Pt[]) => Math.hypot(points[1][0]-points[0][0], points[1][1]-points[0][1])
      if (distance(before) > 0) zoom(distance(after)/distance(before), [(c[0]-rect.x)/rect.width, (c[1]-rect.y)/rect.height])
    }
  }
  const unit = box ? box[2]/size.w : 1
  const point = (at: LatLng) => geometry!.at(project(at))
  const hereAt = geometry && here ? point(here.coords) : undefined
  const reserved: LabelRect[] = [[0, 0, 224, 64]]
  if (geometry && box) {
    for (const p of [hereAt, ...marks.flatMap((m) => [point(m.at), ...(m.picked ? [point(m.picked)] : [])])]) if (p) {
      const x = (p[0]-box[0])/unit, y = (p[1]-box[1])/unit
      reserved.push([x-10, y-10, x+10, y+10])
    }
  }
  if (svg.current) {
    const rect = svg.current.getBoundingClientRect()
    document.querySelectorAll('.map-toasts .map-toast').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && r.height) reserved.push([r.left-rect.left, r.top-rect.top, r.right-rect.left, r.bottom-rect.top]) })
    const controls = svg.current.parentElement?.querySelector('.mk-bottom-right')?.getBoundingClientRect()
    if (controls) reserved.push([controls.left-rect.left-6, controls.top-rect.top-6, controls.right-rect.left+6, controls.bottom-rect.top+6])
  }
  const labels = box && geometry ? layoutTerrainLabels(geometry.labels.map((l) => ({ ...l, detail: l.sector && selected?.sector === l.sector ? Infinity : l.detail, at: [(l.at[0]-box[0])/unit, (l.at[1]-box[1])/unit] })), size.w, size.h, unit, reserved) : []
  const scalePower = 10**Math.floor(Math.log10(90*unit)), scaleRatio = 90*unit/scalePower
  const scaleMeters = (scaleRatio >= 5 ? 5 : scaleRatio >= 2 ? 2 : 1)*scalePower
  return <div className="kit-map terrain-map" data-map-mode="3d" data-meters-per-pixel={unit} data-poi-count={geometry?.poiCount} data-area-count={regions.length} data-label-candidates={geometry?.labels.length}>
    <style>{mapkitCSS}</style>
    <svg ref={svg} className="terrain-map-view" role="group" aria-label={t('map.threeD')} tabIndex={0} viewBox={box?.join(' ')} data-terrain={error ? 'error' : raster || overviewRaster ? 'ready' : 'loading'} data-triangles={raster?.triangles ?? overviewRaster?.triangles}
      onPointerDown={(e) => { if (e.button !== 0) return; if (!pointers.current.size) dragged.current = false; pointers.current.set(e.pointerId, [e.clientX, e.clientY]); e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => move(e.pointerId, [e.clientX, e.clientY])}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId)
        e.currentTarget.releasePointerCapture(e.pointerId)
        if (current.current) update(current.current)
        if (dragged.current) return
        const target = document.elementFromPoint(e.clientX, e.clientY)
        const wall = target?.closest('[data-terrain-wall]')?.getAttribute('data-terrain-wall')
        const area = target?.closest('[data-terrain-area]')?.getAttribute('data-terrain-area')
        const sector = target?.closest('[data-terrain-sector]')?.getAttribute('data-terrain-sector')
        if (wall) { const [sector, line] = wall.split('#'); onWallTap(sector, Number(line)) }
        else if (sector) onWallTap(sector, 0)
        else if (area) onAreaPress(area)
      }}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); if (current.current) update(current.current) }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        const b = current.current
        if (!b) return
        if (e.key === '+' || e.key === '=') zoom(1.4)
        else if (e.key === '-') zoom(1/1.4)
        else if (e.key === 'Home') reset()
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) update([b[0]+(e.key === 'ArrowRight' ? 0.2 : e.key === 'ArrowLeft' ? -0.2 : 0)*b[2], b[1]+(e.key === 'ArrowDown' ? 0.2 : e.key === 'ArrowUp' ? -0.2 : 0)*b[3], b[2], b[3]])
        else return
        e.preventDefault()
      }}>
      {geometry && box && <>
        {raster && <image data-surface="all" href={raster.all} x={raster.box[0]} y={raster.box[1]} width={raster.box[2]} height={raster.box[3]} />}
        {overviewRaster && <image data-surface="ortho-base" data-ortho-tiles={overview!.atlas.columns*overview!.atlas.rows} href={overviewRaster.all} x={overviewRaster.box[0]} y={overviewRaster.box[1]} width={overviewRaster.box[2]} height={overviewRaster.box[3]} />}
        {ortho && <TerrainPhoto image={photoRaster} />}
        {!ortho && geometry.islands.map((i) => <path key={i.id} d={i.d} fill={i.color} />)}
        {geometry.polygons.map((p) => <path key={p.id} data-terrain-polygon={p.kind} d={p.d} fill={p.kind === 'parking' ? '#adb9ab' : '#c7b9a6'} fillOpacity={ortho ? 0 : 1} fillRule="evenodd" stroke="#506058" strokeOpacity={ortho ? 0.3 : 1} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />)}
        {geometry.trails.map((line) => <g key={line.id} data-terrain-line={line.kind}>
          {line.kind !== 'trail' && <path d={line.d} fill="none" stroke="#506058" strokeWidth={line.kind === 'highway' ? 7 : 5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          <path data-terrain-trail={line.id} data-terrain-screen-stroke={line.kind === 'trail' ? 1.8 : line.kind === 'tunnel' ? 3 : undefined} d={line.d} fill="none" stroke={line.kind === 'trail' ? '#e7d1a0' : line.kind === 'highway' ? '#f7d77a' : '#eee4ce'} strokeWidth={line.kind === 'trail' ? 1.8*unit : line.kind === 'tunnel' ? 3*unit : line.kind === 'highway' ? 4.5 : 3} strokeDasharray={line.kind === 'trail' ? '8 8' : line.kind === 'tunnel' ? '8 20' : undefined} vectorEffect={line.kind === 'trail' || line.kind === 'tunnel' ? undefined : 'non-scaling-stroke'} pointerEvents="none" />
        </g>)}
        {geometry.walls.map((w) => <g key={`${w.sector}#${w.index}`}>
          {/* 原始 2D 線只用作點選範圍，不把示意線當成 DTM 上的真實崖形。 */}
          <path data-terrain-wall={`${w.sector}#${w.index}`} d={w.d} stroke="transparent" fill="none" strokeWidth={14} vectorEffect="non-scaling-stroke" />
        </g>)}
        {marks.flatMap((m, i) => {
          const p = point(m.at), picked = m.picked && point(m.picked)
          return p ? [<g key={i} data-terrain-mark>
            {picked && <><line x1={p[0]} y1={p[1]} x2={picked[0]} y2={picked[1]} stroke="#ffc83d" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /><g data-terrain-screen-scale transform={`translate(${picked[0]} ${picked[1]}) scale(${unit})`}><path d="M0,-6l6,6l-6,6l-6,-6Z" fill="#ffc83d" stroke="#fff" strokeWidth={1.5} /></g></>}
            <g data-terrain-screen-scale transform={`translate(${p[0]} ${p[1]}) scale(${unit})`}><circle r={4} fill="#ffc83d" stroke="#fff" strokeWidth={1.5} /></g>
          </g>] : []
        })}
        {hereAt && <g>{here?.accuracy !== undefined && <ellipse cx={hereAt[0]} cy={hereAt[1]} rx={here.accuracy} ry={here.accuracy*0.5} fill="#288cf3" fillOpacity={0.12} stroke="#288cf3" strokeOpacity={0.3} strokeWidth={1} vectorEffect="non-scaling-stroke" />}<g data-terrain-screen-scale transform={`translate(${hereAt[0]} ${hereAt[1]}) scale(${unit})`}><circle data-terrain-location r={6} fill="#288cf3" stroke="#fff" strokeWidth={2} /></g></g>}
        {labels.map((l) => <g key={l.id}>
          <g data-terrain-screen-scale data-terrain-label={l.id} data-label-kind={l.kind} data-label-anchor={l.at.join(',')} data-terrain-area={l.area} data-terrain-sector={l.sector} className="terrain-map-label" role={l.area || l.sector ? 'button' : 'img'} tabIndex={0} aria-label={l.title} transform={`translate(${box[0]+l.x*unit} ${box[1]+l.y*unit}) scale(${unit})`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { if (l.area) { e.preventDefault(); onAreaPress(l.area) } else if (l.sector) { e.preventDefault(); onWallTap(l.sector, 0) } } }}>
            <title>{l.title}</title>
            <rect data-label-box x={l.rect[0]-l.x} y={l.rect[1]-l.y} width={l.rect[2]-l.rect[0]} height={l.rect[3]-l.rect[1]} fill="transparent" />
            {['area', 'sector', 'place', 'line-name'].includes(l.kind) ? <text className="terrain-map-name" textAnchor="middle" dominantBaseline="central" fontSize={l.kind === 'sector' ? 11 : 13} strokeWidth={4}>{l.text}</text> : <TerrainMapMarker kind={l.kind} text={l.text} />}
          </g>
        </g>)}
      </>}
    </svg>
    {(error || (geometry && (ortho ? overview && !overviewRaster : !raster))) && <p role="alert" className="map-status error">{t('map.loadFailed', { error: error ?? 'WebGL2 unavailable' })}</p>}
    {photoError && <p role="alert" className="map-status error">{t('map.loadFailed', { error: photoError })}</p>}
    {ortho && geometry && !photo && !photoError && <p role="status" className="map-status muted">{t('app.loading')}</p>}
    {!geometry && !error && <p role="status" className="map-status muted">{t('app.loading')}</p>}
    <div className="sm-top-left">{topLeft}</div>
    <div className="mk-bottom-right">
      <div className="mk-zoom">
        <button className="mk-control" aria-label={t('rescue.zoomIn')} onClick={() => zoom(1.5)}>＋</button>
        <button className="mk-control" aria-label={t('rescue.zoomOut')} onClick={() => zoom(1/1.5)}>－</button>
      </div>
      {onLocate && <button className="mk-control mk-locate" aria-label={t('map.locate')} onClick={() => { onLocate(); if (hereAt && here && inMapBounds(here.coords) && box) update([hereAt[0]-box[2]/2, hereAt[1]-box[3]/2, box[2], box[3]]) }}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>}
    </div>
    {box && <div className="terrain-map-scale"><span style={{ width: `${scaleMeters/unit}px` }} />{t('myloc.m', { n: scaleMeters })}</div>}
    <div className="terrain-map-credit">© TOCC · NLSC · Taiwan DTM 20m · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></div>
  </div>
}
