import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LatLng } from '../geo'
import { useLang } from '../i18n'
import { BOUNDS, CRAG_X, inBounds, located } from './bounds'
import { project, unproject, type Marker, type PlaceTone, type ScaleMapData } from './mapData'
import { MIN_SCALE, centerPending, clampScale, clampView, dashLength, fitView, focusView, mapTransform, maxScale, rotateAt, toMap, toScreen, zoomAt, type CenterRequest, type MapView, type Rect, type Size } from './mapView'
import { orthoTiles } from './ortho'
import { insideRing } from './reportOptions'
import { STEP, useMapGestures, type MapGestures, type Point } from './useMapGestures'
import './map.css'

/** 比例尺的長度（公尺）：選畫面上不超過 SCALE_BAR_PX 的最長一個 */
const SCALE_BARS = [10, 20, 50, 100, 200, 500]
/** 比例尺最長幾個像素 */
const SCALE_BAR_PX = 60
/** 回到我的位置時至少放大到每像素幾公尺 */
const ME_SCALE = 0.5
const LABEL_PX = 12

/** 螢幕上的範圍（像素） */
type Box = [number, number, number, number]
type Vec = [number, number]

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/** 文字在畫面上的寬度（像素，估計值）：中日文字約 1 個字高，英數約 0.6 */
function textWidth(text: string, fontPx: number): number {
  return [...text].reduce((w, c) => w + (/[　-鿿＀-￯]/.test(c) ? 1 : 0.6) * fontPx, 0)
}

/** 以 at 為中心、半寬 hw、半高 hh 的範圍；dy 為中心往下移 */
const around = ([x, y]: Vec, hw: number, hh: number, dy = 0): Box => [x - hw, y + dy - hh, x + hw, y + dy + hh]

/** 圖示越前面越重要：重疊時先畫重要的，其他的等放大後空間夠了才出現（停車場一定畫，不在這裡排） */
const PRIORITY = { ems: 0, hoist: 1, boat: 2 }
/** 地名依顏色種類：紅色的警示（安檢所）、道路與步道、一般地名、海面 */
const PLACE_PRIORITY: Record<PlaceTone, number> = { warning: 3, road: 4, trail: 4, place: 5, sea: 6 }
const priority = (m: Marker) => (m.kind === 'place' ? PLACE_PRIORITY[m.tone] : m.kind in PRIORITY ? PRIORITY[m.kind as keyof typeof PRIORITY] : 9)

/** 地名：英文版用英文，日文版用日文（沒有時用中文） */
const placeName = (m: Extract<Marker, { kind: 'place' }>, lang: string) => (lang === 'en' ? m.en : lang === 'ja' ? (m.ja ?? m.zh) : m.zh)

/** 危險地形的圖示（半徑）與右邊的文字 */
const HAZARD_R = 7

/** 急救器材被擋住時，往旁邊挪的候選位置（螢幕像素）：由近到遠、八個方向 */
const EMS_NUDGES: Vec[] = [0, 18, 26, 36].flatMap((d) =>
  d === 0 ? [[0, 0] as Vec] : Array.from({ length: 8 }, (_, k): Vec => [Math.round(d * Math.cos((k * Math.PI) / 4)), Math.round(d * Math.sin((k * Math.PI) / 4))]),
)

function markerBox(m: Marker, at: Vec, lang: string, hazardLabel: string): Box {
  if (m.kind === 'place') return around(at, textWidth(placeName(m, lang), 11) / 2 + 2, 7)
  if (m.kind === 'hazard') {
    const w = HAZARD_R + 4 + textWidth(hazardLabel, 10)
    return [at[0] - HAZARD_R - 1, at[1] - HAZARD_R - 1, at[0] + w + 1, at[1] + HAZARD_R + 1]
  }
  // 直升機圖釘的尖端在實際位置，圖示在上方
  if (m.kind === 'hoist') return around(at, 6.5, 10, -10)
  return around(at, 7.5, 7.5)
}

/**
 * 決定要畫哪些圖示與區域名稱（都在螢幕座標上算，旋轉後也正確）：
 * 救援點、停車場、危險地形一定畫（救援時最重要；停車場是進出岩場的集合點）。停車場 P 的位置在產生地圖時就避開救援點，畫在救援點上面；
 * 急救器材也一定畫：和上面這些重疊時往旁邊空的地方挪（nudged，螢幕座標），畫一條細線連回實際位置；
 * 其他依 priority、區域名稱依面積大小，和已畫的東西重疊就先不畫。
 */
