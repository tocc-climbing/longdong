import type { KeyboardEvent } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area } from '../data/schema'
import { localName, useLang } from '../i18n'
import { useScaleMap } from '../map/mapData'
import { useHorizontalSwipe } from '../swipeGesture'

/**
 * 用大區域的地圖形狀（public/rescue/areas.geojson，與地圖頁相同）畫的圖：
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

/** 一個大區域的形狀，用區域的顏色填滿 */
export function AreaShape({ area, className }: { area: Area; className?: string }) {
  const map = useScaleMap()
  const shape = map.status === 'ok' ? map.data.areas.find((a) => a.id === areaKey(area)) : undefined
  if (!shape) return <div className={className} aria-hidden />
  const b = bounds(shape.rings.flat())
  const pad = Math.max(b.w, b.h) * 0.03
  return (
    <svg className={className} viewBox={`${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`} aria-hidden>
      <path d={shape.path} fill={area.color ?? 'var(--brand)'} />
    </svg>
  )
}

/** AreaStrip 的畫面大小（viewBox 單位，寬度隨畫面縮放） */
const STRIP = { w: 343, h: 96 }

/**
 * 龍洞橫放（順時針轉 90 度：北邊朝右、海在下方），左邊是最南邊的後門，與首頁的區域順序相同。
 * 放大到選到的區域、置中，左右露出相鄰的區域；換區域時平移、縮放（CSS transition）。
 * 選區域：左右滑（往左滑換到右邊、北邊的下一個區域）、點區域，或用左右的箭頭按鈕。
 * 再點一次選到的區域：縮回整個龍洞（value 為 undefined，全部實色）；這時往左滑到第一個區域。
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

  // 畫面座標 (x 向東, y 向南) 轉 90 度 → (-y, x)
  const turn = ([x, y]: [number, number]): [number, number] => [-y, x]
  // 放大的範圍：最大的一塊（有的區域另有離得較遠的小塊，算進去會縮得太小）
  const mainBox = (rings: Ring[]) => rings.map((r) => bounds(r.map(turn))).reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
  const shapes = new Map(map.data.areas.map((a) => [a.id, { d: ringsPath(a.rings, turn), box: mainBox(a.rings) }]))
  const selected = index >= 0 ? shapes.get(areaKey(areas[index]))?.box : undefined
  const all = bounds([...shapes.values()].flatMap(({ box: b }) => [[b.x, b.y], [b.x + b.w, b.y + b.h]] as [number, number][]))
  const box = selected ?? all
  // 選到的區域約佔寬度的一半、高度的八成（很小的區域最多放大到畫面寬約 320 公尺，旁邊的區域還看得到）；全區時整個放進來
  const k = selected ? Math.min((STRIP.w * 0.5) / box.w, (STRIP.h * 0.8) / box.h, STRIP.w / 320) : Math.min((STRIP.w * 0.9) / box.w, (STRIP.h * 0.9) / box.h)
  const tx = STRIP.w / 2 - (box.x + box.w / 2) * k
  const ty = STRIP.h / 2 - (box.y + box.h / 2) * k

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
        <g className={`area-strip-view${index < 0 ? ' all' : ''}`} style={{ transform: `translate(${tx}px, ${ty}px) scale(${k})` }}>
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
      </svg>
      {arrows}
    </div>
  )
}
