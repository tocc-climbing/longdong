import { useLayoutEffect, type RefObject } from 'react'
import { BOUNDS } from './bounds'
import { clampScale, panBy, rotateAt, zoomAt, type MapView, type Size } from './mapView'

/** 按「＋」「－」、雙擊一次縮放的倍數 */
export const STEP = 2
/** 長按多久（毫秒）、手指移動不超過多少像素，算長按區域 */
const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 12
/** 點一下：放開前移動不超過這個距離、按住不超過這個時間 */
const TAP_SLOP_PX = 8
const TAP_MS = 400
/** 雙指轉動超過這個角度才開始旋轉（弧度），只想縮放時地圖不會跟著歪 */
const ROTATE_START = 0.15

export type Point = { x: number; y: number }

/** 手勢需要的地圖操作；事件只註冊一次，所以從 ref 讀最新的 */
export interface MapGestures {
  /** 套用新的畫面狀態（由地圖限制在縮放與平移範圍內） */
  apply: (next: (v: MapView, f: Size) => MapView) => void
  /** 框內這一點（像素）底下的大區域 key；按下時就決定，之後地圖被手指抖動拖動也不影響 */
  areaAt: (p: Point) => (() => string | undefined) | undefined
  /** 長按（電腦為按右鍵）區域 */
  onAreaPress?: (area: string) => void
  /** 點一下（框內的像素位置），例如點救援點 */
  onTap?: (p: Point) => void
}

/**
 * 地圖的滑鼠與觸控操作，像 Google 地圖：
 * 拖曳平移、雙指縮放與旋轉、滾輪縮放、雙擊放大；長按（電腦按右鍵）區域時呼叫 onAreaPress，點一下呼叫 onTap。
 */
