import { useLayoutEffect, useRef, useState } from 'react'
import { RESCUE_POINTS } from '../data/rescue'
import type { LatLng } from '../geo'
import { MIN_SCALE, clampScale, dashLength, clampView, fitView, maxScale, panBy, viewBox, zoomAt, type MapView, type Rect, type Size } from '../mapView'
import { project, type ScaleMapData } from '../scaleMap'
import { useLang } from '../i18n'

/** 比例尺的長度（公尺）：選畫面上不超過 90px 的最長一個 */
const SCALE_BARS = [10, 20, 50, 100, 200, 500]
/** 地圖範圍：所有救援點外加這個距離（公尺）；岩場在東邊海岸，右邊多留一些海面 */
const PADDING_M = { west: 80, east: 220, north: 80, south: 80 }
/** 按「＋」「－」、雙擊一次縮放的倍數 */
const STEP = 2
/** 「移到我的位置」至少放大到每像素幾公尺 */
const ME_SCALE = 0.5

const located = RESCUE_POINTS.filter((p) => p.coords).map((p) => ({ no: p.no, at: project(p.coords!) }))
const xs = located.map((p) => p.at[0])
const ys = located.map((p) => p.at[1])
const BOUNDS: Rect = {
  x: Math.min(...xs) - PADDING_M.west,
  y: Math.min(...ys) - PADDING_M.north,
  w: Math.max(...xs) - Math.min(...xs) + PADDING_M.west + PADDING_M.east,
  h: Math.max(...ys) - Math.min(...ys) + PADDING_M.north + PADDING_M.south,
}

const LABEL_PX = 12

type Box = [number, number, number, number]

/** 區域名稱放在最大一塊的重心；和救援點或已放的名稱重疊就不放（先放面積大的），放大後空間夠了才出現 */
function placeLabels(areas: ScaleMapData['areas'], names: Record<string, string>, px: number) {
  const placed: { id: string; text: string; at: [number, number]; box: Box }[] = []
  const pins: Box[] = located.map(({ at }) => [at[0] - 8 * px, at[1] - 8 * px, at[0] + 8 * px, at[1] + 8 * px])
  const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
  for (const a of [...areas].sort((x, y) => y.size - x.size)) {
    const text = names[a.id] ?? a.id
    const halfW = ((text.length * LABEL_PX) / 2 + 4) * px
    const halfH = (LABEL_PX / 2 + 2) * px
    const box: Box = [a.label[0] - halfW, a.label[1] - halfH, a.label[0] + halfW, a.label[1] + halfH]
    if (pins.some((b) => overlaps(box, b)) || placed.some((p) => overlaps(box, p.box))) continue
    placed.push({ id: a.id, text, at: a.label, box })
  }
  return placed
}

interface Props {
  map: ScaleMapData
  /** 大區域 key → 顯示名稱 */
  areaNames: Record<string, string>
  here?: { coords: LatLng; accuracy: number }
  marks: LatLng[]
  track: LatLng[]
}

type Point = { x: number; y: number }

/**
 * 照比例尺的龍洞簡圖：北方朝上，配色與救援資訊圖相同。
 * 像 Google 地圖一樣拖曳平移、雙指或滾輪縮放、雙擊放大，最小縮到整張圖；
 * 圓點、文字維持固定的螢幕大小，誤差圈是實際大小。
 */
