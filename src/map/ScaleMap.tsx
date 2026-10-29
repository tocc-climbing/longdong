import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LatLng } from '../geo'
import { useLang } from '../i18n'
import { BOUNDS, EXTENT, inBounds, located } from './bounds'
import { project, unproject, type LineName, type Marker, type PlaceTone, type ScaleMapData } from './mapData'
import { MIN_SCALE, centerPending, clampScale, clampView, dashLength, fitRectView, focusView, mapTransform, maxScale, rotateAt, toMap, toScreen, zoomAt, type CenterRequest, type MapView, type Rect, type Size } from './mapView'
import { placeLineNames } from './lineLabels'
import { orthoLevel, orthoTiles } from './ortho'
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

/**
 * 圖示與地名越前面越重要：重疊時先畫重要的，其他的等放大後空間夠了才出現（救援點、停車場、急救器材一定畫，不在這裡排）。
 * 救援用的（直升機吊掛點、船艇接駁點、紅色的警示如安檢所）排在區域名稱前面；其他地名排在區域、分區名稱後面，
 * 依顏色種類：一般地名、步道、海面、危險地形（去過的岩友知道怎麼走，排後面）、道路（沿線的道路、步道名稱最後才排，見 lineLabels.ts）。
 */
const MARKER_PRIORITY = { hoist: 0, boat: 1, hazard: 6 }
const PLACE_PRIORITY: Record<PlaceTone, number> = { warning: 2, place: 3, trail: 4, sea: 5, road: 7 }
const priority = (m: Marker) => (m.kind === 'place' ? PLACE_PRIORITY[m.tone] : m.kind in MARKER_PRIORITY ? MARKER_PRIORITY[m.kind as keyof typeof MARKER_PRIORITY] : 9)
/** 救援用的：排在區域名稱前面 */
const isRescue = (m: Marker) => m.kind === 'hoist' || m.kind === 'boat' || (m.kind === 'place' && m.tone === 'warning')

/** 地名、道路與步道的名稱：英文版用英文，日文版用日文（沒有時用中文） */
const placeName = (m: Extract<Marker, { kind: 'place' }> | LineName, lang: string) => (lang === 'en' ? m.en : lang === 'ja' ? (m.ja ?? m.zh) : m.zh)
/** 道路、步道名稱的字級；排字的那段線要比文字長這麼多（像素） */
const LINE_NAME_PX = 11
const LINE_NAME_PAD_PX = 16

/** 危險地形的圖示（半徑）與右邊的文字 */
const HAZARD_R = 7

/** 道路、步道至少畫成實際的寬度（公尺）：放大後跟著變粗，和航照上的路一樣寬 */
const ROAD_WIDTH_M = { highway: 8, road: 5, trail: 1.5 }
/** 岩壁線至少畫成的寬度（公尺）；每像素超過 CLIFF_TICK_MAX_M_PER_PX 公尺（縮小到刻線擠在一起）時不畫刻線 */
const CLIFF_WIDTH_M = 0.6
const CLIFF_TICK_MAX_M_PER_PX = 1
/** 放大到每像素不到 ICON_GROW_SCALE 公尺時，圖示跟著放大，最多 ICON_MAX_GROW 倍 */
const ICON_GROW_SCALE = 0.5
const ICON_MAX_GROW = 1.6
/** 航照完全不透明，避免底層陸海填色透出造成色塊 */
const ORTHO_OPACITY = 1
/** 縮放停下多久（毫秒）才換航照的圖磚層級：縮放中沿用原本的層級，不會一直換圖磚而閃動 */
const ORTHO_SETTLE_MS = 300

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
 * 決定要畫哪些圖示與文字（都在螢幕座標上算，旋轉後也正確），依優先順序排，和已畫的東西重疊就先不畫：
 *   1. 救援點、停車場一定畫（救援時最重要；停車場是進出岩場的集合點）。停車場 P 的位置在產生地圖時就避開救援點，畫在救援點上面；
 *      急救器材也一定畫：和上面這些重疊時往旁邊空的地方挪（nudged，螢幕座標），畫一條細線連回實際位置
 *   2. 其他救援用的圖示與地名（直升機吊掛點、船艇接駁點、安檢所）
 *   3. 攀岩：區域名稱（面積大的先）、分區名稱
 *   4. 其他地名、危險地形（priority）
 * 道路、步道沿線的名稱最後排（occupied 是到這裡為止佔掉的範圍，見 lineLabels.ts）。
 */
