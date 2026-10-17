import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { RESCUE_POINTS } from '../data/rescue'
import type { LatLng } from '../geo'
import {
  MIN_SCALE,
  clampScale,
  clampView,
  dashLength,
  fitView,
  mapTransform,
  maxScale,
  panBy,
  rotateAt,
  toScreen,
  zoomAt,
  type MapView,
  type Rect,
  type Size,
} from '../mapView'
import { project, type Marker, type ScaleMapData } from '../scaleMap'
import { useLang } from '../i18n'

/** 比例尺的長度（公尺）：選畫面上不超過 SCALE_BAR_PX 的最長一個 */
const SCALE_BARS = [10, 20, 50, 100, 200, 500]
/** 比例尺最長幾個像素 */
const SCALE_BAR_PX = 60
/** 地圖範圍：所有救援點外加這個距離（公尺）；岩場在東邊海岸，右邊多留一些海面 */
const PADDING_M = { west: 80, east: 220, north: 80, south: 40 }
/** 按「＋」「－」、雙擊一次縮放的倍數 */
const STEP = 2
/** 回到我的位置時至少放大到每像素幾公尺 */
const ME_SCALE = 0.5
/** 雙指轉動超過這個角度才開始旋轉（弧度），只想縮放時地圖不會跟著歪 */
const ROTATE_START = 0.15

const located = RESCUE_POINTS.filter((p) => p.coords).map((p) => ({ no: p.no, at: project(p.coords!) }))
const xs = located.map((p) => p.at[0])
const ys = located.map((p) => p.at[1])
export const BOUNDS: Rect = {
  x: Math.min(...xs) - PADDING_M.west,
  y: Math.min(...ys) - PADDING_M.north,
  w: Math.max(...xs) - Math.min(...xs) + PADDING_M.west + PADDING_M.east,
  h: Math.max(...ys) - Math.min(...ys) + PADDING_M.north + PADDING_M.south,
}
/** 縮到最小時左右的中心：岩場（校門口到後門的救援點） */
const CRAG_X = (() => {
  const crag = located.filter((p) => p.no >= 3 && p.no <= 13).map((p) => p.at[0])
  return (Math.min(...crag) + Math.max(...crag)) / 2
})()
const inBounds = ([x, y]: [number, number]) => x >= BOUNDS.x && x <= BOUNDS.x + BOUNDS.w && y >= BOUNDS.y && y <= BOUNDS.y + BOUNDS.h

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

/** 圖示越前面越重要：重疊時先畫重要的，其他的等放大後空間夠了才出現 */
const PRIORITY: Record<Marker['kind'], number> = { ems: 0, hoist: 1, parking: 2, boat: 3, place: 4 }

const placeName = (m: Extract<Marker, { kind: 'place' }>, lang: string) => (lang === 'en' ? m.en : m.zh)

function markerBox(m: Marker, at: Vec, lang: string): Box {
  if (m.kind === 'place') return around(at, textWidth(placeName(m, lang), 11) / 2 + 2, 7)
  // 直升機圖釘的尖端在實際位置，圖示在上方
  if (m.kind === 'hoist') return around(at, 6.5, 10, -10)
  return around(at, 7.5, 7.5)
}

/**
 * 決定要畫哪些圖示與區域名稱（都在螢幕座標上算，旋轉後也正確）：救援點一定畫（救援時最重要），
 * 其他依 PRIORITY、區域名稱依面積大小，和已畫的東西重疊就先不畫。
 */
function declutter(markers: Marker[], areas: ScaleMapData['areas'], names: Record<string, string>, screen: (p: Vec) => Vec, lang: string) {
  const occupied: Box[] = located.map(({ at }) => around(screen(at), 8, 8))
  const fits = (box: Box) => {
    if (occupied.some((o) => overlaps(box, o))) return false
    occupied.push(box)
    return true
  }
  const shown = new Set(
    markers
      .map((m, i) => ({ m, i }))
      .sort((a, b) => PRIORITY[a.m.kind] - PRIORITY[b.m.kind])
      .filter(({ m }) => fits(markerBox(m, screen(m.at), lang)))
      .map(({ i }) => i),
  )
  const labels = [...areas]
    .sort((x, y) => y.size - x.size)
    .map((a) => ({ id: a.id, text: names[a.id] ?? a.id, at: screen(a.label) }))
    .filter((l) => fits(around(l.at, textWidth(l.text, LABEL_PX) / 2 + 4, LABEL_PX / 2 + 2)))
  return { shown, labels }
}

