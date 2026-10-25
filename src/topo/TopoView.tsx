import { Fragment, useLayoutEffect, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { navigate } from '../router'
import { drawnRuns, spreadBadges } from './lines'
import { FULL_CROP, imageUrl, SCALE, type Crop, type Marks, type Point, type TopoPhoto } from './model'

/**
 * 照片＋疊在上面的 SVG。SVG 的座標是照片的像素，children 收到「一個螢幕像素等於幾個照片像素」（k），
 * 標籤、圓點依此換算，不論照片顯示多大，看起來都一樣大。
 * crop 只顯示照片的一塊；座標仍是整張照片的，裁切範圍外的標記留著、只是看不到。
 */
export function TopoFrame({
  photo,
  alt,
  crop,
  children,
  svgProps,
}: {
  photo: TopoPhoto
  alt: string
  crop?: Crop
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
  const c = crop ?? FULL_CROP
  const [cx, cy] = px(photo, [c.x, c.y])
  const [cw, ch] = px(photo, [c.w, c.h])
  const k = shown > 0 ? cw / shown : 1
  return (
    <div className="topo-frame" ref={box} style={{ aspectRatio: `${cw} / ${ch}` }}>
      <img
        src={imageUrl(photo.image)}
        alt={alt}
        loading="lazy"
        draggable={false}
        style={{ width: `${(SCALE / c.w) * 100}%`, height: `${(SCALE / c.h) * 100}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%` }}
      />
      <svg viewBox={`${cx} ${cy} ${cw} ${ch}`} {...svgProps}>
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
 * 起攀點與完攀點（線段最後一點）各標路線編號；兩條路線共用的線段只畫一次，同一點的編號橫向排開。
 */
export function TopoLines({
  photo,
  marks,
  labels,
  k,
  highlight,
  bolts = highlight ? [highlight] : [],
  link,
  onPick,
  crop,
}: {
  photo: TopoPhoto
  marks: Marks
  /** 路線 ID → 編號 */
  labels: Map<string, string>
  k: number
  highlight?: string
  bolts?: string[]
  link?: (id: string) => string
  /** 點線段時改為呼叫這個（不換頁）；優先於 link */
  onPick?: (id: string) => void
  crop?: Crop
}) {
  const c = crop ?? FULL_CROP
  const top = px(photo, [0, c.y])[1]
  const bottom = px(photo, [0, c.y + c.h])[1]
  // 亮色的畫在最上面
  const ids = Object.keys(marks).sort((a, b) => Number(a === highlight) - Number(b === highlight))
  // 共用線段歸亮色的路線，其次依編號：先處理的路線留住共用段
  const owners = ids
    .filter((id) => marks[id].line)
    .sort((a, b) => Number(b === highlight) - Number(a === highlight) || Number(labels.get(a)) - Number(labels.get(b)) || a.localeCompare(b))
  const runs = drawnRuns(owners.map((id) => [id, marks[id].line!.map((p) => px(photo, p))]))
  const startAt = (id: string) => marks[id].line?.[0] ?? lowestBoltPoint(marks[id].bolts)
  const badges = (at: (id: string) => Point | undefined) =>
    spreadBadges(ids.flatMap((id) => (labels.has(id) && at(id) ? [{ id, at: at(id)!, width: badgeWidth(labels.get(id)!) }] : [])))
  const startShift = badges(startAt)
  const endShift = badges((id) => marks[id].line?.at(-1))
  return (
    <>
      {ids.map((id) => {
        const m = marks[id]
        const line = m.line?.map((p) => px(photo, p))
        const start = line?.[0] ?? lowestBolt(photo, m.bolts)
        const end = line?.at(-1)
        const cls = `topo-route${id === highlight ? ' on' : highlight ? ' dim' : ''}`
        const body = (
          <>
            {(runs.get(id) ?? []).map((run, i) => {
              const points = run.map((p) => p.join(',')).join(' ')
              return (
                <Fragment key={i}>
                  <polyline className="topo-hit" points={points} strokeWidth={18 * k} />
                  <polyline className="topo-halo" points={points} strokeWidth={(id === highlight ? 7 : 5) * k} />
                  <polyline className="topo-line" points={points} strokeWidth={(id === highlight ? 4 : 2.5) * k} />
                </Fragment>
              )
            })}
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
            {start && labels.get(id) && <Badge x={start[0] + (startShift.get(id) ?? 0) * k} y={start[1]} k={k} text={labels.get(id)!} top={top} bottom={bottom} />}
            {end && labels.get(id) && <Badge x={end[0] + (endShift.get(id) ?? 0) * k} y={end[1]} k={k} text={labels.get(id)!} top={top} bottom={bottom} above />}
          </>
        )
        // SVG 的 <a> 的 href 不是字串，站內換頁攔不到（router.ts），改用點擊與 Enter 換頁
        const pick = onPick ?? (link && ((id: string) => navigate(link(id))))
        return pick ? (
          <g
            key={id}
            className={`${cls} link`}
            role={onPick ? 'button' : 'link'}
            tabIndex={0}
            aria-label={labels.get(id) ?? id}
            onClick={() => pick(id)}
            onKeyDown={(e) => e.key === 'Enter' && pick(id)}
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

/** 編號牌的寬度（螢幕像素） */
const badgeWidth = (text: string) => text.length * 7 + 10

/** 路線編號：起攀點放在點的下方，完攀點（above）放在上方；超出照片（裁切）範圍時換到另一側 */
function Badge({ x, y, k, text, top, bottom, above }: { x: number; y: number; k: number; text: string; top: number; bottom: number; above?: boolean }) {
  const w = badgeWidth(text) * k
  const h = 16 * k
  const below = y + 3 * k
  const over = y - 3 * k - h
  const fitsBelow = below + h <= bottom
  const fitsAbove = over >= top
  const at = above ? (fitsAbove || !fitsBelow ? over : below) : fitsBelow || !fitsAbove ? below : over
  return (
    <g className="topo-badge">
      <rect x={x - w / 2} y={at} width={w} height={h} rx={3 * k} />
      <text x={x} y={at + h / 2} fontSize={11.5 * k} dominantBaseline="central" textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

const lowestBoltPoint = (bolts: Record<string, Point> | undefined): Point | undefined => Object.values(bolts ?? {}).reduce<Point | undefined>((a, b) => (!a || b[1] > a[1] ? b : a), undefined)

/** 沒有線段時，編號放在最下面的 bolt */
function lowestBolt(photo: TopoPhoto, bolts: Record<string, Point> | undefined): [number, number] | undefined {
  const lowest = lowestBoltPoint(bolts)
  return lowest && px(photo, lowest)
}
