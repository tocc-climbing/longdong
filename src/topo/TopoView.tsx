import { useLayoutEffect, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { navigate } from '../router'
import type { Route } from '../data/schema'
import { centeredBox, pathLength, Placer, pointAlong, smoothPath, textWidth, type Box, type Pt } from './annotate'
import { drawnRuns } from './lines'
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
  const img = useRef<HTMLImageElement>(null)
  const [shown, setShown] = useState(0)
  // 照片載入完才淡入照片與標記（先出現線、後出現照片很怪）；載入失敗也顯示標記
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => setReady(!!img.current?.complete), [photo.image])
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
    <div className={`topo-frame${ready ? ' ready' : ''}`} ref={box} style={{ aspectRatio: `${cw} / ${ch}` }}>
      <img
        ref={img}
        onLoad={() => setReady(true)}
        onError={() => setReady(true)}
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

/** 一條路線標記時用到的說明：難度、名稱，各 bolt／anchor 的材質與年份 */
export interface RouteInfo {
  /** 線的顏色：運攀藍色，其他（傳攀、上方架繩、抱石、混合）紅色 */
  kind: 'sport' | 'other'
  grade?: string
  name?: string
  /** 位置（B01、A01）→ 「316-TW · 2007」 */
  bolts: Record<string, string>
}

/** 材質代號（316-TW、Ti-U…）才顯示；「共用」「待查」之類的特殊值不顯示 */
const isMaterialCode = (m: string) => /^[A-Za-z0-9-]+$/.test(m)

export function routeInfo(routes: Route[], nameOf: (r: Route) => string): Map<string, RouteInfo> {
  return new Map(
    routes.map((r) => [
      r.id,
      {
        kind: r.type === 'sport' ? 'sport' : 'other',
        grade: r.grade || undefined,
        name: nameOf(r),
        bolts: Object.fromEntries([...r.bolts, ...r.anchors].map((b) => [b.position, [isMaterialCode(b.material) ? b.material : '', b.installed].filter(Boolean).join(' · ')])),
      },
    ]),
  )
}

/** 牌子的大小與字級（螢幕像素） */
const PILL_H_BASE = 20
const PILL_FONT_BASE = 11.5
const BOLT_H_BASE = 18
const BOLT_FONT_BASE = 11
const NOTE_FONT_BASE = 10
const NOTE_LINE_BASE = 12.5
/** 電腦版（寬螢幕）螢幕大、離得遠，牌子與字放大一點；手機維持原樣 */
const uiScale = () => (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches ? 1.5 : 1)
/** 線在畫面上至少這麼長（螢幕像素）才標編號；選到的路線不受限 */
const MIN_LABEL_LINE_PX = 40
/** 線在畫面上這麼長才多顯示難度、再長才多顯示名稱；選到的路線一律顯示 */
const GRADE_LINE_PX = 110
const NAME_LINE_PX = 240
/** 編號牌放在線上的候選位置（占全長的比例）：先放正中間，不行再往兩邊找 */
const LABEL_SPOTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]

interface Plan {
  pill?: Box
  note?: { box: Box; lines: string[] }
  bolts: { pos: string; at: Pt; anchor: boolean; label: string; pill: Box; note?: { box: Box; text: string } }[]
}

/**
 * 路線線段、編號與 bolt。標記只要幾個點：曲線、編號牌、說明依畫面上的大小自動排——
 * 線畫成平滑的曲線，編號牌放在線上空的地方（縮小時重疊的先藏起來，選到的路線優先），
 * 放大、空間夠了才多顯示難度、名稱、bolt 的材質與年份。
 * highlight 的路線用亮色、其他變淡；bolts 決定畫哪些路線的 bolt 與 anchor（預設只畫 highlight 的）；
 * 有 link 時點線段換到那條路線。兩條路線共用的線段只畫一次。
 */
