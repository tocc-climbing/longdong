import { useEffect, useMemo, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import type { ScaleMapData } from '../map/mapData'
import { decodePins, importUploadedPins, mergePins, pinsForArea, type PinGroup, type ReportPin } from '../map/reportPins'
import { sectorOf, type EditTarget } from '../map/shapes'
import { useIsAdmin } from '../admin'
import { useCloud, withCloud } from '../personal/sync'

let loading: Promise<ReportPin[]> | undefined
let backfilled = false

/**
 * 回報的去識別副本（位置與說明，沒有是誰、什麼時候）：整個頁面只讀一次。
 * 管理員開的時候先把已經上傳、還沒有副本的回報補進去（只有管理員讀得到原本的回報；已經有的略過，每次開啟 App 一次）。
 */
function loadPins(admin: boolean): Promise<ReportPin[]> {
  loading ??= withCloud()
    .then(async ({ m }) => {
      if (admin && !backfilled) {
        backfilled = true
        try {
          await importUploadedPins(await m.loadCalibrationUploads())
        } catch (err) {
          console.warn('reportPins backfill', err)
        }
      }
      return m.loadReportPins()
    })
    .then(decodePins)
    .catch((err: Error) => {
      loading = undefined
      console.warn('reportPins', err)
      return []
    })
  return loading
}

/**
 * 修改區域範圍、分區範圍、岩壁時，這個區域的回報（登入才讀得到）：同一個點附近的合併成一個（有幾筆、相同的說明各幾筆），
 * 畫在地圖上、列在右側面板，給修改的人參考。沒有要修改這些（步道、說明）或沒登入時是空的。
 */
export function useReportPins(args?: { target: EditTarget; data: LoadedData; map?: ScaleMapData }): PinGroup[] {
  const signedIn = useCloud().status === 'signed-in'
  const admin = useIsAdmin()
  const [all, setAll] = useState<ReportPin[]>([])
  const enabled = signedIn && !!args && admin !== undefined
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void loadPins(admin === true).then((pins) => alive && setAll(pins))
    return () => {
      alive = false
    }
  }, [enabled, admin])
  const target = args?.target
  const data = args?.data
  const map = args?.map
  return useMemo(() => {
    if (!enabled || !target || !data) return []
    const sectorId = target.startsWith('sector:') || target.startsWith('wall:') ? sectorOf(target) : undefined
    const key = sectorId ? data.sectorById.get(sectorId)?.area.id.split('/').pop() : target.startsWith('area:') ? target.slice('area:'.length) : undefined
    if (!key) return []
    return mergePins(pinsForArea(all, { key, sectorId, rings: map?.areas.find((a) => a.id === key)?.rings ?? [] }))
  }, [enabled, all, target, data, map])
}
