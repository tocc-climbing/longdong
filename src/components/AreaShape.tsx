import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, Sector } from '../data/schema'
import { sectorColor } from '../format'
import { localName, useLang } from '../i18n'
import { heroFit, type Pt } from '../map/heroFit'
import { project, useScaleMap } from '../map/mapData'
import { useHorizontalSwipe } from '../swipeGesture'

/**
 * 用大區域的地圖形狀（public/rescue/areas.geojson，與地圖頁相同）畫的圖：
 * - CragShape：整個龍洞，各區域用自己的顏色（首頁上方）
 * - AreaShape：一個大區域的所有岩壁與形狀（區域頁上方）
 * - SectorShape：一個分區的岩壁（分區頁、路線頁上方）
 * - AreaStrip：龍洞橫放的一條，放大到選到的區域（路線清單選區域）
 * 地圖資料還沒載入或載入失敗時不畫（版面不跳動：外框的高度固定）。
 */

type Ring = [number, number][]

/** 大區域的 key（areas.geojson 的 id）：區域 ID 的最後一段 */
const areaKey = (area: Area) => area.id.split('/').pop()!

/** 外接矩形 */
function bounds(points: [number, number][]) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

const ringsPath = (rings: Ring[], at: (p: [number, number]) => [number, number]) =>
  rings.map((ring) => `M${ring.map((p) => at(p).map((n) => n.toFixed(1)).join(',')).join('L')}Z`).join('')

/** 畫面座標 (x 向東, y 向南) 轉 90 度 → (-y, x)：龍洞橫放，北邊朝右 */
const turn = ([x, y]: [number, number]): [number, number] => [-y, x]

const wallPath = (pts: [number, number][]) => `M${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L')}`

/** 標題卡地圖四邊留的空白（px）：上方留給工具列的圖示 */
const HERO_INSET = { top: 48, right: 12, bottom: 12, left: 12 }
/** 首頁的地圖是整張卡片的背景（可以和文字重疊）；四周多留一點，不要塞滿 */
const CRAG_INSET = { top: 16, right: 20, bottom: 16, left: 20 }
/** 首頁的地圖：北邊朝右（左邊是最南邊的後門，與清單的順序相同），再微微斜一點，不會太呆板 */
const CRAG_ANGLE = 80

