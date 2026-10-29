import { useEffect, useMemo, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import type { ScaleMapData } from '../map/mapData'
import { decodePins, mergePins, pinsForArea, type PinGroup, type ReportPin } from '../map/reportPins'
import { sectorOf, type EditTarget } from '../map/shapes'
import { useCloud, withCloud } from '../personal/sync'

let loading: Promise<ReportPin[]> | undefined

/** 回報的去識別副本（位置與說明，沒有是誰、什麼時候）：整個頁面只讀一次 */
function loadPins(): Promise<ReportPin[]> {
  loading ??= withCloud()
    .then(({ m }) => m.loadReportPins())
    .then(decodePins)
    .catch((err: Error) => {
      loading = undefined
      console.warn('reportPins', err)
      return []
    })
  return loading
}

/**
 * 修改區域範圍、分區的岩壁時，所在大區的回報（登入才讀得到）：同一個點附近的合併成一個（有幾筆、相同的說明各幾筆），
 * 畫在地圖上、列在右側面板，給修改的人參考。沒有要修改這些（步道、說明）或沒登入時是空的。
 */
export function useReportPins(args?: { target: EditTarget; data: LoadedData; map?: ScaleMapData }): PinGroup[] {
  const signedIn = useCloud().status === 'signed-in'
  const [all, setAll] = useState<ReportPin[]>([])
  const enabled = signedIn && !!args
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void loadPins().then((pins) => alive && setAll(pins))
    return () => {
      alive = false
    }
  }, [enabled])
  const target = args?.target
  const data = args?.data
  const map = args?.map
  return useMemo(() => {
    if (!enabled || !target || !data) return []
    const sectorId = target.startsWith('wall:') ? sectorOf(target) : undefined
    const key = sectorId ? data.sectorById.get(sectorId)?.area.id.split('/').pop() : target.startsWith('area:') ? target.slice('area:'.length) : undefined
    if (!key) return []
    return mergePins(pinsForArea(all, { key, rings: map?.areas.find((a) => a.id === key)?.rings ?? [] }))
  }, [enabled, all, target, data, map])
}
