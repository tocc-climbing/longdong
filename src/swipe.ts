import { useEffect, useRef } from 'react'
import type { LoadedData } from './data/dataset'
import type { LocalizedName } from './data/schema'
import { href, type Page } from './router'

/**
 * 手機版左右滑動切換區域：
 * - 區域頁（含只有一個區域的大區域）：依序走過整個岩場的區域，大區域的最後一區接到下一個大區域
 * - 有多個區域的大區域頁：切換大區域
 */

export interface Neighbor {
  hash: string
  name: LocalizedName
}

type NavData = Pick<LoadedData, 'dataset' | 'areaById' | 'sectorById'>

export function neighbors(page: Page, data: NavData): { prev?: Neighbor; next?: Neighbor } | undefined {
  let list: (Neighbor & { id: string })[]
  let current: string
  const area = page.name === 'area' ? data.areaById.get(page.id) : undefined

  if (area && area.sectors.length > 1) {
    list = data.dataset.areas.map((a) => ({ id: a.id, hash: href.area(a.id), name: a.name }))
    current = area.id
  } else if (area || page.name === 'sector') {
    // 只有一個區域的大區域用大區域頁當作那一區
    list = data.dataset.areas.flatMap((a) =>
      a.sectors.length === 1
        ? [{ id: a.id, hash: href.area(a.id), name: a.name }]
        : a.sectors.map((s) => ({ id: s.id, hash: href.sector(s.id), name: s.name })),
    )
    current = area ? area.id : (page as { id: string }).id
  } else {
    return undefined
  }

  const at = list.findIndex((x) => x.id === current)
  if (at < 0) return undefined
  const pick = (i: number) => (list[i] ? { hash: list[i].hash, name: list[i].name } : undefined)
  return { prev: pick(at - 1), next: pick(at + 1) }
}

/** 螢幕左右邊緣這個寬度內起滑的不算：留給 iOS／Android 的「返回」手勢 */
const EDGE = 24

/**
 * 判斷一次觸控是不是左右滑動：水平距離夠長、明顯比垂直距離大、時間夠短。
 * 回傳 next（往左滑，看下一個）、prev（往右滑）或 undefined。
 */
export function classifySwipe(
  start: { x: number; y: number; t: number },
  end: { x: number; y: number; t: number },
  viewportWidth: number,
): 'next' | 'prev' | undefined {
  if (start.x < EDGE || start.x > viewportWidth - EDGE) return undefined
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.5 || end.t - start.t > 700) return undefined
  return dx < 0 ? 'next' : 'prev'
}

/** 從觸控點往上找：在可以橫向捲動的元素（例如 Bolt 表格）或表單欄位裡的滑動，留給該元素 */
function insideHorizontalScroller(target: EventTarget | null): boolean {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, textarea, select')) return true
    if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

/** 在整個頁面監聽左右滑動；enabled 為 false（例如電腦版）時不監聽 */
export function useSwipe(enabled: boolean, onSwipe: (dir: 'next' | 'prev') => void): void {
  const handler = useRef(onSwipe)
  handler.current = onSwipe
  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number; t: number } | undefined
    const onStart = (e: TouchEvent) => {
      const p = e.touches[0]
      start = e.touches.length === 1 && !insideHorizontalScroller(e.target) ? { x: p.clientX, y: p.clientY, t: e.timeStamp } : undefined
    }
    const onEnd = (e: TouchEvent) => {
      if (!start) return
      const p = e.changedTouches[0]
      const dir = classifySwipe(start, { x: p.clientX, y: p.clientY, t: e.timeStamp }, window.innerWidth)
      start = undefined
      if (dir) handler.current(dir)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [enabled])
}
