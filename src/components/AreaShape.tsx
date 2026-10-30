import type { KeyboardEvent } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, Sector } from '../data/schema'
import { sectorColor } from '../format'
import { localName, useLang } from '../i18n'
import { project, useScaleMap } from '../map/mapData'
import { useHorizontalSwipe } from '../swipeGesture'

/**
 * 用大區域的地圖形狀（public/rescue/areas.geojson，與地圖頁相同）畫的圖：
 * - CragShape：整個龍洞，各區域用自己的顏色（首頁上方）
 * - AreaShape：一個大區域的形狀（區域頁上方）
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

/** 整個龍洞橫放（北邊朝右、海在下方，與路線清單的地圖相同）：各大區域的形狀，用各自的顏色（與清單的色點相同） */
export function CragShape({ data, className }: { data: LoadedData; className?: string }) {
  const map = useScaleMap()
  if (map.status !== 'ok') return <div className={className} aria-hidden />
  const b = bounds(map.data.areas.flatMap((a) => a.rings.flat().map(turn)))
  const pad = Math.max(b.w, b.h) * 0.02
  return (
    <svg className={className} viewBox={`${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`} aria-hidden>
      {data.dataset.areas.map((area) => {
        const shape = map.data.areas.find((a) => a.id === areaKey(area))
        return shape && <path key={area.id} d={ringsPath(shape.rings, turn)} fill={area.color ?? 'var(--brand)'} />
      })}
    </svg>
  )
}

/** 一個大區域的形狀（區域的顏色，淡色）與裡面所有分區的岩壁（分區的顏色，與清單的色點相同），看得出岩壁的相對位置 */
export function AreaShape({ area, className }: { area: Area; className?: string }) {
  const map = useScaleMap()
  const shape = map.status === 'ok' ? map.data.areas.find((a) => a.id === areaKey(area)) : undefined
  if (map.status !== 'ok' || !shape) return <div className={className} aria-hidden />
  const b = bounds(shape.rings.flat())
  const pad = Math.max(b.w, b.h) * 0.03
  return (
    <svg className={className} viewBox={`${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`} aria-hidden>
      <path d={shape.path} fill={area.color ?? 'var(--brand)'} fillOpacity={0.3} />
      {area.sectors.map((sector, i) => {
        const walls = (map.data.walls[sector.id] ?? []).map((line) => line.map(project))
        return (
          <path
            key={sector.id}
            d={walls.map(wallPath).join('')}
            fill="none"
            stroke={sectorColor(area.color, i, area.sectors.length) ?? 'var(--brand)'}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

/** 放大的範圍至少這麼寬（公尺）：岩壁很短的分區也看得到旁邊的岩壁 */
const MIN_VIEW_M = 15

/**
 * 一個分區的地圖：放大到這個分區的岩壁（照實際比例，分區的顏色加粗），旁邊其他分區的岩壁淡淡畫出，
 * 大區域的形狀只畫到這個範圍。這個分區還沒有岩壁資料時，畫整個大區域的形狀。
 */
export function SectorShape({ area, sector, color, className }: { area: Area; sector: Sector; color?: string; className?: string }) {
  const map = useScaleMap()
  if (map.status !== 'ok') return <div className={className} aria-hidden />
  const wallsOf = (s: Sector) => (map.data.walls[s.id] ?? []).map((line) => line.map(project))
  const own = wallsOf(sector)
  if (own.length === 0) return <AreaShape area={area} className={className} />
  const others = area.sectors.filter((s) => s.id !== sector.id).flatMap(wallsOf)
  const b = bounds(own.flat())
  const side = Math.max(b.w, b.h, MIN_VIEW_M) * 1.4
  const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2]
  const shape = map.data.areas.find((a) => a.id === areaKey(area))
  return (
    <svg className={className} viewBox={`${cx - side / 2} ${cy - side / 2} ${side} ${side}`} aria-hidden>
      {shape && <path d={shape.path} fill={area.color ?? 'var(--brand)'} fillOpacity={0.28} />}
      <path d={others.map(wallPath).join('')} fill="none" stroke="var(--muted)" strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={own.map(wallPath).join('')} fill="none" stroke={color ?? area.color ?? 'var(--brand)'} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
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