export function TopoLines({
  photo,
  marks,
  labels,
  k,
  highlight,
  bolts = highlight ? [highlight] : [],
  info,
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
  /** 路線 ID → 難度、名稱、bolt 材質；沒有時只標編號與 bolt 位置 */
  info?: Map<string, RouteInfo>
  link?: (id: string) => string
  /** 點線段時改為呼叫這個（不換頁）；優先於 link */
  onPick?: (id: string) => void
  crop?: Crop
}) {
  const c = crop ?? FULL_CROP
  const u = uiScale()
  const [PILL_H, PILL_FONT, BOLT_H, BOLT_FONT, NOTE_FONT, NOTE_LINE] = [PILL_H_BASE, PILL_FONT_BASE, BOLT_H_BASE, BOLT_FONT_BASE, NOTE_FONT_BASE, NOTE_LINE_BASE].map((v) => v * u)
  const [bx, by] = px(photo, [c.x, c.y])
  const [bw, bh] = px(photo, [c.w, c.h])
  // 亮色的畫在最上面
  const ids = Object.keys(marks).sort((a, b) => Number(a === highlight) - Number(b === highlight))
  // 先放的優先：選到的路線，其次依編號
  const priority = [...ids].sort((a, b) => Number(b === highlight) - Number(a === highlight) || Number(labels.get(a)) - Number(labels.get(b)) || a.localeCompare(b))
  const runs = drawnRuns(priority.filter((id) => marks[id].line).map((id) => [id, marks[id].line!.map((p) => px(photo, p))]))
  const lineOf = (id: string): Pt[] | undefined => marks[id].line?.map((p) => px(photo, p) as Pt)

  // ── 自動排版：依優先順序放牌子，放不下的藏起來 ──
  const placer = new Placer({ x: bx, y: by, w: bw, h: bh }, 3 * k)
  const plan = new Map<string, Plan>(priority.map((id) => [id, { bolts: [] }]))
  const length = new Map(priority.map((id) => [id, (lineOf(id) ? pathLength(lineOf(id)!) : 0) / k]))
  // 1. 路線編號牌
  for (const id of priority) {
    const text = labels.get(id)
    if (!text) continue
    const line = lineOf(id)
    const w = (textWidth(text, PILL_FONT) + 14) * k
    const h = PILL_H * k
    let spots: Box[]
    if (line && line.length >= 2) {
      if (id !== highlight && length.get(id)! < MIN_LABEL_LINE_PX) continue
      spots = LABEL_SPOTS.map((f) => centeredBox(pointAlong(line, f), w, h))
    } else {
      // 沒有線段：標在最下面的 bolt 旁邊
      const low = lowestBolt(photo, marks[id].bolts)
      if (!low) continue
      spots = [centeredBox([low[0], low[1] + h], w, h), centeredBox([low[0], low[1] - h], w, h)]
    }
    plan.get(id)!.pill = placer.place(spots, id === highlight)
  }
  // 2. bolt、anchor 的牌子
  for (const id of priority) {
    if (!bolts.includes(id)) continue
    for (const [pos, p] of Object.entries(marks[id].bolts ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const anchor = pos.startsWith('A')
      const label = anchor ? '××' : `× ${pos}`
      const at = px(photo, p) as Pt
      const pill = placer.place([centeredBox(at, (textWidth(label, BOLT_FONT) + 12) * k, BOLT_H * k)])
      if (pill) plan.get(id)!.bolts.push({ pos, at, anchor, label, pill })
    }
  }
  // 3. 多的說明：編號牌下面的難度與名稱、bolt 旁邊的材質與年份（空間夠才顯示）
  for (const id of priority) {
    const entry = plan.get(id)!
    const i = info?.get(id)
    if (entry.pill && i) {
      const len = length.get(id)!
      const lines = [id === highlight || len >= GRADE_LINE_PX ? i.grade : undefined, id === highlight || len >= NAME_LINE_PX ? i.name : undefined].filter((x): x is string => !!x)
      for (const shown of [lines, lines.slice(0, 1)]) {
        if (shown.length === 0) break
        const w = Math.max(...shown.map((t) => textWidth(t, NOTE_FONT))) * k
        const h = shown.length * NOTE_LINE * k
        const cx = entry.pill.x + entry.pill.w / 2
        const box = placer.place([
          { x: cx - w / 2, y: entry.pill.y + entry.pill.h + 4 * k, w, h },
          { x: cx - w / 2, y: entry.pill.y - h - 4 * k, w, h },
        ])
        if (box) {
          entry.note = { box, lines: shown }
          break
        }
      }
    }
    for (const b of entry.bolts) {
      const text = i?.bolts[b.pos]
      if (!text) continue
      const w = textWidth(text, NOTE_FONT) * k
      const h = NOTE_LINE * k
      const y = b.at[1] - h / 2
      const box = placer.place([
        { x: b.pill.x + b.pill.w + 4 * k, y, w, h },
        { x: b.pill.x - w - 4 * k, y, w, h },
      ])
      if (box) b.note = { box, text }
    }
  }

  return (
    <>
      {ids.map((id) => {
        const line = lineOf(id)
        const start = line?.[0]
        const p = plan.get(id)!
        const on = id === highlight
        // 沒有路線資料（kind 不明）時用紅色
        const cls = `topo-route kind-${info?.get(id)?.kind ?? 'other'}${on ? ' on' : highlight ? ' dim' : ''}`
        const body = (
          <>
            {(runs.get(id) ?? []).map((run, i) => {
              const d = smoothPath(run as Pt[])
              return (
                <g key={i}>
                  <path className="topo-hit" d={d} strokeWidth={18 * k} />
                  <path className="topo-halo" d={d} strokeWidth={(on ? 7 : 5.5) * k} />
                  <path className="topo-line" d={d} strokeWidth={(on ? 4 : 2.8) * k} />
                </g>
              )
            })}
            {start && <circle className="topo-start" cx={start[0]} cy={start[1]} r={(on ? 5.5 : 4.5) * k} strokeWidth={1.5 * k} />}
            {p.bolts.map((b) => (
              <g key={b.pos} className={`topo-bolt${b.anchor ? ' anchor' : ''}`}>
                <rect x={b.pill.x} y={b.pill.y} width={b.pill.w} height={b.pill.h} rx={b.pill.h / 2} />
                <text x={b.pill.x + b.pill.w / 2} y={b.pill.y + b.pill.h / 2} fontSize={BOLT_FONT * k} dominantBaseline="central" textAnchor="middle">
                  {b.label}
                </text>
                {b.note && (
                  <text className="topo-note" x={b.note.box.x} y={b.note.box.y + b.note.box.h / 2} fontSize={NOTE_FONT * k} strokeWidth={2.5 * k} dominantBaseline="central">
                    {b.note.text}
                  </text>
                )}
              </g>
            ))}
            {p.pill && labels.get(id) && (
              <g className="topo-badge">
                <rect x={p.pill.x} y={p.pill.y} width={p.pill.w} height={p.pill.h} rx={p.pill.h / 2} strokeWidth={1.5 * k} />
                <text x={p.pill.x + p.pill.w / 2} y={p.pill.y + p.pill.h / 2} fontSize={PILL_FONT * k} dominantBaseline="central" textAnchor="middle">
                  {labels.get(id)}
                </text>
              </g>
            )}
            {p.note && (
              <text className="topo-note" textAnchor="middle" fontSize={NOTE_FONT * k} strokeWidth={2.5 * k}>
                {p.note.lines.map((t, i) => (
                  <tspan key={i} x={p.note!.box.x + p.note!.box.w / 2} y={p.note!.box.y + (i + 0.5) * NOTE_LINE * k} dominantBaseline="central">
                    {t}
                  </tspan>
                ))}
              </text>
            )}
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

/** 沒有線段時，編號標在最下面的 bolt 旁邊 */
function lowestBolt(photo: TopoPhoto, bolts: Record<string, Point> | undefined): [number, number] | undefined {
  const lowest = Object.values(bolts ?? {}).reduce<Point | undefined>((a, b) => (!a || b[1] > a[1] ? b : a), undefined)
  return lowest && px(photo, lowest)
}
