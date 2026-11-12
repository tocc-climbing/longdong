import { type KeyboardEvent } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, Sector } from '../data/schema'
import { sectorColor } from '../format'
import { localName, useLang } from '../i18n'
import { project, useScaleMap } from '../map/mapData'
import { useHorizontalSwipe } from '../swipeGesture'
import { TerrainHero } from './TerrainHero'
import { terrainColor, terrainIslandParts } from '../map/terrainRegions'

type Ring = [number, number][]
const areaKey = (area: Area) => area.id.split('/').pop()!
function bounds(points: [number, number][]) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs)-Math.min(...xs), h: Math.max(...ys)-Math.min(...ys) }
}
const turn = ([x, y]: [number, number]): [number, number] => [-y, x]
const ringsPath = (rings: Ring[], at: (p: [number, number]) => [number, number]) =>
  rings.map((ring) => `M${ring.map((p) => at(p).map((n) => n.toFixed(1)).join(',')).join('L')}Z`).join('')

/** 首頁與各層標題圖共用 20m DTM；選區長條沿用平面版。 */
export function CragShape({ data, className }: { data: LoadedData; className?: string }) {
  const map = useScaleMap()
  if (map.status !== 'ok') return <div className={className} aria-hidden />
  const regions = map.data.areas.map((a) => {
    const area = data.dataset.areas.find((area) => areaKey(area) === a.id)
    return { ...a, color: terrainColor(a.id, area?.color ?? '#8fa3b0'), walls: (area?.sectors ?? []).flatMap((s) => (map.data.walls[s.id] ?? []).map((line) => line.map(project))) }
  })
  const fit = terrainIslandParts(regions).mainlands.flatMap((a) => [...a.rings.flat(), ...a.walls.flat()])
  return <TerrainHero regions={regions} walls={[]} fit={fit} overview className={className} />
}

export function AreaShape({ area, className }: { area: Area; className?: string }) {
  const map = useScaleMap()
  const shape = map.status === 'ok' ? map.data.areas.find((a) => a.id === areaKey(area)) : undefined
  if (map.status !== 'ok' || !shape) return <div className={className} aria-hidden />
  const walls = area.sectors.map((sector, i) => ({ lines: (map.data.walls[sector.id] ?? []).map((line) => line.map(project)), color: sectorColor(area.color, i, area.sectors.length) ?? '#8fa3b0', strong: true }))
  const fit = walls.flatMap((w) => w.lines.flat())
  const region = { ...shape, color: terrainColor(area.id, area.color ?? '#8fa3b0'), walls: walls.flatMap((w) => w.lines) }
  return <TerrainHero regions={[region]} walls={walls} fit={fit.length ? fit : shape.rings.flat()} includeIslands className={className} />
}

export function SectorShape({ area, sector, color, single, className }: { area: Area; sector: Sector; color?: string; single?: boolean; className?: string }) {
  const map = useScaleMap()
  if (map.status !== 'ok') return <div className={className} aria-hidden />
  const own = (map.data.walls[sector.id] ?? []).map((line) => line.map(project))
  if (!own.length) return <AreaShape area={area} className={className} />
  const shape = map.data.areas.find((a) => a.id === areaKey(area))
  const walls = area.sectors.filter((s) => !single || s.id === sector.id).map((s) => ({ lines: (map.data.walls[s.id] ?? []).map((line) => line.map(project)), color: s.id === sector.id ? color ?? area.color ?? '#8fa3b0' : '#8fa3b0', strong: s.id === sector.id }))
  const regionWalls = area.sectors.flatMap((s) => (map.data.walls[s.id] ?? []).map((line) => line.map(project)))
  return <TerrainHero regions={shape ? [{ ...shape, color: terrainColor(area.id, area.color ?? '#8fa3b0'), walls: regionWalls }] : []} walls={walls} fit={own.flat()} single={single} className={className} />
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
