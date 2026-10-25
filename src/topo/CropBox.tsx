import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { FULL_CROP, moveCrop, resizeCrop, toPoint, type Crop, type Point, type TopoPhoto } from './model'
import { px } from './TopoView'

type Axis = -1 | 0 | 1

/** 八個把手：四個角與四個邊（dx、dy 見 resizeCrop） */
const HANDLES: [Axis, Axis][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
]

/**
 * 裁切框：疊在整張照片上，框外變暗；拖曳框內移動，拖曳邊或角調整大小（把手畫在框內，框貼著照片邊緣時才點得到）。
 * onChange(crop, true) 在每次拖曳開始時呼叫一次（讓呼叫端記下復原點），拖曳中是 onChange(crop)。
 */
export function CropBox({ photo, crop, k, onChange }: { photo: TopoPhoto; crop?: Crop; k: number; onChange: (crop: Crop, start?: boolean) => void }) {
  const c = crop ?? FULL_CROP
  const drag = useRef<{ axis?: [Axis, Axis]; from: Point; start: Crop } | null>(null)
  const [x, y] = px(photo, [c.x, c.y])
  const [w, h] = px(photo, [c.w, c.h])

  const pointAt = (e: ReactPointerEvent<SVGElement>): Point => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    return toPoint((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }
  const down = (e: ReactPointerEvent<SVGElement>, axis?: [Axis, Axis]) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { axis, from: pointAt(e), start: c }
    onChange(c, true)
  }
  const move = (e: ReactPointerEvent<SVGElement>) => {
    const d = drag.current
    if (!d) return
    const p = pointAt(e)
    onChange(d.axis ? resizeCrop(d.start, d.axis[0], d.axis[1], p) : moveCrop(d.start, d.from, p))
  }
  const up = () => {
    drag.current = null
  }

  const size = 12 * k
  return (
    <g className="topo-crop">
      <path className="topo-crop-dim" d={`M0 0H${photo.width}V${photo.height}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`} fillRule="evenodd" />
      <rect className="topo-crop-box" x={x} y={y} width={w} height={h} strokeWidth={2 * k} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
      {HANDLES.map(([dx, dy]) => (
        <rect
          key={`${dx},${dy}`}
          className="topo-crop-handle"
          style={{ cursor: dx && dy ? (dx === dy ? 'nwse-resize' : 'nesw-resize') : dx ? 'ew-resize' : 'ns-resize' }}
          x={x + ((dx + 1) * (w - size)) / 2}
          y={y + ((dy + 1) * (h - size)) / 2}
          width={size}
          height={size}
          strokeWidth={2 * k}
          onPointerDown={(e) => down(e, [dx, dy])}
          onPointerMove={move}
          onPointerUp={up}
        />
      ))}
    </g>
  )
}
