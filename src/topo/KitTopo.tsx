import { useEffect, useRef, type CSSProperties } from 'react'
import { TopoViewer, type TopoData, type ViewerOptions } from '../../vendor/climbio-topokit/index.js'
import { TOPO_LOOK } from './look'

/** TopoKit 的看圖：host 的大小由外層決定（className、style）；選項改了只重畫，資料改了才 setData */
export function KitTopo({
  data,
  options,
  onPick,
  onSwipe,
  className,
  style,
  label,
}: {
  data: TopoData
  options: ViewerOptions
  onPick?: (id: string) => void
  /** 左右滑（options.swipe）：1 下一條、-1 上一條 */
  onSwipe?: (step: 1 | -1) => void
  className?: string
  style?: CSSProperties
  label?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<TopoViewer>(undefined)
  const handlers = useRef({ onPick, onSwipe })
  handlers.current = { onPick, onSwipe }
  useEffect(() => {
    const v = new TopoViewer(host.current!, { ...TOPO_LOOK, ...options })
    v.addEventListener('pick', (e) => handlers.current.onPick?.(e.detail.id))
    v.addEventListener('swipe', (e) => handlers.current.onSwipe?.(e.detail.step))
    viewer.current = v
    return () => v.destroy()
    // 建立時的選項；之後由下面的 setOptions 跟上
  }, [])
  // data 要由呼叫的地方 useMemo，才不會每次重畫都 setData（縮放會回到整張）
  useEffect(() => viewer.current?.setData(data), [data])
  const key = JSON.stringify(options)
  useEffect(() => viewer.current?.setOptions(options), [key])
  return <div ref={host} className={className} style={style} role="group" aria-label={label} />
}