function declutter(
  markers: Marker[],
  areas: ScaleMapData['areas'],
  names: Record<string, string>,
  sectors: { id: string; text: string; at: Vec }[],
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
  const always = (m: Marker) => m.kind === 'parking'
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
  const others = markers
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !always(m) && m.kind !== 'ems')
    .sort((a, b) => priority(a.m) - priority(b.m))
  const place = (list: typeof others) => list.filter(({ m }) => fits(markerBox(m, screen(m.at), lang, hazardLabel))).map(({ i }) => i)
  const rescue = place(others.filter(({ m }) => isRescue(m)))
  const labels = [...areas]
    .sort((x, y) => y.size - x.size)
    .map((a) => ({ id: a.id, text: names[a.id] ?? a.id, at: screen(a.label) }))
    .filter((l) => fits(around(l.at, textWidth(l.text, LABEL_PX) / 2 + 4, LABEL_PX / 2 + 2)))
  const sectorLabels = sectors.filter((l) => fits(around(l.at, textWidth(l.text, SECTOR_LABEL_PX) / 2 + 2, SECTOR_LABEL_PX / 2 + 2)))
  const shown = new Set([...fixed, ...ems, ...rescue, ...place(others.filter(({ m }) => !isRescue(m)))])
  return { shown, labels, sectorLabels, nudged, occupied }
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

/**
 * 地圖上的折線（岩壁標記）：key 用來回報點到哪一條；label 在選中時顯示；
 * draft 是正在畫的：虛線，標出每個點。
 */
export interface MapLine {
  key: string
  points: LatLng[]
  label?: string
  draft?: boolean
  /** 正在畫多邊形：還沒閉環時，用半透明顯示暫時封閉的區域（3 點以上），最後一點到起點畫一條淡的虛線 */
  closed?: boolean
  selected?: boolean
}

/**
 * 編輯地圖（登入者）：rings 是正在編輯的多塊多邊形（closed）或多條線段（步道）；選中的那塊顯示頂點，
 * 拖曳頂點移動、按邊上的小點加一個頂點、右鍵刪除頂點（多邊形至少留三點、線段兩點）；點其他塊選它。
 */
export interface MapEdit {
  rings: LatLng[][]
  closed: boolean
  selected?: number
  onChange: (rings: LatLng[][]) => void
  /** 一次修改開始（按下頂點、加頂點、刪頂點）：復原以這為一步，拖曳中的每次移動不算 */
  onChangeStart?: () => void
  onSelect: (index: number) => void
}

/** 選中的救援點（#12 有兩個點共用編號，用 key 區分）或急救器材 */
export type MapSelection = { kind: 'rescue'; key: string } | { kind: 'ems'; no: number }

/** 聚焦範圍外留的邊（公尺）；範圍至少這麼大，只聚焦一個救援點時也看得到周圍的區域與步道 */
const FOCUS_PADDING_M = 30
const FOCUS_MIN_M = 200
/** 點救援點：離圓心這個距離（像素）內都算 */
const POINT_HIT_PX = 18
/** 地圖上的資訊框：半寬（像素，左右不超出地圖）、離上緣不到這個距離就改顯示在下方 */
const POPUP_HALF_PX = 150
const POPUP_FLIP_PX = 140
/** 放大到每像素不到這麼多公尺時才顯示分區名稱 */
const SECTOR_LABEL_SCALE = 0.4
/** 分區名稱的字級 */
const SECTOR_LABEL_PX = 11
/** 點折線：離線段這個距離（像素）內都算 */
const LINE_HIT_PX = 10

