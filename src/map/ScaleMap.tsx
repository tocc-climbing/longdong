import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LatLng } from '../geo'
import { useLang } from '../i18n'
import { BOUNDS, CRAG_X, inBounds, located } from './bounds'
import { project, type Marker, type ScaleMapData } from './mapData'
import { MIN_SCALE, clampScale, clampView, dashLength, fitView, mapTransform, maxScale, rotateAt, toMap, toScreen, zoomAt, type MapView, type Size } from './mapView'
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
const PRIORITY: Record<Exclude<Marker['kind'], 'parking'>, number> = { ems: 0, hoist: 1, boat: 2, place: 3 }

const placeName = (m: Extract<Marker, { kind: 'place' }>, lang: string) => (lang === 'en' ? m.en : m.zh)

function markerBox(m: Marker, at: Vec, lang: string): Box {
  if (m.kind === 'place') return around(at, textWidth(placeName(m, lang), 11) / 2 + 2, 7)
  // 直升機圖釘的尖端在實際位置，圖示在上方
  if (m.kind === 'hoist') return around(at, 6.5, 10, -10)
  return around(at, 7.5, 7.5)
}

/**
 * 決定要畫哪些圖示與區域名稱（都在螢幕座標上算，旋轉後也正確）：
 * 救援點與停車場一定畫（救援時最重要；停車場是進出岩場的集合點）。停車場 P 的位置在產生地圖時就避開救援點，畫在救援點上面；
 * 其他依 PRIORITY、區域名稱依面積大小，和已畫的東西重疊就先不畫。
 */
function declutter(markers: Marker[], areas: ScaleMapData['areas'], names: Record<string, string>, screen: (p: Vec) => Vec, lang: string) {
  const occupied: Box[] = located.map(({ at }) => around(screen(at), 8, 8))
  const fits = (box: Box) => {
    if (occupied.some((o) => overlaps(box, o))) return false
    occupied.push(box)
    return true
  }
  const parking = markers.flatMap((m, i) => (m.kind === 'parking' ? [i] : []))
  for (const i of parking) occupied.push(markerBox(markers[i], screen(markers[i].at), lang))
  const shown = new Set([
    ...parking,
    ...markers
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.kind !== 'parking')
      .sort((a, b) => PRIORITY[a.m.kind as keyof typeof PRIORITY] - PRIORITY[b.m.kind as keyof typeof PRIORITY])
      .filter(({ m }) => fits(markerBox(m, screen(m.at), lang)))
      .map(({ i }) => i),
  ])
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
  /** 按「回到我的位置」：還沒定位時由外層開始定位，定位到之後地圖自動移過去；在範圍外時地圖不動，由外層說明。沒有時不顯示這個按鈕 */
  onLocate?: () => void
  /** 長按（電腦為按右鍵）區域時：大區域 key */
  onAreaPress?: (area: string) => void
  /** 左上角的按鈕（測試版說明、回報） */
  topLeft?: ReactNode
}

/**
 * 照比例尺的龍洞地圖：配色與救援資訊圖相同，操作像 Google 地圖：
 * 拖曳平移、雙指縮放與旋轉、滾輪縮放、雙擊放大；右上羅盤點一下回到北方朝上，右下回到我的位置。
 * 最多縮到範圍的上下填滿畫面，上下不露出範圍外的空白；一開始左右置中在岩場。
 * 第一次定位到、且在龍洞範圍內時，自動移到目前位置。
 * 陸地、區域、道路等圖形隨地圖旋轉；圖示與文字畫在螢幕座標上，旋轉後仍然朝上、維持固定大小。
 */
export function ScaleMap({ map, areaNames, here, marks, onLocate, onAreaPress, topLeft }: Props) {
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

  // 拖曳、縮放、旋轉、長按區域（useMapGestures）
  const gestures = useRef<MapGestures>(undefined!)
  gestures.current = {
    apply,
    areaAt: (p) => {
      const { frame: f, view: v } = latest.current
      if (!f || !v) return undefined
      const at = toMap(v, f, [p.x, p.y])
      return () => map.areas.find((a) => a.rings.some((r) => insideRing(at, r)))?.id
    },
    onAreaPress,
  }
  useMapGestures(box, gestures)

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
    // 在範圍外：移過去只會看到範圍邊緣的空白，地圖不動
    if (me) {
      if (inBounds(me)) goToMe(me)
    } else pendingCenter.current = true
    onLocate?.()
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
            // 停車場的 P 畫在救援點上面（見下方）
            if (m.kind === 'parking') return null
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
          {map.markers.map((m, i) => {
            if (m.kind !== 'parking') return null
            const [x, y] = screen(m.at)
            return (
              <text key={i} className="sm-parking" x={x} y={y} fontSize={12} textAnchor="middle" dominantBaseline="central">
                P
              </text>
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