interface Props {
  map: ScaleMapData
  /** 大區域 key → 顯示名稱 */
  areaNames: Record<string, string>
  here?: { coords: LatLng; accuracy: number }
  marks: LatLng[]
  /** 按「回到我的位置」：還沒定位時由外層開始定位，定位到之後地圖自動移過去 */
  onLocate: () => void
  /** 左上角的按鈕（測試版說明、回報） */
  topLeft?: ReactNode
}

type Point = { x: number; y: number }

/**
 * 照比例尺的龍洞地圖：配色與救援資訊圖相同，操作像 Google 地圖：
 * 拖曳平移、雙指縮放與旋轉、滾輪縮放、雙擊放大；右上羅盤點一下回到北方朝上，右下回到我的位置。
 * 最多縮到範圍的上下填滿畫面，上下不露出範圍外的空白；一開始左右置中在岩場。
 * 第一次定位到、且在龍洞範圍內時，自動移到目前位置。
 * 陸地、區域、道路等圖形隨地圖旋轉；圖示與文字畫在螢幕座標上，旋轉後仍然朝上、維持固定大小。
 */
export function ScaleMap({ map, areaNames, here, marks, onLocate, topLeft }: Props) {
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
      setView((v) => clampView(v ?? fitView(BOUNDS, f, CRAG_X), BOUNDS, f))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 拖曳平移；雙指縮放與旋轉：記下每根手指的位置，每次移動和上一次比較
  useLayoutEffect(() => {
    const el = box.current!
    const pointers = new Map<number, Point>()
    /** 這次雙指操作累積轉了多少；超過 ROTATE_START 才開始旋轉 */
    let twist = 0
    let rotating = false
    const local = (e: MouseEvent): Point => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const pair = () => {
      const [a, b] = [...pointers.values()]
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }

    const down = (e: PointerEvent) => {
      // 地圖上的按鈕照常點擊
      if ((e.target as Element).closest('button, a')) return
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, local(e))
      twist = 0
      rotating = false
    }
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      if (pointers.size === 1) {
        const p = local(e)
        pointers.set(e.pointerId, p)
        apply((v) => panBy(v, p.x - prev.x, p.y - prev.y))
      } else if (pointers.size === 2) {
        const before = pair()
        pointers.set(e.pointerId, local(e))
        const after = pair()
        if (before.dist === 0 || after.dist === 0) return
        // 角度差換到 -π～π，避免跨過 ±180 度時跳一圈
        const turn = Math.atan2(Math.sin(after.angle - before.angle), Math.cos(after.angle - before.angle))
        twist += turn
        if (!rotating && Math.abs(twist) > ROTATE_START) rotating = true
        // 跟著兩指的中點平移，再以中點為準縮放、旋轉
        apply((v, f) => {
          const moved = panBy(v, after.mid.x - before.mid.x, after.mid.y - before.mid.y)
          const zoomed = zoomAt(moved, f, after.mid, clampScale((v.s * before.dist) / after.dist, BOUNDS, f))
          return rotating ? rotateAt(zoomed, f, after.mid, zoomed.r + turn) : zoomed
        })
      }
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const at = local(e)
      apply((v, f) => zoomAt(v, f, at, clampScale(v.s * Math.exp(e.deltaY * 0.002), BOUNDS, f)))
    }
    const dblclick = (e: MouseEvent) => {
      if ((e.target as Element).closest('button, a')) return
      const at = local(e)
      apply((v, f) => zoomAt(v, f, at, clampScale(v.s / STEP, BOUNDS, f)))
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('dblclick', dblclick)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('dblclick', dblclick)
    }
    // apply 只透過 latest 讀狀態，註冊一次即可
  }, [])

  const me = here && project(here.coords)

  // 移到目前位置：第一次定位到（在龍洞範圍內）時自動移過去；按了「回到我的位置」但還沒定位時，定位到再移過去
  const pendingCenter = useRef(true)
  const goToMe = (at: Vec) => {
    pendingCenter.current = false
    apply((v) => ({ ...v, cx: at[0], cy: at[1], s: Math.min(v.s, ME_SCALE) }))
  }
  useEffect(() => {
    if (pendingCenter.current && me && view && inBounds(me)) goToMe(me)
  }, [me?.[0], me?.[1], !!view])

  const locate = () => {
    if (me) goToMe(me)
    else pendingCenter.current = true
    onLocate()
  }

  if (!frame || !view) {
    return <div className="scale-map-frame" ref={box} />
  }

  const screen = (p: Vec) => toScreen(view, frame, p)
  /** 一個螢幕像素等於幾公尺：地圖圖形的線寬、虛線用它換算成固定的螢幕大小 */
  const px = view.s
  const atMax = view.s <= MIN_SCALE * 1.0001
  const atMin = view.s >= maxScale(BOUNDS, frame) * 0.9999
  const north = (view.r * 180) / Math.PI

  const trailDash = dashLength(3, px)
  const tunnelDash = dashLength(6, px)
  const bar = SCALE_BARS.filter((m) => m / px <= SCALE_BAR_PX).pop() ?? SCALE_BARS[0]
  const { shown, labels } = declutter(map.markers, map.areas, areaNames, screen, lang)
  // 圓的半徑大於畫面對角線時，海面用大矩形蓋滿（旋轉後四角也不會露白）
  const cover = Math.hypot(frame.w, frame.h) * px

  return (
    <div className="scale-map-frame" ref={box}>
      <svg width={frame.w} height={frame.h} role="img" aria-label={t('map.mapAria')}>
        <g transform={mapTransform(view, frame)}>
          <rect className="sm-sea" x={view.cx - cover} y={view.cy - cover} width={cover * 2} height={cover * 2} />
          <path className="sm-land" d={map.layers.land} fillRule="evenodd" />
          <path className="sm-building" d={map.layers.building} />
          {map.areas.map((a) => (
            <path key={a.id} className={`sm-area sm-area-${a.id}`} d={a.path} strokeWidth={px} />
          ))}
          <path className="sm-highway" d={map.layers.highway} strokeWidth={5 * px} />
          <path className="sm-tunnel" d={map.layers.tunnel} strokeWidth={5 * px} strokeDasharray={`${tunnelDash / 3} ${tunnelDash}`} />
          <path className="sm-road" d={map.layers.road} strokeWidth={2.5 * px} />
          <path className="sm-trail" d={map.layers.trail} strokeWidth={2 * px} strokeDasharray={`${trailDash} ${trailDash}`} />
          {me && here && <circle className="sm-me-accuracy" cx={me[0]} cy={me[1]} r={here.accuracy} />}
        </g>

        <g fontSize={LABEL_PX}>
          {map.markers.map((m, i) => {
            if (!shown.has(i)) return null
            const [x, y] = screen(m.at)
            if (m.kind === 'place')
              return (
                <text key={i} className="sm-place" x={x} y={y} fontSize={11} textAnchor="middle" dominantBaseline="central">
                  {placeName(m, lang)}
                </text>
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
            if (m.kind === 'parking')
              return (
                <g key={i} className="sm-parking">
                  <rect x={x - 7} y={y - 7} width={14} height={14} rx={3} />
                  <text x={x} y={y} fontSize={10} textAnchor="middle" dominantBaseline="central">
                    P
                  </text>
                </g>
              )
            return (
              <g key={i} className="sm-ems">
                <title>{t('map.ems', { n: m.no })}</title>
                <rect x={x - 6} y={y - 7} width={12} height={14} rx={4} />
                <path d={`M${x - 3.5} ${y}h7M${x} ${y - 3.5}v7`} strokeWidth={2} />
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
            return (
              <g key={i} className="sm-rescue">
                <circle cx={x} cy={y} r={7} />
                <text x={x} y={y} fontSize={9} textAnchor="middle" dominantBaseline="central">
                  {p.no}
                </text>
              </g>
            )
          })}
          {marks.map((c, i) => {
            const [x, y] = screen(project(c))
            return <circle key={i} className="sm-mark" cx={x} cy={y} r={5} />
          })}
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
        <button type="button" className={`sm-control sm-locate${me ? ' on' : ''}`} onClick={locate} aria-label={t('map.locate')} title={t('map.locate')}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>


      {/* 圖形來自 TOCC 救援資訊圖；道路與海岸以 OpenStreetMap 校正（ODbL 要求在地圖上標示） */}
      <p className="sm-attribution">
        © TOCC ·{' '}
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