export function useMapGestures(box: RefObject<HTMLDivElement | null>, gestures: RefObject<MapGestures>) {
  useLayoutEffect(() => {
    const el = box.current!
    const apply: MapGestures['apply'] = (next) => gestures.current.apply(next)
    // 拖曳平移；雙指縮放與旋轉：記下每根手指的位置，每次移動和上一次比較
    const pointers = new Map<number, Point>()
    /** 這次雙指操作累積轉了多少；超過 ROTATE_START 才開始旋轉 */
    let twist = 0
    let rotating = false
    const local = (e: MouseEvent): Point => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const pair = () => {
      const [a, b] = [...pointers.values()]
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    const pressArea = (p: Point) => {
      const id = gestures.current.areaAt(p)?.()
      if (id) gestures.current.onAreaPress?.(id)
    }

    // 長按：一根手指按住不動 LONG_PRESS_MS 就震一下，放開時才換頁。
    // 若按住時就換頁，放開手指時手機補的一次點擊會落在新頁面的同一個位置（例如分區清單）；
    // 放開時地圖還在，可以在 touchend 擋掉這次點擊。移動、第二根手指都取消。
    // 按住時手指的小抖動會拖動地圖，所以按下時就記下手指底下的地圖位置，判斷區域用它，不用之後的螢幕位置
    let press: { timer: number; at: Point } | undefined
    let held: { id: string; at: Point } | undefined
    /** 一根手指（或滑鼠左鍵）按下，還沒移動：放開時算點一下 */
    let tap: { id: number; at: Point; time: number } | undefined
    const cancelPress = () => {
      if (press) clearTimeout(press.timer)
      press = undefined
    }

    /** 地圖上的按鈕、連結、資訊框照常操作，不拖動地圖 */
    const onControl = (e: Event) => !!(e.target as Element).closest('button, a, .sm-popup')
    const down = (e: PointerEvent) => {
      if (onControl(e)) return
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, local(e))
      twist = 0
      rotating = false
      cancelPress()
      tap = pointers.size === 1 && e.button === 0 ? { id: e.pointerId, at: local(e), time: e.timeStamp } : undefined
      if (pointers.size === 1 && e.pointerType !== 'mouse') {
        const at = local(e)
        const area = gestures.current.areaAt(at)
        press = {
          at,
          timer: window.setTimeout(() => {
            press = undefined
            const id = area?.()
            if (!id) return
            held = { id, at }
            navigator.vibrate?.(20)
          }, LONG_PRESS_MS),
        }
      }
    }
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      if (pointers.size === 1) {
        const p = local(e)
        if (tap && Math.hypot(p.x - tap.at.x, p.y - tap.at.y) > TAP_SLOP_PX) tap = undefined
        const start = press?.at ?? held?.at
        if (start && Math.hypot(p.x - start.x, p.y - start.y) > LONG_PRESS_SLOP_PX) {
          cancelPress()
          held = undefined
        }
        pointers.set(e.pointerId, p)
        apply((v) => panBy(v, p.x - prev.x, p.y - prev.y))
      } else if (pointers.size === 2) {
        cancelPress()
        held = undefined
        tap = undefined
        const before = pair()
        pointers.set(e.pointerId, local(e))
        const after = pair()
        if (before.dist === 0 || after.dist === 0) return
        // 角度差換到 -π～π，避免跨過 ±180 度時跳一圈
        const turn = Math.atan2(Math.sin(after.angle - before.angle), Math.cos(after.angle - before.angle))
        twist += turn
        if (!rotating && Math.abs(twist) > ROTATE_START) rotating = true
        // 跟著兩指的中點平移，再以中點為準縮放、旋轉
        apply((v, f) => {
          const moved = panBy(v, after.mid.x - before.mid.x, after.mid.y - before.mid.y)
          const zoomed = zoomAt(moved, f, after.mid, clampScale((v.s * before.dist) / after.dist, BOUNDS, f))
          return rotating ? rotateAt(zoomed, f, after.mid, zoomed.r + turn) : zoomed
        })
      }
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      cancelPress()
      if (e.type === 'pointerup' && tap?.id === e.pointerId && !held && e.timeStamp - tap.time <= TAP_MS) gestures.current.onTap?.(tap.at)
      tap = undefined
      if (!held) return
      if (e.type === 'pointerup') {
        const { id } = held
        // 等 touchend 擋掉補的點擊之後再換頁
        setTimeout(() => gestures.current.onAreaPress?.(id), 0)
        // touchend 緊接在 pointerup 之後；held 留給它判斷要不要擋點擊
      } else held = undefined
    }
    const touchend = (e: TouchEvent) => {
      if (!held) return
      held = undefined
      e.preventDefault()
    }
    // 手機長按會跳出系統選單、電腦按右鍵：不顯示選單；電腦的右鍵直接當作長按
    const contextmenu = (e: MouseEvent) => {
      if (onControl(e)) return
      e.preventDefault()
      // 觸控的長按已由計時處理，這裡只處理滑鼠右鍵（Safari 的 contextmenu 沒有 pointerType）
      const type = (e as PointerEvent).pointerType
      if (type ? type === 'mouse' : e.button === 2) pressArea(local(e))
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const at = local(e)
      apply((v, f) => zoomAt(v, f, at, clampScale(v.s * Math.exp(e.deltaY * 0.002), BOUNDS, f)))
    }
    const dblclick = (e: MouseEvent) => {
      if (onControl(e)) return
      const at = local(e)
      apply((v, f) => zoomAt(v, f, at, clampScale(v.s / STEP, BOUNDS, f)))
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('dblclick', dblclick)
    el.addEventListener('contextmenu', contextmenu)
    el.addEventListener('touchend', touchend, { passive: false })
    return () => {
      el.removeEventListener('touchend', touchend)
      cancelPress()
      el.removeEventListener('contextmenu', contextmenu)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('dblclick', dblclick)
    }
    // 只透過 ref 讀最新狀態，註冊一次即可
  }, [box, gestures])
}
