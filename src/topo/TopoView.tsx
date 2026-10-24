import { useLayoutEffect, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { navigate } from '../router'
import { imageUrl, SCALE, type Marks, type Point, type TopoPhoto } from './model'

/**
 * 照片＋疊在上面的 SVG。SVG 的座標是照片的像素，children 收到「一個螢幕像素等於幾個照片像素」（k），
 * 標籤、圓點依此換算，不論照片顯示多大，看起來都一樣大。
 */
export function TopoFrame({
  photo,
  alt,
  children,
  svgProps,
}: {
  photo: TopoPhoto
  alt: string
  children: (k: number) => ReactNode
  svgProps?: SVGProps<SVGSVGElement>
}) {
  const box = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setShown(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const k = shown > 0 ? photo.width / shown : 1
  return (
    <div className="topo-frame" ref={box} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
      <img src={imageUrl(photo.image)} alt={alt} loading="lazy" draggable={false} />
      <svg viewBox={`0 0 ${photo.width} ${photo.height}`} {...svgProps}>
        {children(k)}
      </svg>
    </div>
  )
}

/** 萬分比換成照片像素 */
export function px(photo: TopoPhoto, [x, y]: Point): [number, number] {
  return [(x * photo.width) / SCALE, (y * photo.height) / SCALE]
}

/**
 * 路線線段、編號與 bolt。highlight 的路線用亮色、其他變淡；
 * bolts 決定畫哪些路線的 bolt（預設只畫 highlight 的）；有 link 時點線段換到那條路線。
 */
export function TopoLines({
  photo,
  marks,
  labels,
  k,
  highlight,
  bolts = highlight ? [highlight] : [],
  link,
}: {
  photo: TopoPhoto
  marks: Marks
  /** 路線 ID → 編號 */
  labels: Map<string, string>
  k: number
  highlight?: string
  bolts?: string[]
  link?: (id: string) => string
}) {
  // 亮色的畫在最上面
  const ids = Object.keys(marks).sort((a, b) => Number(a === highlight) - Number(b === highlight))
  return (
    <>
      {ids.map((id) => {
        const m = marks[id]
        const line = m.line?.map((p) => px(photo, p))
        const start = line?.[0] ?? lowestBolt(photo, m.bolts)
        const cls = `topo-route${id === highlight ? ' on' : highlight ? ' dim' : ''}`
        const points = line?.map((p) => p.join(',')).join(' ')
        const body = (
          <>
            {points && (
              <>
                <polyline className="topo-hit" points={points} strokeWidth={18 * k} />
                <polyline className="topo-halo" points={points} strokeWidth={(id === highlight ? 7 : 5) * k} />
                <polyline className="topo-line" points={points} strokeWidth={(id === highlight ? 4 : 2.5) * k} />
              </>
            )}
            {bolts.includes(id) &&
              Object.entries(m.bolts ?? {}).map(([pos, p]) => {
                const [x, y] = px(photo, p)
                return (
                  <g key={pos} className="topo-bolt">
                    <circle cx={x} cy={y} r={5 * k} strokeWidth={2 * k} />
                    <text x={x + 8 * k} y={y + 4 * k} fontSize={11 * k} strokeWidth={3 * k}>
                      {pos}
                    </text>
                  </g>
                )
              })}
            {start && labels.get(id) && <Badge x={start[0]} y={start[1]} k={k} text={labels.get(id)!} bottom={photo.height} />}
          </>
        )
        // SVG 的 <a> 的 href 不是字串，站內換頁攔不到（router.ts），改用點擊與 Enter 換頁
        return link ? (
          <g
            key={id}
            className={`${cls} link`}
            role="link"
            tabIndex={0}
            aria-label={labels.get(id) ?? id}
            onClick={() => navigate(link(id))}
            onKeyDown={(e) => e.key === 'Enter' && navigate(link(id))}
          >
            {body}
          </g>
        ) : (
          <g key={id} className={cls}>
            {body}
          </g>
        )
      })}
    </>
  )
}

/** 起攀點下方的路線編號；超出照片下緣時放在上方 */
function Badge({ x, y, k, text, bottom }: { x: number; y: number; k: number; text: string; bottom: number }) {
  const w = (text.length * 7 + 10) * k
  const h = 16 * k
  const top = y + 3 * k + h <= bottom ? y + 3 * k : y - 3 * k - h
  return (
    <g className="topo-badge">
      <rect x={x - w / 2} y={top} width={w} height={h} rx={3 * k} />
      <text x={x} y={top + h / 2} fontSize={11.5 * k} dominantBaseline="central" textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

/** 沒有線段時，編號放在最下面的 bolt */
function lowestBolt(photo: TopoPhoto, bolts: Record<string, Point> | undefined): [number, number] | undefined {
  const list = Object.values(bolts ?? {})
  if (list.length === 0) return undefined
  return px(photo, list.reduce((a, b) => (b[1] > a[1] ? b : a)))
}