/** 元素的大小（px），變動時更新；還沒量到時 undefined */
function useSize(ref: RefObject<Element | null>): { w: number; h: number } | undefined {
  const [size, setSize] = useState<{ w: number; h: number }>()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 用畫面上的大小：SVG 元素的 contentRect 可能是裡面圖形的範圍，不是元素本身
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize((old) => (old && old.w === r.width && old.h === r.height ? old : { w: r.width, h: r.height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * 標題卡右邊的地圖（佔滿卡片的高度）：fit 的點（岩壁）整個看得到、轉到放得最大的方向（heroFit）；
 * 其他的圖形（區域的形狀）可以超出去，被卡片的邊切掉。
 */
function HeroMap({
  fit,
  spread,
  minSpan,
  angle,
  inset = HERO_INSET,
  className,
  children,
}: {
  fit: Pt[]
  spread?: number
  minSpan?: number
  /** 固定的方向（不找放得最大的） */
  angle?: number
  inset?: typeof HERO_INSET
  className?: string
  children: ReactNode
}) {
  const ref = useRef<SVGSVGElement>(null)
  const size = useSize(ref)
  const placed = size && heroFit(fit, { ...size, ...inset }, { spread, minSpan, angle })
  return (
    <svg ref={ref} className={`${className ?? ''} hero-map`} viewBox={placed?.viewBox.join(' ')} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {placed && <g transform={`rotate(${placed.angle})`}>{children}</g>}
    </svg>
  )
}

/**
 * 整個龍洞（首頁標題卡的背景，可以和文字重疊）：各大區域用各自的顏色（與清單的色點相同），淡淡的；
 * 整個龍洞都放得下，北邊朝右、微微斜一點（CRAG_ANGLE）。
 */
export function CragShape({ data, className }: { data: LoadedData; className?: string }) {
  const map = useScaleMap()
  if (map.status !== 'ok') return <div className={className} aria-hidden />
  return (
    <HeroMap fit={map.data.areas.flatMap((a) => a.rings.flat())} angle={CRAG_ANGLE} inset={CRAG_INSET} className={className}>
      {data.dataset.areas.map((area) => {
        const shape = map.data.areas.find((a) => a.id === areaKey(area))
        return shape && <path key={area.id} d={shape.path} fill={area.color ?? 'var(--brand)'} fillOpacity={0.55} />
      })}
    </HeroMap>
  )
}

/** 一個大區域：所有分區的岩壁（分區的顏色，與清單的色點相同）整個看得到、越大越好，底下是區域的形狀（淡色，可以被切掉） */
export function AreaShape({ area, className }: { area: Area; className?: string }) {
  const map = useScaleMap()
  const shape = map.status === 'ok' ? map.data.areas.find((a) => a.id === areaKey(area)) : undefined
  if (map.status !== 'ok' || !shape) return <div className={className} aria-hidden />
  const walls = area.sectors.map((sector) => (map.data.walls[sector.id] ?? []).map((line) => line.map(project)))
  const fit = walls.flat(2)
  return (
    <HeroMap fit={fit.length ? fit : shape.rings.flat()} className={className}>
      <path d={shape.path} fill={area.color ?? 'var(--brand)'} fillOpacity={0.3} />
      {area.sectors.map((sector, i) => (
        <path
          key={sector.id}
          d={walls[i].map(wallPath).join('')}
          fill="none"
          stroke={sectorColor(area.color, i, area.sectors.length) ?? 'var(--brand)'}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </HeroMap>
  )
}

/** 分區頁的範圍是這個分區岩壁的幾倍（看得到附近其他的牆）；至少這麼寬（公尺） */
const NEARBY_SPREAD = 2.4
const NEARBY_MIN_M = 60
/** 路線頁只畫這個分區的岩壁：至少這麼寬（公尺） */
const SINGLE_MIN_M = 15

/**
 * 一個分區的地圖：這個分區的岩壁（照實際比例，分區的顏色加粗）。分區頁的範圍大一點，附近其他分區的岩壁淡淡畫出；
 * single（路線頁）只畫這個分區的岩壁、放到最大。這個分區還沒有岩壁資料時，畫整個大區域。
 */
export function SectorShape({ area, sector, color, single, className }: { area: Area; sector: Sector; color?: string; single?: boolean; className?: string }) {
  const map = useScaleMap()
  if (map.status !== 'ok') return <div className={className} aria-hidden />
  const wallsOf = (s: Sector) => (map.data.walls[s.id] ?? []).map((line) => line.map(project))
  const own = wallsOf(sector)
  if (own.length === 0) return <AreaShape area={area} className={className} />
  const others = single ? [] : area.sectors.filter((s) => s.id !== sector.id).flatMap(wallsOf)
  const shape = map.data.areas.find((a) => a.id === areaKey(area))
  return (
    <HeroMap fit={own.flat()} spread={single ? 1 : NEARBY_SPREAD} minSpan={single ? SINGLE_MIN_M : NEARBY_MIN_M} className={className}>
      {shape && <path d={shape.path} fill={area.color ?? 'var(--brand)'} fillOpacity={0.28} />}
      <path d={others.map(wallPath).join('')} fill="none" stroke="var(--muted)" strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={own.map(wallPath).join('')} fill="none" stroke={color ?? area.color ?? 'var(--brand)'} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </HeroMap>
  )
}

/** AreaStrip 的畫面大小（viewBox 單位，寬度隨畫面縮放） */
const STRIP = { w: 343, h: 110 }
/** 地圖上方留給名稱標記的高度 */
const LABEL_H = 22

/**
 * 龍洞橫放（順時針轉 90 度：北邊朝右、海在下方），左邊是最南邊的後門，與首頁的區域順序相同。
 * 地圖固定顯示整個龍洞；選到的區域實色，上方一個小三角形與名稱（小區域也找得到），其他區域淡色。
 * 選區域：左右滑（往左滑換到右邊、北邊的下一個區域）、點區域，或用左右的箭頭按鈕。
 * 再點一次選到的區域：全區（value 為 undefined，全部實色、沒有浮起來的區域）；這時往左滑到第一個區域。
 */
export function AreaStrip({ data, value, onChange }: { data: LoadedData; value: string | undefined; onChange: (areaId: string | undefined) => void }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const areas = data.dataset.areas
  const index = areas.findIndex((a) => a.id === value)
  const step = (by: number) => {
    const next = areas[index + by] ?? (index < 0 && by > 0 ? areas[0] : undefined)
    if (next) onChange(next.id)
  }
  const swipe = useHorizontalSwipe(step, 30)
  const arrows = (
    <>
      <button type="button" className="area-strip-prev" aria-label={localName(areas[index - 1]?.name ?? areas[0].name, lang).main} disabled={index <= 0} onClick={() => step(-1)}>
        ‹
      </button>
      <button type="button" className="area-strip-next" aria-label={localName(areas[index + 1]?.name ?? areas[0].name, lang).main} disabled={index >= areas.length - 1} onClick={() => step(1)}>
        ›
      </button>
    </>
  )
  if (map.status !== 'ok') return <div className="area-strip">{arrows}</div>

  // 名稱標在最大的一塊上方（有的區域另有離得較遠的小塊）
  const largest = (rings: Ring[]) => rings.reduce((a, b) => {
    const [ba, bb] = [bounds(a.map(turn)), bounds(b.map(turn))]
    return bb.w * bb.h > ba.w * ba.h ? b : a
  })
  const shapes = new Map(
    map.data.areas.map((a) => {
      const main = largest(a.rings)
      return [a.id, { d: ringsPath(a.rings, turn), box: bounds(main.map(turn)) }]
    }),
  )
  const all = bounds(map.data.areas.flatMap((a) => a.rings.flat().map(turn)))
  // 整個龍洞放進名稱標記下面的空間
  const mapH = STRIP.h - LABEL_H - 6
  const k = Math.min((STRIP.w * 0.94) / all.w, mapH / all.h)
  const tx = STRIP.w / 2 - (all.x + all.w / 2) * k
  const ty = LABEL_H + mapH / 2 - (all.y + all.h / 2) * k
  // 名稱標記：最大一塊的上緣中間（左右不超出畫面）
  const picked = index >= 0 ? areas[index] : undefined
  const box = picked && shapes.get(areaKey(picked))?.box
  const label = box && {
    x: Math.min(STRIP.w - 30, Math.max(30, tx + (box.x + box.w / 2) * k)),
    y: ty + box.y * k,
  }

  const press = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onChange(id)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      step(e.key === 'ArrowLeft' ? -1 : 1)
    }
  }
  return (
    <div className="area-strip">
      <svg viewBox={`0 0 ${STRIP.w} ${STRIP.h}`} role="group" aria-label={t('checklist.areas')} {...swipe}>
        <g className={`area-strip-view${index < 0 ? ' all' : ''}`} transform={`translate(${tx} ${ty}) scale(${k})`}>
          {areas.map((area) => {
            const shape = shapes.get(areaKey(area))
            if (!shape) return null
            const on = area.id === value
            return (
              <g
                key={area.id}
                role="button"
                tabIndex={on || (index < 0 && area === areas[0]) ? 0 : -1}
                aria-label={localName(area.name, lang).main}
                aria-pressed={on}
                className={on ? 'on' : undefined}
                onClick={() => onChange(on ? undefined : area.id)}
                onKeyDown={(e) => press(e, area.id)}
              >
                <path className="hit" d={shape.d} />
                <path d={shape.d} fill={area.color ?? 'var(--brand)'} />
              </g>
            )
          })}
        </g>
        {picked && label && (
          <g key={picked.id} className="area-strip-label" aria-hidden>
            <text x={label.x} y={label.y - 9}>
              {localName(picked.name, lang).main}
            </text>
            <path d={`M${label.x} ${label.y - 2}l-4 -5h8z`} fill={picked.color ?? 'var(--brand)'} />
          </g>
        )}
      </svg>
      {arrows}
    </div>
  )
}