/** 點到線段的距離（螢幕像素） */
function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

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

/** 9 個大區域合起來的範圍（地圖座標）：一開始的畫面以它為準；沒有區域時用整個移動範圍 */
function areasRect(map: ScaleMapData): Rect {
  const xy = map.areas.flatMap((a) => a.rings.flat())
  if (xy.length === 0) return BOUNDS
  const xs = xy.map((p) => p[0])
  const ys = xy.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

interface Props {
  map: ScaleMapData
  /** 大區域 key → 顯示名稱 */
  areaNames: Record<string, string>
  here?: { coords: LatLng; accuracy: number }
  marks: MapMark[]
  /** 在地圖上點位置的模式：點一下就回傳那裡的經緯度（不選救援點）；at 是目前點的位置 */
  pick?: { at?: LatLng; onPick: (at: LatLng, metersPerPixel: number) => void }
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
  /** 選中的救援點或急救器材的資訊，顯示在地圖上那一點的旁邊 */
  popup?: ReactNode
  /** 點地圖的其他地方（關掉資訊） */
  onDeselect?: () => void
  /** 折線（岩壁標記） */
  lines?: MapLine[]
  /** 點到折線時（不在點位置的模式） */
  onLineTap?: (key: string) => void
  /** 分區 ID → 名稱：有傳才顯示分區範圍的標籤 */
  sectorNames?: Record<string, string>
  /** 編輯多邊形（管理員） */
  edit?: MapEdit
  /** 不畫大區域與分區範圍（編輯步道、道路時看得比較清楚） */
  hideAreas?: boolean
  /** 底圖換成國土測繪中心的航照（區域只畫邊框） */
  ortho?: boolean
}

/**
 * 照比例尺的龍洞地圖：配色與救援資訊圖相同，操作像 Google 地圖：
 * 拖曳平移、雙指縮放與旋轉、滾輪縮放、雙擊放大；右上羅盤點一下回到北方朝上，右下回到我的位置。
 * 最多縮到範圍的上下填滿畫面，上下不露出範圍外的空白；一開始（沒有聚焦的對象時）縮放到剛好看到 9 個大區域、置中，上下各留 10%、左右各留 5%（寬螢幕、直立的 iPad 也置中，超出範圍的部分是和海同色的底圖）。
 * 第一次定位到、且在龍洞範圍內時，自動移到目前位置。
 * 陸地、區域、道路等圖形隨地圖旋轉；圖示與文字畫在螢幕座標上，旋轉後仍然朝上、維持固定大小。
 */
export function ScaleMap({ map, areaNames, here, marks, pick, onLocate, onAreaPress, topLeft, focus, selected, onSelect, popup, onDeselect, lines, onLineTap, sectorNames, edit, hideAreas, ortho }: Props) {
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
        return target ? focusView(target, BOUNDS, f) : fitRectView(areasRect(latestMap.current), BOUNDS, f)
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const latestMap = useRef(map)
  latestMap.current = map

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
      if (f && v && pick) return pick.onPick(unproject(toMap(v, f, [p.x, p.y])), v.s)
      if (!f || !v) return
      // 編輯多邊形時：點到哪一塊就選它
      if (edit) {
        const at = toMap(v, f, [p.x, p.y])
        const near = (r: LatLng[]) => {
          const pts = r.map((q) => toScreen(v, f, project(q)))
          return Math.min(...pts.slice(1).map((b, i) => segmentDistance([p.x, p.y], pts[i], b)))
        }
        const i = edit.closed
          ? edit.rings.findIndex((r) => insideRing(at, r.map(project)))
          : edit.rings.map((r, i) => ({ i, d: near(r) })).filter((x) => x.d <= LINE_HIT_PX).sort((a, b) => a.d - b.d)[0]?.i ?? -1
        if (i >= 0) edit.onSelect(i)
        return
      }
      const distance = ([x, y]: Vec) => Math.hypot(x - p.x, y - p.y)
      const candidates = [
        ...located.map((pt) => ({ selection: { kind: 'rescue', key: pt.key } as MapSelection, at: toScreen(v, f, pt.at) })),
        // 急救器材點在畫出來的位置（可能挪到旁邊）
        ...map.markers.flatMap((m, i) =>
          m.kind === 'ems' ? [{ selection: { kind: 'ems', no: m.no } as MapSelection, at: emsAt.current.get(i) ?? toScreen(v, f, m.at) }] : [],
        ),
      ]
      const hit = onSelect && candidates
        .map((c) => ({ ...c, d: distance(c.at) }))
        .filter((h) => h.d <= POINT_HIT_PX)
        .sort((a, b) => a.d - b.d)[0]
      if (hit) return onSelect(hit.selection)
      // 救援點優先；其次是最近的折線
      const line = onLineTap && (lines ?? [])
        .filter((l) => !l.draft)
        .map((l) => {
          const pts = l.points.map((q) => toScreen(v, f, project(q)))
          return { key: l.key, d: Math.min(...pts.slice(1).map((b, i) => segmentDistance([p.x, p.y], pts[i], b))) }
        })
        .filter((l) => l.d <= LINE_HIT_PX)
        .sort((a, b) => a.d - b.d)[0]
      if (line) return onLineTap(line.key)
      onDeselect?.()
    },
  }
  useMapGestures(box, gestures)
  /** 道路、步道名稱的 textPath、頁框與範圍的 clipPath 的 id（一頁可能有好幾個地圖；useId 可能含冒號，url(#…) 引用前去掉） */
  const nameId = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  // 航照的圖磚層級：縮放停下 ORTHO_SETTLE_MS 後才換（第一次直接用）
  const wantLevel = ortho && view ? orthoLevel(view, window.devicePixelRatio) : undefined
  const [orthoZ, setOrthoZ] = useState<number>()
  useEffect(() => {
    if (wantLevel === undefined) return
    const timer = setTimeout(() => setOrthoZ(wantLevel), ORTHO_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [wantLevel])

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

  // 步道畫成實際寬度後，虛線也不要比路寬短（否則看起來像實線）
  const trailDash = Math.max(dashLength(3, px), 2 * ROAD_WIDTH_M.trail)
  /** 圖示放大的倍數，與以圖示位置為中心放大的 transform */
  const grow = Math.min(ICON_MAX_GROW, Math.max(1, ICON_GROW_SCALE / view.s))
  const grown = (x: number, y: number) => (grow === 1 ? undefined : `translate(${x} ${y}) scale(${grow}) translate(${-x} ${-y})`)
  // 隧道畫成實際寬度後，虛線間距跟著路寬放大（否則變成一顆顆圓點）
  const tunnelDash = Math.max(dashLength(6, px), 3 * ROAD_WIDTH_M.highway)
  const bar = SCALE_BARS.filter((m) => m / px <= SCALE_BAR_PX).pop() ?? SCALE_BARS[0]
  const sectorTexts =
    sectorNames && view.s < SECTOR_LABEL_SCALE ? map.sectors.map((s) => ({ id: s.id, text: sectorNames[s.sector] ?? s.sector, at: screen(s.label) })) : []
  const { shown, labels, sectorLabels, nudged, occupied } = declutter(map.markers, hideAreas ? [] : map.areas, areaNames, hideAreas ? [] : sectorTexts, screen, lang, t('map.hazard'))
  emsAt.current = nudged
  // 圓的半徑大於畫面對角線時，海面用大矩形蓋滿（旋轉後四角也不會露白）
  const cover = Math.hypot(frame.w, frame.h) * px

  return (
    <div className={`scale-map-frame${ortho ? ' sm-ortho' : ''}`} ref={box}>
      <svg width={frame.w} height={frame.h} role="img" aria-label={t('map.mapAria')}>
        <g transform={mapTransform(view, frame)}>
          {/* OpenStreetMap 的陸地墊在底下（到資料範圍 EXTENT）；救援資訊圖的陸地只畫在它的頁框（page）裡；航照只畫在資料範圍裡 */}
          <defs>
            {map.layers.page && (
              <clipPath id={`${nameId}-page`}>
                <path d={map.layers.page} />
              </clipPath>
            )}
            <clipPath id={`${nameId}-extent`}>
              <rect x={EXTENT.x} y={EXTENT.y} width={EXTENT.w} height={EXTENT.h} />
            </clipPath>
          </defs>
          <rect className="sm-sea" x={view.cx - cover} y={view.cy - cover} width={cover * 2} height={cover * 2} />
          {map.layers.outerLand && <path className="sm-land" d={map.layers.outerLand} />}
          <path className="sm-land" d={map.layers.land} fillRule="evenodd" clipPath={map.layers.page && `url(#${nameId}-page)`} />
          <path className="sm-building" d={(map.layers.building ?? '') + (map.layers.outerBuilding ?? '')} />
          {ortho && (
            <g opacity={ORTHO_OPACITY} clipPath={`url(#${nameId}-extent)`}>
            {orthoTiles(view, frame, window.devicePixelRatio, orthoZ ?? wantLevel).map((tile) => (
              // CORS 載入：Service Worker 才能存成一般的回應（離線快取，見 ortho.ts）
              <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.w} height={tile.h} preserveAspectRatio="none" crossOrigin="anonymous" />
            ))}
            </g>
          )}
          {!hideAreas && map.areas.map((a) => (
            <path key={a.id} className={`sm-area sm-area-${a.id}${focus?.area && a.id !== focus.area ? ' sm-dim' : ''}`} d={a.path} strokeWidth={px} />
          ))}
          {!hideAreas && map.sectors.map((s) => (
            <path key={s.id} className="sm-sector" d={s.path} />
          ))}
          {/* OpenStreetMap 的岩壁（唯讀）：刻線在低的一側，縮小到刻線擠在一起時只畫線 */}
          <g className="sm-cliff">
            <path d={map.layers.cliff} strokeWidth={Math.max(1.5 * px, CLIFF_WIDTH_M)} />
            {px <= CLIFF_TICK_MAX_M_PER_PX && <path d={map.layers.cliffTick} strokeWidth={Math.max(px, CLIFF_WIDTH_M / 2)} />}
          </g>
          {/* 道路與停車場一組：航照下整組一起半透明，相接、重疊的地方不會疊深；頁框外的 OSM 道路接在同一條路徑裡 */}
          <g className="sm-roads">
            <path className="sm-highway" d={map.layers.highway + (map.layers.outerHighway ?? '')} strokeWidth={Math.max(5 * px, ROAD_WIDTH_M.highway)} />
            <path className="sm-tunnel" d={map.layers.tunnel} strokeWidth={Math.max(5 * px, ROAD_WIDTH_M.highway)} strokeDasharray={`${tunnelDash / 3} ${tunnelDash}`} />
            <path className="sm-road" d={map.layers.road + (map.layers.outerRoad ?? '')} strokeWidth={Math.max(2.5 * px, ROAD_WIDTH_M.road)} />
            {/* 停車場的範圍（深藍色），P 字畫在上面的圖示層 */}
            <path className="sm-parking-area" d={map.layers.parking} />
          </g>
          <path className="sm-trail" d={map.layers.trail + (map.layers.outerTrail ?? '')} strokeWidth={Math.max(2 * px, ROAD_WIDTH_M.trail)} strokeDasharray={`${trailDash} ${trailDash}`} />
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
                <g key={i} className="sm-hazard" transform={grown(x, y)}>
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
                <g key={i} className="sm-boat" transform={grown(x, y)}>
                  <title>{t('map.boat')}</title>
                  <circle cx={x} cy={y} r={6} strokeWidth={1} />
                  <circle cx={x} cy={y} r={3.5} strokeWidth={1.5} />
                  <circle className="sm-boat-dot" cx={x} cy={y} r={1.6} />
                </g>
              )
            if (m.kind === 'hoist')
              return (
                <g key={i} className="sm-hoist" transform={grown(x, y)}>
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
                <g transform={grown(ex, ey)}>
                  <rect x={ex - 6} y={ey - 7} width={12} height={14} rx={4} />
                  <path d={`M${ex - 3.5} ${ey}h7M${ex} ${ey - 3.5}v7`} strokeWidth={2} />
                </g>
              </g>
            )
          })}
          {(() => {
            // 道路、步道的名稱沿著線排（位置固定在地圖上，放不下就不畫，見 lineLabels.ts）
            const names = placeLineNames(map.names, map.lineLayers, screen, frame, (n) => textWidth(placeName(n, lang), LINE_NAME_PX) + LINE_NAME_PAD_PX, occupied, view.s)
            return (
              <>
                <defs>
                  {names.map((p, i) => (
                    <path key={p.key} id={`${nameId}-${i}`} d={'M' + p.points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')} />
                  ))}
                </defs>
                {names.map((p, i) => (
                  <text key={p.key} className={`sm-place sm-place-${p.name.tone} sm-line-name`} fontSize={LINE_NAME_PX} dominantBaseline="central">
                    <textPath href={`#${nameId}-${i}`} startOffset="50%" textAnchor="middle">
                      {placeName(p.name, lang)}
                    </textPath>
                  </text>
                ))}
              </>
            )
          })()}
          {!hideAreas && labels.map((l) => (
            <text key={l.id} className={`sm-label sm-label-${l.id}`} x={l.at[0]} y={l.at[1]} textAnchor="middle" dominantBaseline="central">
              {l.text}
            </text>
          ))}
          {sectorLabels.map((l) => (
            <text key={l.id} className="sm-sector-label" x={l.at[0]} y={l.at[1]} fontSize={SECTOR_LABEL_PX} textAnchor="middle" dominantBaseline="central">
              {l.text}
            </text>
          ))}
          {lines?.map((l) => {
            const pts = l.points.map((q) => screen(project(q)))
            const d = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')
            const mid = pts[Math.floor(pts.length / 2)]
            const preview = l.draft && l.closed && pts.length >= 3
            return (
              <g key={l.key} className={`sm-line${l.draft ? ' draft' : ''}${l.selected ? ' selected' : ''}`}>
                {preview && <path className="sm-line-fill" d={`${d}Z`} />}
                {preview && <path className="sm-line-close" d={`M${pts[pts.length - 1][0].toFixed(1)} ${pts[pts.length - 1][1].toFixed(1)}L${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`} />}
                {pts.length > 1 && <path className="sm-line-casing" d={d} />}
                {pts.length > 1 && <path className="sm-line-stroke" d={d} />}
                {l.draft && pts.map(([x, y], i) => <circle key={i} className="sm-line-vertex" cx={x} cy={y} r={4} />)}
                {l.selected && l.label && mid && (
                  <text className="sm-line-label" x={mid[0]} y={mid[1] - 10} fontSize={12} textAnchor="middle">
                    {l.label}
                  </text>
                )}
              </g>
            )
          })}
          {located.map((p, i) => {
            const [x, y] = screen(p.at)
            const on = isSelectedRescue(p.key) || !!focus?.points?.includes(p.key)
            return (
              <g key={i} className={`sm-rescue${on ? ' on' : ''}${isSelectedRescue(p.key) ? ' selected' : ''}`} transform={grown(x, y)}>
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
              <text key={i} className="sm-parking" x={x} y={y} fontSize={12} textAnchor="middle" dominantBaseline="central" transform={grown(x, y)}>
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
          {edit?.rings.map((ring, i) => {
            const pts = ring.map((q) => screen(project(q)))
            const d = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + (edit.closed ? 'Z' : '')
            return <path key={i} className={`sm-edit-ring${edit.closed ? '' : ' open'}${i === edit.selected ? ' selected' : ''}`} d={d} />
          })}
          {edit?.selected !== undefined && edit.rings[edit.selected] && (
            <EditHandles
              ring={edit.rings[edit.selected]}
              closed={edit.closed}
              screen={(q) => screen(project(q))}
              toLatLng={(clientX, clientY) => {
                const r = box.current!.getBoundingClientRect()
                const { view: v, frame: f } = latest.current
                return unproject(toMap(v!, f!, [clientX - r.left, clientY - r.top]))
              }}
              onChange={(ring) => edit.onChange(edit.rings.map((r, i) => (i === edit.selected ? ring : r)))}
              onChangeStart={edit.onChangeStart}
            />
          )}
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

      {popup && selected && (() => {
        // 救援點的位置；急救器材畫在挪開的位置（被擋住時）
        const at =
          selected.kind === 'rescue'
            ? located.find((p) => p.key === selected.key)?.at && screen(located.find((p) => p.key === selected.key)!.at)
            : (() => {
                const i = map.markers.findIndex((m) => m.kind === 'ems' && m.no === selected.no)
                return i < 0 ? undefined : (nudged.get(i) ?? screen(map.markers[i].at))
              })()
        if (!at || at[0] < 0 || at[1] < 0 || at[0] > frame.w || at[1] > frame.h) return null
        // 太靠近上緣時顯示在下方；左右不超出地圖
        const below = at[1] < POPUP_FLIP_PX
        const x = Math.min(Math.max(at[0], POPUP_HALF_PX), frame.w - POPUP_HALF_PX)
        return (
          <div className={`sm-popup${below ? ' below' : ''}`} style={{ left: x, top: at[1], ['--arrow-x' as string]: `${at[0] - x}px` }}>
            {popup}
          </div>
        )
      })()}

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

/** 編輯中那塊多邊形（或線段）的頂點（拖曳移動、右鍵刪除）與邊的中點（按下就多一個頂點，接著拖曳） */
function EditHandles({
  ring,
  closed,
  screen,
  toLatLng,
  onChange,
  onChangeStart,
}: {
  ring: LatLng[]
  closed: boolean
  screen: (q: LatLng) => Vec
  toLatLng: (clientX: number, clientY: number) => LatLng
  onChange: (ring: LatLng[]) => void
  onChangeStart?: () => void
}) {
  const [dragging, setDragging] = useState<number>()
  const latestRing = useRef(ring)
  latestRing.current = ring
  const startDrag = (e: React.PointerEvent, index: number, next: LatLng[]) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    onChangeStart?.()
    if (next !== ring) onChange(next)
    setDragging(index)
  }
  const move = (e: React.PointerEvent) => {
    if (dragging === undefined) return
    const at = toLatLng(e.clientX, e.clientY)
    onChange(latestRing.current.map((q, i) => (i === dragging ? at : q)))
  }
  const end = () => setDragging(undefined)
  const pts = ring.map(screen)
  return (
    <g className="sm-edit-handles">
      {pts.slice(0, closed ? pts.length : pts.length - 1).map((a, i) => {
        const b = pts[(i + 1) % pts.length]
        const mid: LatLng = [(ring[i][0] + ring[(i + 1) % ring.length][0]) / 2, (ring[i][1] + ring[(i + 1) % ring.length][1]) / 2]
        return (
          <circle
            key={`m${i}`}
            className="sm-handle sm-handle-mid"
            cx={(a[0] + b[0]) / 2}
            cy={(a[1] + b[1]) / 2}
            r={4}
            onPointerDown={(e) => startDrag(e, i + 1, [...ring.slice(0, i + 1), mid, ...ring.slice(i + 1)])}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        )
      })}
      {pts.map(([x, y], i) => (
        <circle
          key={`v${i}`}
          className={`sm-handle${dragging === i ? ' dragging' : ''}`}
          cx={x}
          cy={y}
          r={6}
          onPointerDown={(e) => e.button === 0 && startDrag(e, i, ring)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (ring.length <= (closed ? 3 : 2)) return
            onChangeStart?.()
            onChange(ring.filter((_, j) => j !== i))
          }}
        />
      ))}
    </g>
  )
}