function declutter(
  markers: Marker[],
  areas: ScaleMapData['areas'],
  names: Record<string, string>,
  screen: (p: Vec) => Vec,
  lang: string,
  hazardLabel: string,
) {
  const occupied: Box[] = located.map(({ at }) => around(screen(at), 8, 8))
  const fits = (box: Box) => {
    if (occupied.some((o) => overlaps(box, o))) return false
    occupied.push(box)
    return true
  }
  const always = (m: Marker) => m.kind === 'parking' || m.kind === 'hazard'
  const fixed = markers.flatMap((m, i) => (always(m) ? [i] : []))
  for (const i of fixed) occupied.push(markerBox(markers[i], screen(markers[i].at), lang, hazardLabel))
  const nudged = new Map<number, Vec>()
  const ems = markers.flatMap((m, i) => (m.kind === 'ems' ? [i] : []))
  for (const i of ems) {
    const at = screen(markers[i].at)
    const free = EMS_NUDGES.map(([dx, dy]): Vec => [at[0] + dx, at[1] + dy]).find((p) => !occupied.some((o) => overlaps(around(p, 7.5, 7.5), o)))
    const p = free ?? at
    occupied.push(around(p, 7.5, 7.5))
    if (p[0] !== at[0] || p[1] !== at[1]) nudged.set(i, p)
  }
  const shown = new Set([
    ...fixed,
    ...ems,
    ...markers
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !always(m) && m.kind !== 'ems')
      .sort((a, b) => priority(a.m) - priority(b.m))
      .filter(({ m }) => fits(markerBox(m, screen(m.at), lang, hazardLabel)))
      .map(({ i }) => i),
  ])
  const labels = [...areas]
    .sort((x, y) => y.size - x.size)
    .map((a) => ({ id: a.id, text: names[a.id] ?? a.id, at: screen(a.label) }))
    .filter((l) => fits(around(l.at, textWidth(l.text, LABEL_PX) / 2 + 4, LABEL_PX / 2 + 2)))
  return { shown, labels, nudged }
}

/** 聚焦：地圖移到這些東西（大區域、救援點）並放大到剛好放進框裡；key 改變時重新聚焦 */
export interface MapFocus {
  key: string
  /** 大區域 key：其他區域變淡 */
  area?: string
  /** 救援點（RescuePoint 的 key）：加大標示 */
  points?: string[]
  /** 急救器材編號：加大標示 */
  ems?: number[]
  /** 其他位置（例如一筆回報的 GPS 與在地圖上點的位置） */
  coords?: LatLng[]
}

/**
 * 地圖上的回報：GPS 位置（圓點）；有在地圖上點出自己的位置時，另外畫一個菱形，兩點之間連一條虛線。
 * label 是清單上的編號；selected 加大標示。
 */
export interface MapMark {
  at: LatLng
  picked?: LatLng
  label?: string
  selected?: boolean
}

/** 選中的救援點（#12 有兩個點共用編號，用 key 區分）或急救器材 */
export type MapSelection = { kind: 'rescue'; key: string } | { kind: 'ems'; no: number }

/** 聚焦範圍外留的邊（公尺）；範圍至少這麼大，只聚焦一個救援點時也看得到周圍的區域與步道 */
const FOCUS_PADDING_M = 30
const FOCUS_MIN_M = 200
/** 點救援點：離圓心這個距離（像素）內都算 */
const POINT_HIT_PX = 18

