import { useRef, type MouseEvent, type PointerEvent } from 'react'

/**
 * 左右滑的手勢（路線清單的地圖、清單切換區域）：水平滑超過 threshold 像素、且比垂直移動多才算。
 * onSwipe(1)：往左滑（換到下一個）；onSwipe(-1)：往右滑。
 * 滑動結束時瀏覽器也會送出 click，已經換過就把那次點選擋掉，免得同時點到按鈕。
 * 元素要加上 touch-action: pan-y，上下捲動仍交給瀏覽器。
 */
export function useHorizontalSwipe(onSwipe: (direction: 1 | -1) => void, threshold = 40) {
  const start = useRef<{ x: number; y: number; swiped: boolean }>(undefined)
  return {
    onPointerDown: (e: PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY, swiped: false }
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current
      if (!s) return
      const dx = e.clientX - s.x
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
        s.swiped = true
        onSwipe(dx < 0 ? 1 : -1)
      }
    },
    onClickCapture: (e: MouseEvent) => {
      if (start.current?.swiped) {
        e.stopPropagation()
        e.preventDefault()
        start.current.swiped = false
      }
    },
  }
}
