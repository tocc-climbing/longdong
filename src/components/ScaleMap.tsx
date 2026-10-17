import { useLayoutEffect, useRef, useState } from 'react'
import { RESCUE_POINTS } from '../data/rescue'
import type { LatLng } from '../geo'
import { project, type ScaleMapData } from '../scaleMap'

const ZOOMS = [1, 2, 4, 8]
/** 比例尺的長度（公尺）：選畫面上不超過 90px 的最長一個 */
const SCALE_BARS = [10, 20, 50, 100, 200]
/** 地圖範圍：所有救援點外加這個距離（公尺） */
const PADDING_M = 80

const located = RESCUE_POINTS.filter((p) => p.coords).map((p) => ({ no: p.no, at: project(p.coords!) }))
const xs = located.map((p) => p.at[0])
const ys = located.map((p) => p.at[1])
const VIEW = {
  x: Math.min(...xs) - PADDING_M,
  y: Math.min(...ys) - PADDING_M,
  w: Math.max(...xs) - Math.min(...xs) + 2 * PADDING_M,
  h: Math.max(...ys) - Math.min(...ys) + 2 * PADDING_M,
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

/**
 * 照比例尺的龍洞簡圖：北方朝上，可放大後捲動；圓點、文字維持固定的螢幕大小，誤差圈是實際大小。
 */
export function ScaleMap({ map, areaNames, here, marks, track }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(360)
  const pending = useRef<[number, number]>(undefined)

  useLayoutEffect(() => {
    const el = box.current!
    // 還沒排版（寬度 0）時不更新，避免換算出無限大
    const observer = new ResizeObserver(() => el.clientWidth > 0 && setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 縮放後把記下的點捲到畫面中央
  useLayoutEffect(() => {
    const el = box.current!
    if (!pending.current) return
    const [fx, fy] = pending.current
    pending.current = undefined
    el.scrollTo({ left: fx * el.scrollWidth - el.clientWidth / 2, top: fy * el.scrollHeight - el.clientHeight / 2 })
  }, [zoom])

  /** 一個螢幕像素等於幾公尺：圓點、文字、線寬用它換算成固定的螢幕大小 */
  const px = VIEW.w / (width * zoom)

  const centerOn = (at: [number, number], nextZoom = zoom) => {
    pending.current = [(at[0] - VIEW.x) / VIEW.w, (at[1] - VIEW.y) / VIEW.h]
    if (nextZoom === zoom) {
      const el = box.current!
      const [fx, fy] = pending.current
      pending.current = undefined
      el.scrollTo({ left: fx * el.scrollWidth - el.clientWidth / 2, top: fy * el.scrollHeight - el.clientHeight / 2, behavior: 'smooth' })
    } else setZoom(nextZoom)
  }

  /** 以目前畫面中央為準縮放 */
  const zoomBy = (step: 1 | -1) => {
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(zoom) + step))]
    const el = box.current!
    const fx = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth
    const fy = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight
    centerOn([VIEW.x + fx * VIEW.w, VIEW.y + fy * VIEW.h], next)
  }

  const bar = SCALE_BARS.filter((m) => m / px <= 90).pop() ?? SCALE_BARS[0]
  const labels = placeLabels(map.areas, areaNames, px)
  const me = here && project(here.coords)
  const trackPath = track.length >= 2 ? 'M' + track.map((c) => project(c).join(' ')).join('L') : ''

  return (
    <div className="scale-map">
      <div className="scale-map-tools">
        <button type="button" className="action" onClick={() => zoomBy(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label="放大">
          ＋
        </button>
        <button type="button" className="action" onClick={() => zoomBy(-1)} disabled={zoom === ZOOMS[0]} aria-label="縮小">
          －
        </button>
        <button type="button" className="action" onClick={() => me && centerOn(me, Math.max(zoom, 4))} disabled={!me}>
          移到我的位置
        </button>
      </div>
      <div className="scale-map-frame" ref={box}>
        <svg
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
          style={{ width: `${zoom * 100}%` }}
          role="img"
          aria-label="龍洞岩場比例尺簡圖"
        >
          <rect className="sm-sea" x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} />
          <path className="sm-land" d={map.layers.land} fillRule="evenodd" />
          <path className="sm-building" d={map.layers.building} />
          {map.areas.map((a) => (
            <path key={a.id} className={`sm-area sm-area-${a.id}`} d={a.path} strokeWidth={px} />
          ))}
          <path className="sm-highway" d={map.layers.highway} strokeWidth={4 * px} />
          <path className="sm-tunnel" d={map.layers.tunnel} strokeWidth={3 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
          <path className="sm-road" d={map.layers.road} strokeWidth={2.5 * px} />
          <path className="sm-trail" d={map.layers.trail} strokeWidth={1.5 * px} strokeDasharray={`${4 * px} ${3 * px}`} />
          {trackPath && <path className="sm-track" d={trackPath} strokeWidth={2.5 * px} />}

          <g fontSize={LABEL_PX * px}>
            {labels.map((l) => (
              <text key={l.id} className="sm-label" x={l.at[0]} y={l.at[1]} textAnchor="middle" dominantBaseline="central">
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
        {bar} 公尺 · 北方朝上
      </div>
    </div>
  )
}
