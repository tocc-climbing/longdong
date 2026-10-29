import { useRef, type MouseEvent, type PointerEvent } from 'react'

/** 按住這麼久（毫秒）算長按 */
const LONG_PRESS_MS = 500
/** 按住期間手指移動超過這個距離（像素）就不是長按（在捲動、拖曳） */
const MOVE_PX = 10

/**
 * 長按：按住不動超過 LONG_PRESS_MS 觸發 onLong，放開時不再當作點擊；手指移動（捲動）、放開、取消都不觸發。
 * 回傳的屬性展開在要長按的元素上；觸發後瀏覽器的長按選單不顯示。
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const from = useRef<{ x: number; y: number }>(undefined)
  const fired = useRef(false)
  const clear = () => {
    clearTimeout(timer.current)
    from.current = undefined
  }
  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false
      from.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        onLong()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: PointerEvent) => {
      if (from.current && Math.hypot(e.clientX - from.current.x, e.clientY - from.current.y) > MOVE_PX) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return
      fired.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  }
}
