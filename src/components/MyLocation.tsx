import { useEffect, useState } from 'react'
import type { LatLng } from '../geo'
import { SIMULATED_ACCURACY_M, useSimulation } from '../simulate'

export type GeoState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ok'; coords: LatLng; accuracy: number; time: number }
  | { status: 'error'; code: 'denied' | 'unavailable' | 'timeout' | 'unsupported' }

/**
 * 定位的控制（不依賴 React，useGeolocation 用它）：start 開始定位並持續更新；
 * 已在定位或已有位置時不動作（重新開始會丟掉目前的位置，例如地圖的「回到我的位置」），還沒開始或失敗時（重新）開始。
 */
export function geoLocator(geolocation: Geolocation | undefined, onChange: (state: GeoState) => void) {
  let state: GeoState = { status: 'idle' }
  let watch: number | undefined
  const set = (next: GeoState) => {
    state = next
    onChange(next)
  }
  return {
    start() {
      if (state.status === 'locating' || state.status === 'ok') return
      if (!geolocation) return set({ status: 'error', code: 'unsupported' })
      if (watch !== undefined) geolocation.clearWatch(watch)
      set({ status: 'locating' })
      watch = geolocation.watchPosition(
        (pos) => set({ status: 'ok', coords: [pos.coords.latitude, pos.coords.longitude], accuracy: pos.coords.accuracy, time: pos.timestamp }),
        (err) => {
          // 已經有位置時，之後偶爾的逾時或訊號不佳不蓋掉最後一次的座標
          if (state.status === 'ok' && err.code !== err.PERMISSION_DENIED) return
          set({ status: 'error', code: err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable' })
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 },
      )
    },
    stop() {
      if (watch !== undefined) geolocation?.clearWatch(watch)
    },
  }
}

/**
 * 手機 GPS 定位：按下才開始（瀏覽器會先詢問權限），之後持續更新；離開頁面時停止，不在背景耗電。
 * GPS 不需要網路；沒有網路時第一次定位可能較久。模擬位置時（src/simulate.ts）直接回傳模擬的座標。
 */
export function useGeolocation(): [GeoState, () => void] {
  const [state, setState] = useState<GeoState>({ status: 'idle' })
  const [locator] = useState(() => geoLocator('geolocation' in navigator ? navigator.geolocation : undefined, setState))
  const simulated = useSimulation()

  useEffect(() => () => locator.stop(), [locator])

  // 模擬位置（/map@緯度,經度）：不用 GPS，直接回傳模擬的座標
  if (simulated) return [{ status: 'ok', coords: simulated, accuracy: SIMULATED_ACCURACY_M, time: Date.now() }, () => {}]
  return [state, locator.start]
}
