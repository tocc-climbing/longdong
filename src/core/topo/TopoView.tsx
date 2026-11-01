import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { centeredBox, distanceToLine, overlaps, pathLength, Placer, pointAlong, smoothPath, textWidth, wrapText, type Box, type Pt } from './annotate'
import { drawnRuns, ownRuns } from './lines'
import { FULL_CROP, SCALE, type Crop, type Marks, type Point, type TopoImage } from './geometry'
import { isSketch } from './viewport'

/** 照片的參照（TopoImage.image）換成網址：照片存在哪裡由使用的 App 決定 */
export const ImageUrl = createContext<((image: string) => string) | undefined>(undefined)

function useImageUrl(): (image: string) => string {
  const url = useContext(ImageUrl)
  if (!url) throw new Error('TopoView 需要外層提供 ImageUrl')
  return url
}

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
  photo: TopoImage
  alt: string
  crop?: Crop
  children: (k: number) => ReactNode
  svgProps?: SVGProps<SVGSVGElement>
}) {
  const imageUrl = useImageUrl()
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

/**
 * 灰階底上，選到的路線周圍疊回原色的照片：沿著線一條柔邊的帶子（幾層寬窄不同的半透明線疊出來，不用模糊濾鏡，縮放、拖曳時不吃效能）。
 * width：帶子最寬的寬度（照片像素）。
 */
export function RouteReveal({ photo, line, width }: { photo: TopoImage; line: Point[]; width: number }) {
  const imageUrl = useImageUrl()
  const id = useId()
  const d = smoothPath(line.map((p) => px(photo, p) as Pt))
  return (
    <g className="topo-reveal" aria-hidden>
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={photo.width} height={photo.height}>
        {[1, 0.7, 0.45].map((f) => (
          <path key={f} d={d} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={width * f} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </mask>
      <image href={imageUrl(photo.image)} x={0} y={0} width={photo.width} height={photo.height} mask={`url(#${id})`} />
    </g>
  )
}

/** 萬分比換成照片像素 */
export function px(photo: TopoImage, [x, y]: Point): [number, number] {
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

/** 牌子的大小與字級（螢幕像素） */
const PILL_H_BASE = 20
const PILL_FONT_BASE = 11.5
const BOLT_H_BASE = 18
const BOLT_FONT_BASE = 11
/** 看的時候 bolt 是輔助資訊：小的半透明牌子，只有 ×（anchor ××） */
const BOLT_VIEW_H_BASE = 12
const BOLT_VIEW_FONT_BASE = 9
const NOTE_FONT_BASE = 10
const NOTE_LINE_BASE = 12.5
/** 電腦版（寬螢幕）螢幕大、離得遠，牌子與字放大一點；手機維持原樣 */
const uiScale = () => (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches ? 1.5 : 1)
/** solo 時其他路線的編號牌縮成這個比例，放在線的下段（靠近起點；畫面中間留給主角） */
const SMALL_PILL = 0.8
const SMALL_SPOTS = [0.14, 0.22, 0.08, 0.3]
/** 線在畫面上比這個短（螢幕像素）的路線，編號最後才放；選到的路線不受限 */
const MIN_LABEL_LINE_PX = 40
/** 編輯時線上的點（把手）佔的範圍（半徑，螢幕像素）：牌子不蓋在上面 */
const EDIT_POINT_PX = 12
/** 示意線終點的向上箭頭：尖端在終點上面幾個圓點半徑 */
const ARROW_UP = 2.2
const arrowUp = ([x, y]: Pt, r: number) => `M${x} ${y - ARROW_UP * r}L${x + 1.8 * r} ${y + 0.6 * r}L${x - 1.8 * r} ${y + 0.6 * r}Z`
/** 看整張照片時，編號、bolt 離別條路線的線至少這麼遠（螢幕像素）才顯示難度名稱、bolt 種類：縮小時只有編號，放大到夠寬才多顯示 */
const NOTE_ROOM_PX = 90
/** 編號牌放在線上的候選位置（占全長的比例）：先放正中間，不行再往兩邊找 */
const LABEL_SPOTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]
/** 說明文字太長時換行的寬度（螢幕像素）：先試一行，再試這些寬度 */
const WRAP_PX = [90, 60]

interface Plan {
  pill?: Box
  /** solo 時其他路線的編號：小一點、最後才放（不擠到主角） */
  small?: boolean
  note?: { box: Box; lines: string[] }
  bolts: { pos: string; at: Pt; anchor: boolean; label: string; pill: Box; note?: { box: Box; lines: string[] } }[]
}

/**
 * 路線線段、編號與 bolt。標記只要幾個點：曲線、編號牌、說明依畫面上的大小自動排——
 * 線畫成平滑的曲線，編號牌放在線上空的地方（縮小時重疊的先藏起來，選到的路線優先），
 * 放大、空間夠了才多顯示難度、名稱、bolt 的材質與年份。
 * highlight 的路線用亮色、其他變淡；bolts 決定畫哪些路線的 bolt 與 anchor（預設只畫 highlight 的）；
 * 有 link 時點線段換到那條路線（換頁由呼叫的 App 負責）。兩條路線共用的線段只畫一次。
 * editing（編輯時）：線畫細一點、不顯示難度名稱等說明；牌子避開 highlight 路線的點（點上有把手），放不下就不顯示。
 * solo（路線卡片）：highlight 標編號與說明（不避開其他路線的線，貼著編號放）；其他路線只標小的編號，最後才放，放不下就不標。
 * 其他（看整張照片）：排版和大小與 highlight 無關，換路線只換顏色，牌子不會跳動。
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
  editing,
  solo,
}: {
  photo: TopoImage
  marks: Marks
  /** 路線 ID → 編號 */
  labels: Map<string, string>
  k: number
  highlight?: string
  bolts?: string[]
  /** 路線 ID → 難度、名稱、bolt 材質；沒有時只標編號與 bolt 位置 */
  info?: Map<string, RouteInfo>
  /** 點線段換到那條路線的頁面 */
  link?: (id: string) => void
  /** 點線段時改為呼叫這個（不換頁）；優先於 link */
  onPick?: (id: string) => void
  crop?: Crop
  editing?: boolean
  solo?: boolean
}) {
  const c = crop ?? FULL_CROP
  const u = uiScale()
  const [PILL_H, PILL_FONT, NOTE_FONT, NOTE_LINE, ROOM] = [PILL_H_BASE, PILL_FONT_BASE, NOTE_FONT_BASE, NOTE_LINE_BASE, NOTE_ROOM_PX].map((v) => v * u)
  const [BOLT_H, BOLT_FONT] = (editing ? [BOLT_H_BASE, BOLT_FONT_BASE] : [BOLT_VIEW_H_BASE, BOLT_VIEW_FONT_BASE]).map((v) => v * u)
  const [bx, by] = px(photo, [c.x, c.y])
  const [bw, bh] = px(photo, [c.w, c.h])
  // 亮色的畫在最上面
  const ids = Object.keys(marks).sort((a, b) => Number(a === highlight) - Number(b === highlight))
  /** 排版優先的路線：編輯與路線卡片是選到的那條；看整張照片時沒有（換路線不重排） */
  const lead = editing || solo ? highlight : undefined
  // 先放的優先：lead，其次依編號
  const priority = [...ids].sort((a, b) => Number(b === lead) - Number(a === lead) || Number(labels.get(a)) - Number(labels.get(b)) || a.localeCompare(b))
  const drawn = priority.filter((id) => marks[id].line).map((id): [string, Pt[]] => [id, marks[id].line!.map((p) => px(photo, p))])
  const runs = drawnRuns(drawn)
  const own = ownRuns(drawn)
  const drawnOf = new Map(drawn)
  /** 這個位置旁邊夠寬，可以多顯示說明（路線卡片已經放大到這條路線，一律可以） */
  const roomy = (at: Pt, id: string) => solo || drawn.every(([other, line]) => other === id || distanceToLine(at, line) >= ROOM * k)
  /** 起點、終點圓點的半徑（畫面像素） */
  const dotSize = (id: string) => (editing ? 3 : id === lead ? 4 : 3.2)
  const lineOf = (id: string): Pt[] | undefined => marks[id].line?.map((p) => px(photo, p) as Pt)
  /** 編號牌放的線：獨有線段中最長的一段（分岔的路線標在自己的岔線上）；整條都和別的路線共用時用整條 */
  const labelLine = (id: string, line: Pt[]): Pt[] => own.get(id)!.reduce<Pt[] | undefined>((a, b) => (!a || pathLength(b) > pathLength(a) ? b : a), undefined) ?? line

  // ── 自動排版：同一張 Topo 的所有牌子、說明一起排，互不重疊；依優先順序放，放不下的藏起來 ──
  // 位置固定的（bolt）先放，可以沿著線移動的編號牌其次，說明文字最後（換方向、換行，盡量不壓到線）
  const placer = new Placer(
    { x: bx, y: by, w: bw, h: bh },
    3 * k,
    // solo：其他路線只是淡淡的背景，說明可以壓在上面，貼著編號放
    drawn.filter(([id]) => !solo || id === highlight).map(([, line]) => line),
  )
  if (editing && highlight) {
    const r = EDIT_POINT_PX * k
    for (const p of marks[highlight]?.line ?? []) {
      const [x, y] = px(photo, p)
      placer.reserve({ x: x - r, y: y - r, w: 2 * r, h: 2 * r })
    }
  }
  const plan = new Map<string, Plan>(priority.map((id) => [id, { bolts: [] }]))
  const length = new Map(priority.map((id) => [id, (lineOf(id) ? pathLength(lineOf(id)!) : 0) / k]))
  // 編號是主要的資訊，先放；bolt 是輔助的，被編號蓋住的就不畫（編輯時一定畫，牌子就是拖曳的地方）。
  // 編號先避開 bolt 的位置，真的沒地方才蓋在 bolt 上。
  const boltPills = Object.keys(marks)
    .filter((id) => bolts.includes(id))
    .sort((a, b) => priority.indexOf(a) - priority.indexOf(b))
    .flatMap((id) =>
      Object.entries(marks[id].bolts ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pos, p]) => {
          const anchor = pos.startsWith('A')
          // 編輯時要分得出是哪一顆（拖曳、對照路線資料），看的時候只標位置
          const label = anchor ? '××' : editing ? `× ${pos}` : '×'
          const at = px(photo, p) as Pt
          return { id, pos, at, anchor, label, box: centeredBox(at, (textWidth(label, BOLT_FONT) + 12) * k, BOLT_H * k) }
        }),
    )
  const onBolt = (b: Box) => boltPills.some((p) => overlaps(b, p.box, 3 * k))
  /** 難度、名稱的各種版本：一行、名稱換行、只留難度 */
  const noteVersions = (id: string): string[][] => {
    const i = info?.get(id)
    if (!i || editing) return []
    return [[i.grade, i.name], ...WRAP_PX.map((wpx) => [i.grade, ...(i.name ? wrapText(i.name, NOTE_FONT, wpx) : [])]), [i.grade]]
      .map((v) => v.filter((x): x is string => !!x))
      .filter((v, j, all) => v.length > 0 && all.findIndex((o) => o.join('|') === v.join('|')) === j)
  }
  /** 說明貼著編號的位置：上面、下面（在自己的線上，一看就知道是哪一條），其次右邊、左邊 */
  const besidePill = (pill: Box, lines: string[]): Box[] => {
    const g = 4 * k
    const nw = Math.max(...lines.map((t) => textWidth(t, NOTE_FONT))) * k
    const nh = lines.length * NOTE_LINE * k
    return [
      { x: pill.x + pill.w / 2 - nw / 2, y: pill.y - nh - g, w: nw, h: nh },
      { x: pill.x + pill.w / 2 - nw / 2, y: pill.y + pill.h + g, w: nw, h: nh },
      { x: pill.x + pill.w + g, y: pill.y + pill.h / 2 - nh / 2, w: nw, h: nh },
      { x: pill.x - nw - g, y: pill.y + pill.h / 2 - nh / 2, w: nw, h: nh },
    ]
  }
  const center = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2]
  /** 示意的線（主要的路線不在照片裡，例如 565）：編號緊貼在終點的箭頭正上方 */
  const sketch = new Set(editing ? [] : ids.filter((id) => (marks[id].line?.length ?? 0) >= 2 && isSketch(photo, c, marks[id])))
  /** 線在畫面上很短（只畫了一小段、縮得很小）的路線：其他編號都放好之後才放，放得下才標 */
  const short = (id: string) => id !== lead && !sketch.has(id) && !!lineOf(id) && lineOf(id)!.length >= 2 && length.get(id)! < MIN_LABEL_LINE_PX
  // 1. 路線編號：沿著線找空位，優先不壓到別條線、不蓋住 bolt
  const placePill = (id: string, small: boolean) => {
    const text = labels.get(id)
    if (!text) return
    const f = small ? SMALL_PILL : 1
    const line = lineOf(id)
    const w = (textWidth(text, PILL_FONT * f) + 14 * f) * k
    const h = PILL_H * f * k
    let spots: Box[]
    if (line && sketch.has(id)) {
      const [ex, ey] = line[line.length - 1]
      spots = [centeredBox([ex, ey - ARROW_UP * dotSize(id) * k - 4 * k - h / 2], w, h)]
    } else if (line && line.length >= 2) {
      const on = labelLine(id, line)
      const along = (small ? SMALL_SPOTS : LABEL_SPOTS).map((f) => pointAlong(on, f))
      spots = along.map((p) => centeredBox(p, w, h))
      // 很短的線（常常是從照片邊緣出去的示意線）：線上放不下時，放在線的終點上面或旁邊
      if (short(id)) {
        const [ex, ey] = line[line.length - 1]
        spots.push(centeredBox([ex, ey - h * 0.9], w, h), centeredBox([ex + w / 2 + h / 3, ey], w, h), centeredBox([ex - w / 2 - h / 3, ey], w, h))
      }
      // 選到的路線一定要標：線上都沒空位時放在線的旁邊
      if (id === lead) spots.push(...along.flatMap(([x, y]) => [centeredBox([x + w / 2 + h / 2, y], w, h), centeredBox([x - w / 2 - h / 2, y], w, h)]))
    } else {
      // 沒有線段：標在最下面的 bolt 旁邊
      const low = lowestBolt(photo, marks[id].bolts)
      if (!low) return
      spots = [centeredBox([low[0], low[1] + h], w, h), centeredBox([low[0], low[1] - h], w, h)]
    }
    const own = drawnOf.get(id)
    // 完整的說明（難度＋名稱一行）也放得下的位置優先（不壓到別條線、不蓋住 bolt）
    const full = small || sketch.has(id) ? undefined : noteVersions(id)[0]
    const clear = (b: Box) => placer.fits(b) && !placer.onLine(b, own) && !onBolt(b)
    const pill =
      (full && spots.find((b) => clear(b) && roomy(center(b), id) && besidePill(b, full).some(clear))) ??
      spots.find(clear) ??
      spots.find((b) => placer.fits(b) && !onBolt(b)) ??
      spots.find((b) => placer.fits(b)) ??
      // 路線卡片的主角一定要標：放不下也放在第一個位置
      (id === lead && !editing ? spots[0] : undefined)
    if (!pill) return
    placer.reserve(pill)
    const entry = plan.get(id)!
    entry.pill = pill
    entry.small = small
  }
  const mains = priority.filter((id) => !solo || id === highlight)
  for (const id of mains) if (!short(id)) placePill(id, false)
  for (const id of mains) if (short(id)) placePill(id, false)
  // 2. bolt、anchor 的牌子（位置固定）
  for (const b of boltPills) {
    const pill = placer.place([b.box], editing)
    if (pill) plan.get(b.id)!.bolts.push({ pos: b.pos, at: b.at, anchor: b.anchor, label: b.label, pill })
  }
  // 3. 難度、名稱：緊貼在編號旁邊；編號旁邊夠寬才顯示，先試完整的（難度＋名稱），放不下才少一點（換行、只留難度）
  for (const id of mains) {
    const entry = plan.get(id)!
    const pill = entry.pill
    if (!pill || !roomy(center(pill), id)) continue
    const own = drawnOf.get(id)
    found: for (const lines of noteVersions(id)) {
      // 優先不壓到別條線（可以壓在自己的線上）
      for (const avoid of [true, false]) {
        const note = besidePill(pill, lines).find((n) => placer.fits(n) && (!avoid || !placer.onLine(n, own)))
        if (note) {
          placer.reserve(note)
          entry.note = { box: note, lines }
          break found
        }
      }
    }
  }
  // 4. bolt 旁邊的種類（材質）：這條路線有空間顯示難度名稱時才顯示，而且不壓到別條線
  for (const id of editing ? [] : priority) {
    const entry = plan.get(id)!
    const i = info?.get(id)
    for (const b of entry.bolts) {
      const text = i?.bolts[b.pos]
      if (!text || (!solo && !entry.note)) continue
      const g = 4 * k
      const w = textWidth(text, NOTE_FONT) * k
      const h = NOTE_LINE * k
      const y = b.at[1] - h / 2
      const cx = b.at[0] - w / 2
      const box = [
        { x: b.pill.x + b.pill.w + g, y, w, h },
        { x: b.pill.x - w - g, y, w, h },
        { x: cx, y: b.pill.y + b.pill.h + g, w, h },
        { x: cx, y: b.pill.y - h - g, w, h },
      ].find((c) => placer.fits(c) && !placer.onLine(c, drawnOf.get(id)))
      if (box) {
        placer.reserve(box)
        b.note = { box, lines: [text] }
      }
    }
  }

  // 5. solo：其他路線的編號（小、淡），放得下才標，不帶說明
  if (solo && !editing) {
    const others = priority.filter((id) => id !== highlight)
    for (const id of others) if (!short(id)) placePill(id, true)
    for (const id of others) if (short(id)) placePill(id, true)
  }

  // SVG 的 <a> 的 href 不是字串，站內換頁攔不到，改用點擊與 Enter 換頁
  const pick = onPick ?? link
  // 沒有路線資料（kind 不明）時用紅色
  const clsOf = (id: string) => `topo-route kind-${info?.get(id)?.kind ?? 'other'}${id === highlight ? ' on' : highlight ? ' dim' : ''}`

  // 先畫所有路線的線，再畫所有的牌子：編號、bolt 不會被別條路線的線蓋住
  return (
    <>
      {ids.map((id) => {
        const line = lineOf(id)
        const start = line?.[0]
        // 終點（看的時候）：和起點一樣的實心圓點；編輯時每個點都有把手，不另外畫
        const end = !editing && line && line.length >= 2 ? line[line.length - 1] : undefined
        // 粗細只在編輯、路線卡片時區分；看整張照片時只換顏色
        const on = id === lead
        const dotR = dotSize(id) * k
        const cls = clsOf(id)
        const body = (
          <>
            {(runs.get(id) ?? []).map((run, i) => {
              const d = smoothPath(run as Pt[])
              return (
                <g key={i}>
                  <path className="topo-hit" d={d} strokeWidth={18 * k} />
                  <path className="topo-line" d={d} strokeWidth={(editing ? (on ? 2 : 1.6) : on ? 4 : 2.8) * k} />
                </g>
              )
            })}
            {start && !(editing && on) && <circle className="topo-dot" cx={start[0]} cy={start[1]} r={dotR} />}
            {end && sketch.has(id) && <path className="topo-dot" d={arrowUp(end, dotR)} />}
            {end && !sketch.has(id) && <circle className="topo-dot" cx={end[0]} cy={end[1]} r={dotR} />}
          </>
        )
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
      {ids.map((id) => {
        const p = plan.get(id)!
        if (!p.pill && !p.note && p.bolts.length === 0) return null
        return (
          // 鍵盤操作由上面線的那一層負責，這裡只接滑鼠點擊
          <g key={`${id}-labels`} className={`${clsOf(id)}${pick ? ' link' : ''}`} onClick={pick && (() => pick(id))}>
            {p.bolts.map((b) => (
              <g key={b.pos} className={`topo-bolt${b.anchor ? ' anchor' : ''}`}>
                <rect x={b.pill.x} y={b.pill.y} width={b.pill.w} height={b.pill.h} rx={b.pill.h / 2} />
                <text x={b.pill.x + b.pill.w / 2} y={b.pill.y + b.pill.h / 2} fontSize={BOLT_FONT * k} dominantBaseline="central" textAnchor="middle">
                  {b.label}
                </text>
                {b.note && (
                  <text className="topo-note" textAnchor="middle" fontSize={NOTE_FONT * k} strokeWidth={2.5 * k}>
                    {b.note.lines.map((t, i) => (
                      <tspan key={i} x={b.note!.box.x + b.note!.box.w / 2} y={b.note!.box.y + (i + 0.5) * NOTE_LINE * k} dominantBaseline="central">
                        {t}
                      </tspan>
                    ))}
                  </text>
                )}
              </g>
            ))}
            {p.pill && labels.get(id) && (
              <g className={`topo-badge${p.small ? ' small' : ''}`}>
                <rect x={p.pill.x} y={p.pill.y} width={p.pill.w} height={p.pill.h} rx={p.pill.h / 2} strokeWidth={1.5 * k} />
                <text x={p.pill.x + p.pill.w / 2} y={p.pill.y + p.pill.h / 2} fontSize={PILL_FONT * (p.small ? SMALL_PILL : 1) * k} dominantBaseline="central" textAnchor="middle">
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
          </g>
        )
      })}
    </>
  )
}

/** 沒有線段時，編號標在最下面的 bolt 旁邊 */
function lowestBolt(photo: TopoImage, bolts: Record<string, Point> | undefined): [number, number] | undefined {
  const lowest = Object.values(bolts ?? {}).reduce<Point | undefined>((a, b) => (!a || b[1] > a[1] ? b : a), undefined)
  return lowest && px(photo, lowest)
}
