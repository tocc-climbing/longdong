/** 全螢幕 Topo 的縮放與平移。座標以舞台（可視區域）中心為原點，單位是螢幕像素 */

export interface View {
  scale: number
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export const MAX_SCALE = 6

export const IDENTITY: View = { scale: 1, x: 0, y: 0 }

/** 照片（寬高比 aspect）在舞台裡縮到剛好放得下的大小 */
export function fitSize(stage: Size, aspect: number): Size {
  const w = Math.min(stage.w, stage.h * aspect)
  return { w, h: w / aspect }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 縮放限制在 1 到 MAX_SCALE；放大後照片的邊緣不能離開舞台的邊緣，沒放滿舞台的方向置中 */
export function clampView(view: View, stage: Size, content: Size): View {
  const scale = clamp(view.scale, 1, MAX_SCALE)
  const limit = (shown: number, room: number) => Math.max(0, (shown * scale - room) / 2)
  const lx = limit(content.w, stage.w)
  const ly = limit(content.h, stage.h)
  return { scale, x: clamp(view.x, -lx, lx), y: clamp(view.y, -ly, ly) }
}

export interface Pt {
  x: number
  y: number
}

/**
 * 手指從 from 移到 to，兩指距離變成 ratio 倍：照片上原本在 from 的那一點跟著手指走到 to。
 * 單指拖曳就是 ratio 為 1。
 */
export function moveView(view: View, from: Pt, to: Pt, ratio: number, stage: Size, content: Size): View {
  const scale = clamp(view.scale * ratio, 1, MAX_SCALE)
  const f = scale / view.scale
  return clampView({ scale, x: to.x - (from.x - view.x) * f, y: to.y - (from.y - view.y) * f }, stage, content)
}