export function ScaleMap({ map, areaNames, here, marks, track }: Props) {
  // 地名：英文用英文名，其他語言用中文名（漢字）
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
  /** 以框內一點（預設為中心）為準縮放到每像素 s 公尺 */
  const zoomTo = (s: number, at?: Point) =>
    apply((v, f) => zoomAt(v, f, at ?? { x: f.w / 2, y: f.h / 2 }, clampScale(s, BOUNDS, f)))

  // 框的大小只由版面決定（地圖填滿框，沒有捲軸），不會因為地圖本身改變而來回重算
  useLayoutEffect(() => {
    const el = box.current!
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      const f = { w: el.clientWidth, h: el.clientHeight }
      setFrame(f)
      setView((v) => clampView(v ?? fitView(BOUNDS, f), BOUNDS, f))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 拖曳平移、雙指縮放：記下每根手指的位置，每次移動和上一次比較
  useLayoutEffect(() => {
    const el = box.current!
    const pointers = new Map<number, Point>()
    const local = (e: MouseEvent): Point => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const pair = () => {
      const [a, b] = [...pointers.values()]
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) }
    }

    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, local(e))
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
        // 跟著兩指的中點平移，再以中點為準依兩指距離縮放
        apply((v, f) => zoomAt(panBy(v, after.mid.x - before.mid.x, after.mid.y - before.mid.y), f, after.mid, clampScale((v.s * before.dist) / after.dist, BOUNDS, f)))
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
  const VIEW = frame && view ? viewBox(view, frame) : BOUNDS
  /** 一個螢幕像素等於幾公尺：圓點、文字、線寬用它換算成固定的螢幕大小 */
  const px = view?.s ?? 1
  const atMax = !view || view.s <= MIN_SCALE * 1.0001
  const atMin = !view || !frame || view.s >= maxScale(BOUNDS, frame) * 0.9999

  const trailDash = dashLength(3, px)
  const tunnelDash = dashLength(6, px)
  const bar = SCALE_BARS.filter((m) => m / px <= 90).pop() ?? SCALE_BARS[0]
  const labels = placeLabels(map.areas, areaNames, px)
  const trackPath = track.length >= 2 ? 'M' + track.map((c) => project(c).join(' ')).join('L') : ''

  return (
    <div className="scale-map">
      <div className="scale-map-tools">
        <button type="button" className="action" onClick={() => view && zoomTo(view.s / STEP)} disabled={atMax} aria-label={t('rescue.zoomIn')}>
          ＋
        </button>
        <button type="button" className="action" onClick={() => view && zoomTo(view.s * STEP)} disabled={atMin} aria-label={t('rescue.zoomOut')}>
          －
        </button>
        <button
          type="button"
          className="action"
          onClick={() => me && apply((v) => ({ cx: me[0], cy: me[1], s: Math.min(v.s, ME_SCALE) }))}
          disabled={!me}
        >
          {t('cal.toMe')}
        </button>
      </div>
      <div className="scale-map-frame" ref={box}>
        <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} role="img" aria-label={t('cal.mapAria')}>
          <rect className="sm-sea" x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} />
          <path className="sm-land" d={map.layers.land} fillRule="evenodd" />
          <path className="sm-building" d={map.layers.building} />
          {map.areas.map((a) => (
            <path key={a.id} className={`sm-area sm-area-${a.id}`} d={a.path} strokeWidth={px} />
          ))}
          <path className="sm-highway" d={map.layers.highway} strokeWidth={5 * px} />
          <path className="sm-tunnel" d={map.layers.tunnel} strokeWidth={5 * px} strokeDasharray={`${tunnelDash / 3} ${tunnelDash}`} />
          <path className="sm-road" d={map.layers.road} strokeWidth={2.5 * px} />
          <path className="sm-trail" d={map.layers.trail} strokeWidth={2 * px} strokeDasharray={`${trailDash} ${trailDash}`} />
          {trackPath && <path className="sm-track" d={trackPath} strokeWidth={2.5 * px} />}

          <g fontSize={LABEL_PX * px}>
            {map.markers.map((m, i) =>
              m.kind === 'place' ? (
                <text key={i} className="sm-place" x={m.at[0]} y={m.at[1]} fontSize={11 * px} textAnchor="middle" dominantBaseline="central">
                  {lang === 'en' ? m.en : m.zh}
                </text>
              ) : m.kind === 'boat' ? (
                <g key={i} className="sm-boat">
                  <title>{t('cal.boat')}</title>
                  <circle cx={m.at[0]} cy={m.at[1]} r={6 * px} strokeWidth={px} />
                  <circle cx={m.at[0]} cy={m.at[1]} r={3.5 * px} strokeWidth={1.5 * px} />
                  <circle className="sm-boat-dot" cx={m.at[0]} cy={m.at[1]} r={1.6 * px} />
                </g>
              ) : m.kind === 'hoist' ? (
                <g key={i} className="sm-hoist">
                  <title>{t('cal.hoist')}</title>
                  {/* 圖釘：尖端在實際位置 */}
                  <path
                    d={`M${m.at[0]} ${m.at[1]}l${-5.5 * px} ${-9 * px}a${6.4 * px} ${6.4 * px} 0 1 1 ${11 * px} 0z`}
                  />
                  <text x={m.at[0]} y={m.at[1] - 12.5 * px} fontSize={8 * px} textAnchor="middle" dominantBaseline="central">
                    H
                  </text>
                </g>
              ) : m.kind === 'parking' ? (
                <g key={i} className="sm-parking">
                  <rect x={m.at[0] - 7 * px} y={m.at[1] - 7 * px} width={14 * px} height={14 * px} rx={3 * px} />
                  <text x={m.at[0]} y={m.at[1]} fontSize={10 * px} textAnchor="middle" dominantBaseline="central">
                    P
                  </text>
                </g>
              ) : (
                <g key={i} className="sm-ems">
                  <title>{t('cal.ems', { n: m.no })}</title>
                  <rect x={m.at[0] - 6 * px} y={m.at[1] - 7 * px} width={12 * px} height={14 * px} rx={4 * px} />
                  <path d={`M${m.at[0] - 3.5 * px} ${m.at[1]}h${7 * px}M${m.at[0]} ${m.at[1] - 3.5 * px}v${7 * px}`} strokeWidth={2 * px} />
                </g>
              ),
            )}
            {labels.map((l) => (
              <text key={l.id} className={`sm-label sm-label-${l.id}`} x={l.at[0]} y={l.at[1]} textAnchor="middle" dominantBaseline="central">
                {l.text}
              </text>
            ))}
            {located.map((p, i) => (
              <g key={i} className="sm-rescue">
                <circle cx={p.at[0]} cy={p.at[1]} r={7 * px} />
                <text x={p.at[0]} y={p.at[1]} fontSize={9 * px} textAnchor="middle" dominantBaseline="central">
                  {p.no}
                </text>
              </g>
            ))}
            {marks.map((c, i) => {
              const [x, y] = project(c)
              return (
                <g key={i} className="sm-mark">
                  <circle cx={x} cy={y} r={6 * px} />
                  <text x={x} y={y} fontSize={8 * px} textAnchor="middle" dominantBaseline="central">
                    {i + 1}
                  </text>
                </g>
              )
            })}
          </g>

          {me && here && (
            <g className="sm-me">
              <circle className="sm-me-accuracy" cx={me[0]} cy={me[1]} r={here.accuracy} />
              <circle cx={me[0]} cy={me[1]} r={6 * px} strokeWidth={2 * px} />
            </g>
          )}
        </svg>
      </div>
      <div className="scale-map-legend" aria-hidden>
        <span className="sm-bar" style={{ width: bar / px }} />
        {t('myloc.m', { n: bar })}
      </div>
    </div>
  )
}