/** 聚焦的範圍（地圖座標）：區域外框與救援點的外接矩形 */
function focusRect(focus: MapFocus, map: ScaleMapData): Rect | undefined {
  const xy = [
    ...(map.areas.find((a) => a.id === focus.area)?.rings.flat() ?? []),
    ...located.filter((p) => focus.points?.includes(p.key)).map((p) => p.at),
    ...map.markers.flatMap((m) => (m.kind === 'ems' && focus.ems?.includes(m.no) ? [m.at] : [])),
    ...(focus.coords ?? []).map(project),
  ]
  if (xy.length === 0) return undefined
  const xs = xy.map((p) => p[0])
  const ys = xy.map((p) => p[1])
  const w = Math.max(FOCUS_MIN_M, Math.max(...xs) - Math.min(...xs) + 2 * FOCUS_PADDING_M)
  const h = Math.max(FOCUS_MIN_M, Math.max(...ys) - Math.min(...ys) + 2 * FOCUS_PADDING_M)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

interface Props {
  map: ScaleMapData
  /** 大區域 key → 顯示名稱 */
  areaNames: Record<string, string>
  here?: { coords: LatLng; accuracy: number }
  marks: MapMark[]
  /** 在地圖上點位置的模式：點一下就回傳那裡的經緯度（不選救援點）；at 是目前點的位置 */
  pick?: { at?: LatLng; onPick: (at: LatLng) => void }
  /** 按「回到我的位置」：還沒定位時由外層開始定位，定位到之後地圖自動移過去；在範圍外時地圖不動，由外層說明。沒有時不顯示這個按鈕 */
  onLocate?: () => void
  /** 長按（電腦為按右鍵）區域時：大區域 key */
  onAreaPress?: (area: string) => void
  /** 左上角的按鈕（測試版說明、回報） */
  topLeft?: ReactNode
  /** 聚焦的區域、救援點（例如救援頁從區域進來時）；有聚焦時，定位到也不會自動移到目前位置 */
  focus?: MapFocus
  /** 選中的救援點或急救器材：加大標示 */
  selected?: MapSelection
  /** 點救援點或急救器材時 */
  onSelect?: (selection: MapSelection) => void
  /** 底圖換成國土測繪中心的航照（區域只畫邊框） */
  ortho?: boolean
}

/**
 * 照比例尺的龍洞地圖：配色與救援資訊圖相同，操作像 Google 地圖：
 * 拖曳平移、雙指縮放與旋轉、滾輪縮放、雙擊放大；右上羅盤點一下回到北方朝上，右下回到我的位置。
 * 最多縮到範圍的上下填滿畫面，上下不露出範圍外的空白；一開始左右置中在岩場。
 * 第一次定位到、且在龍洞範圍內時，自動移到目前位置。
 * 陸地、區域、道路等圖形隨地圖旋轉；圖示與文字畫在螢幕座標上，旋轉後仍然朝上、維持固定大小。
 */
export function ScaleMap({ map, areaNames, here, marks, pick, onLocate, onAreaPress, topLeft, focus, selected, onSelect, ortho }: Props) {
  const { lang, t } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<Size>()
  const [view, setView] = useState<MapView>()
  // 事件處理只註冊一次，從這裡讀最新的狀態
  const latest = useRef({ frame, view })
  latest.current = { frame, view }

  /** 套用新的畫面狀態（限制在縮放與平移範圍內） */
  const apply = (next: (v: MapView, f: Size) => MapView) => {
    const { frame: f, view: v } = latest.current
    if (!f || !v) return
    const clamped = clampView(next(v, f), BOUNDS, f)
    latest.current = { frame: f, view: clamped }
    setView(clamped)
  }
  const center = (f: Size): Point => ({ x: f.w / 2, y: f.h / 2 })
  /** 以框內一點（預設為中心）為準縮放到每像素 s 公尺 */
  const zoomTo = (s: number, at?: Point) => apply((v, f) => zoomAt(v, f, at ?? center(f), clampScale(s, BOUNDS, f)))

  // 框的大小只由版面決定（地圖填滿框，沒有捲軸），不會因為地圖本身改變而來回重算
  useLayoutEffect(() => {
    const el = box.current!
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      const f = { w: el.clientWidth, h: el.clientHeight }
      setFrame(f)
      setView((v) => {
        if (v) return clampView(v, BOUNDS, f)
        const target = latestFocus.current
        return target ? focusView(target, BOUNDS, f) : fitView(BOUNDS, f, CRAG_X)
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 聚焦：一開始（上面）與 key 改變時移過去
  const target = focus && focusRect(focus, map)
  const latestFocus = useRef(target)
  latestFocus.current = target
  const focused = useRef(focus?.key)
  useEffect(() => {
    if (!frame || focus?.key === focused.current) return
    focused.current = focus?.key
    if (target) apply(() => focusView(target, BOUNDS, frame))
  }, [focus?.key, !!frame])

  // 急救器材實際畫在螢幕上的位置（被擋住時挪到旁邊），點按判斷用
  const emsAt = useRef(new Map<number, Vec>())
  // 拖曳、縮放、旋轉、長按區域（useMapGestures）
  const gestures = useRef<MapGestures>(undefined!)
  gestures.current = {
    apply,
    areaAt: (p) => {
      const { frame: f, view: v } = latest.current
      if (!f || !v) return undefined
      const at = toMap(v, f, [p.x, p.y])
      // 區域重疊時取畫在最上面的（後面的）
      return () => map.areas.findLast((a) => a.rings.some((r) => insideRing(at, r)))?.id
    },
    onAreaPress,
    onTap: (p) => {
      const { frame: f, view: v } = latest.current
      if (f && v && pick) return pick.onPick(unproject(toMap(v, f, [p.x, p.y])))
      if (!f || !v || !onSelect) return
      const distance = ([x, y]: Vec) => Math.hypot(x - p.x, y - p.y)
      const candidates = [
        ...located.map((pt) => ({ selection: { kind: 'rescue', key: pt.key } as MapSelection, at: toScreen(v, f, pt.at) })),
        // 急救器材點在畫出來的位置（可能挪到旁邊）
        ...map.markers.flatMap((m, i) =>
          m.kind === 'ems' ? [{ selection: { kind: 'ems', no: m.no } as MapSelection, at: emsAt.current.get(i) ?? toScreen(v, f, m.at) }] : [],
        ),
      ]
      const hit = candidates
        .map((c) => ({ ...c, d: distance(c.at) }))
        .filter((h) => h.d <= POINT_HIT_PX)
        .sort((a, b) => a.d - b.d)[0]
      if (hit) onSelect(hit.selection)
    },
  }
  useMapGestures(box, gestures)

  const me = here && project(here.coords)

  // 移到目前位置：第一次定位到（在龍洞範圍內）時自動移過去；按了「回到我的位置」但還沒定位時，定位到再移過去。
  // 之後換了聚焦就以聚焦為準（centerPending）
  const centerRequest = useRef<CenterRequest | undefined>(focus ? undefined : { focus: undefined })
  const goToMe = (at: Vec) => {
    centerRequest.current = undefined
    apply((v) => ({ ...v, cx: at[0], cy: at[1], s: Math.min(v.s, ME_SCALE) }))
  }
  useEffect(() => {
    if (centerPending(centerRequest.current, focus?.key) && me && view && inBounds(me)) goToMe(me)
  }, [me?.[0], me?.[1], !!view])

  const locate = () => {
    // 在範圍外：移過去只會看到範圍邊緣的空白，地圖不動
    if (me) {
      if (inBounds(me)) goToMe(me)
    } else centerRequest.current = { focus: focus?.key }
    onLocate?.()
  }

  if (!frame || !view) {
    return <div className="scale-map-frame" ref={box} />
  }

  const screen = (p: Vec) => toScreen(view, frame, p)
  const isSelectedRescue = (key: string) => selected?.kind === 'rescue' && selected.key === key
  const isSelectedEms = (no: number) => selected?.kind === 'ems' && selected.no === no
  /** 一個螢幕像素等於幾公尺：地圖圖形的線寬、虛線用它換算成固定的螢幕大小 */
  const px = view.s
  const atMax = view.s <= MIN_SCALE * 1.0001
  const atMin = view.s >= maxScale(BOUNDS, frame) * 0.9999
  const north = (view.r * 180) / Math.PI

  const trailDash = dashLength(3, px)
  const tunnelDash = dashLength(6, px)
  const bar = SCALE_BARS.filter((m) => m / px <= SCALE_BAR_PX).pop() ?? SCALE_BARS[0]
  const { shown, labels, nudged } = declutter(map.markers, map.areas, areaNames, screen, lang, t('map.hazard'))
  emsAt.current = nudged
  // 圓的半徑大於畫面對角線時，海面用大矩形蓋滿（旋轉後四角也不會露白）
  const cover = Math.hypot(frame.w, frame.h) * px

  return (
    <div className={`scale-map-frame${ortho ? ' sm-ortho' : ''}`} ref={box}>
      <svg width={frame.w} height={frame.h} role="img" aria-label={t('map.mapAria')}>
        <g transform={mapTransform(view, frame)}>
          <rect className="sm-sea" x={view.cx - cover} y={view.cy - cover} width={cover * 2} height={cover * 2} />
          <path className="sm-land" d={map.layers.land} fillRule="evenodd" />
          <path className="sm-building" d={map.layers.building} />
          {ortho &&
            orthoTiles(view, frame, window.devicePixelRatio).map((tile) => (
              <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.w} height={tile.h} preserveAspectRatio="none" />
            ))}
          {map.areas.map((a) => (
            <path key={a.id} className={`sm-area sm-area-${a.id}${focus?.area && a.id !== focus.area ? ' sm-dim' : ''}`} d={a.path} strokeWidth={px} />
          ))}
          <path className="sm-highway" d={map.layers.highway} strokeWidth={5 * px} />
          <path className="sm-tunnel" d={map.layers.tunnel} strokeWidth={5 * px} strokeDasharray={`${tunnelDash / 3} ${tunnelDash}`} />
          <path className="sm-road" d={map.layers.road} strokeWidth={2.5 * px} />
          {/* 停車場的範圍（深藍色），P 字畫在上面的圖示層 */}
          <path className="sm-parking-area" d={map.layers.parking} />
          <path className="sm-trail" d={map.layers.trail} strokeWidth={2 * px} strokeDasharray={`${trailDash} ${trailDash}`} />
          {me && here && <circle className="sm-me-accuracy" cx={me[0]} cy={me[1]} r={here.accuracy} />}
        </g>

        <g fontSize={LABEL_PX}>
          {map.markers.map((m, i) => {
            if (!shown.has(i)) return null
            const [x, y] = screen(m.at)
            if (m.kind === 'place')
              return (
                <text key={i} className={`sm-place sm-place-${m.tone}`} x={x} y={y} fontSize={11} textAnchor="middle" dominantBaseline="central">
                  {placeName(m, lang)}
                </text>
              )
            if (m.kind === 'hazard')
              return (
                <g key={i} className="sm-hazard">
                  <circle cx={x} cy={y} r={HAZARD_R} />
                  <text x={x} y={y} fontSize={10} textAnchor="middle" dominantBaseline="central">
                    !
                  </text>
                  <text className="sm-hazard-label" x={x + HAZARD_R + 4} y={y} fontSize={10} dominantBaseline="central">
                    {t('map.hazard')}
                  </text>
                </g>
              )
            if (m.kind === 'boat')
              return (
                <g key={i} className="sm-boat">
                  <title>{t('map.boat')}</title>
                  <circle cx={x} cy={y} r={6} strokeWidth={1} />
                  <circle cx={x} cy={y} r={3.5} strokeWidth={1.5} />
                  <circle className="sm-boat-dot" cx={x} cy={y} r={1.6} />
                </g>
              )
            if (m.kind === 'hoist')
              return (
                <g key={i} className="sm-hoist">
                  <title>{t('map.hoist')}</title>
                  {/* 圖釘：尖端在實際位置 */}
                  <path d={`M${x} ${y}l-5.5 -9a6.4 6.4 0 1 1 11 0z`} />
                  <text x={x} y={y - 12.5} fontSize={8} textAnchor="middle" dominantBaseline="central">
                    H
                  </text>
                </g>
              )
            // 停車場的 P 畫在救援點上面（見下方）
            if (m.kind === 'parking') return null
            // 被擋住時挪到旁邊（見 declutter），細線連回實際位置
            const moved = nudged.get(i)
            const [ex, ey] = moved ?? [x, y]
            return (
              <g key={i} className={`sm-ems${isSelectedEms(m.no) ? ' selected' : ''}`}>
                <title>{t('map.ems', { n: m.no })}</title>
                {moved && <line className="sm-ems-link" x1={x} y1={y} x2={ex} y2={ey} />}
                {moved && <circle className="sm-ems-dot" cx={x} cy={y} r={2} />}
                <rect x={ex - 6} y={ey - 7} width={12} height={14} rx={4} />
                <path d={`M${ex - 3.5} ${ey}h7M${ex} ${ey - 3.5}v7`} strokeWidth={2} />
              </g>
            )
          })}
          {labels.map((l) => (
            <text key={l.id} className={`sm-label sm-label-${l.id}`} x={l.at[0]} y={l.at[1]} textAnchor="middle" dominantBaseline="central">
              {l.text}
            </text>
          ))}
          {located.map((p, i) => {
            const [x, y] = screen(p.at)
            const on = isSelectedRescue(p.key) || !!focus?.points?.includes(p.key)
            return (
              <g key={i} className={`sm-rescue${on ? ' on' : ''}${isSelectedRescue(p.key) ? ' selected' : ''}`}>
                <circle cx={x} cy={y} r={on ? 10 : 7} />
                <text x={x} y={y} fontSize={on ? 11 : 9} textAnchor="middle" dominantBaseline="central">
                  {p.no}
                </text>
              </g>
            )
          })}
          {map.markers.map((m, i) => {
            if (m.kind !== 'parking') return null
            const [x, y] = screen(m.at)
            return (
              <text key={i} className="sm-parking" x={x} y={y} fontSize={12} textAnchor="middle" dominantBaseline="central">
                P
              </text>
            )
          })}
          {[...marks].sort((a, b) => Number(!!a.selected) - Number(!!b.selected)).map((m, i) => {
            const [x, y] = screen(project(m.at))
            const p = m.picked && screen(project(m.picked))
            // 有編號時寫在圓點裡（與清單對照），圓點放大
            const r = (m.label ? 9 : 5) + (m.selected ? 3 : 0)
            const d = m.label ? 6 : r + 1
            return (
              <g key={i} className={`sm-mark${m.selected ? ' selected' : ''}`}>
                {p && <line className="sm-mark-link" x1={x} y1={y} x2={p[0]} y2={p[1]} />}
                {p && <path className="sm-mark-picked" d={`M${p[0]} ${p[1] - d}l${d} ${d}l${-d} ${d}l${-d} ${-d}z`} />}
                <circle className="sm-mark-gps" cx={x} cy={y} r={r} />
                {m.label && (
                  <text x={x} y={y} fontSize={m.selected ? 12 : 10} textAnchor="middle" dominantBaseline="central">
                    {m.label}
                  </text>
                )}
              </g>
            )
          })}
          {pick?.at && (
            <g className="sm-pick">
              <path d={`M${screen(project(pick.at))[0]} ${screen(project(pick.at))[1]}l-9 -22a10 10 0 1 1 18 0z`} />
              <circle cx={screen(project(pick.at))[0]} cy={screen(project(pick.at))[1] - 22} r={3.5} />
            </g>
          )}
          {me && (
            <circle className="sm-me" cx={screen(me)[0]} cy={screen(me)[1]} r={7} strokeWidth={2.5} />
          )}
        </g>
      </svg>

      {topLeft && <div className="sm-top-left">{topLeft}</div>}

      <button type="button" className="sm-control sm-compass" onClick={() => apply((v, f) => rotateAt(v, f, center(f), 0))} aria-label={t('map.north')} title={t('map.north')}>
        <svg viewBox="-12 -12 24 24" width="24" height="24" aria-hidden style={{ transform: `rotate(${north}deg)` }}>
          <path d="M0 -10l4 10h-8z" fill="#d93025" />
          <path d="M0 10l4 -10h-8z" fill="currentColor" opacity="0.45" />
        </svg>
      </button>

      <div className="sm-bottom-right">
        <div className="sm-zoom">
          <button type="button" className="sm-control" onClick={() => zoomTo(view.s / STEP)} disabled={atMax} aria-label={t('rescue.zoomIn')}>
            ＋
          </button>
          <button type="button" className="sm-control" onClick={() => zoomTo(view.s * STEP)} disabled={atMin} aria-label={t('rescue.zoomOut')}>
            －
          </button>
        </div>
        {onLocate && (
          <button type="button" className={`sm-control sm-locate${me ? ' on' : ''}`} onClick={locate} aria-label={t('map.locate')} title={t('map.locate')}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <circle cx="12" cy="12" r="4" fill="currentColor" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        )}
      </div>


      {/* 圖形來自 TOCC 救援資訊圖；道路與海岸以 OpenStreetMap 校正（ODbL 要求在地圖上標示）；島礁位置與航照底圖來自國土測繪中心（政府資料開放授權要求標示） */}
      <p className="sm-attribution">
        © TOCC · {t('map.nlscCredit')} ·{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
      </p>

      <div className="scale-map-legend" aria-hidden>
        <span className="sm-bar" style={{ width: bar / px }} />
        {t('myloc.m', { n: bar })}
      </div>
    </div>
  )
}
