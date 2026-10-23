import { describe, expect, it } from 'vitest'
import { geoLocator, type GeoState } from '../src/components/MyLocation'

/** 假的 navigator.geolocation：記下開始、停止定位的次數，由測試送出位置或錯誤 */
function fakeGeolocation() {
  const calls = { watch: 0, clear: 0 }
  let success: PositionCallback = () => {}
  let failure: PositionErrorCallback = () => {}
  const geolocation = {
    watchPosition: (ok: PositionCallback, err: PositionErrorCallback) => {
      calls.watch++
      success = ok
      failure = err
      return calls.watch
    },
    clearWatch: () => {
      calls.clear++
    },
  } as unknown as Geolocation
  const fix = (latitude: number, longitude: number) =>
    success({ coords: { latitude, longitude, accuracy: 8 }, timestamp: 1000 } as GeolocationPosition)
  const fail = (code: number) => failure({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
  return { geolocation, calls, fix, fail }
}

describe('定位', () => {
  it('已有位置時再按定位（救援頁地圖的「回到我的位置」）不重新開始、不丟掉目前的位置', () => {
    const fake = fakeGeolocation()
    const states: GeoState[] = []
    const locator = geoLocator(fake.geolocation, (s) => states.push(s))
    locator.start()
    fake.fix(25.1067, 121.922483)
    locator.start()
    expect(fake.calls).toEqual({ watch: 1, clear: 0 })
    expect(states.map((s) => s.status)).toEqual(['locating', 'ok'])
  })

  it('定位中再按也不重新開始', () => {
    const fake = fakeGeolocation()
    const locator = geoLocator(fake.geolocation, () => {})
    locator.start()
    locator.start()
    expect(fake.calls).toEqual({ watch: 1, clear: 0 })
  })

  it('失敗後再按：重新開始定位', () => {
    const fake = fakeGeolocation()
    const states: GeoState[] = []
    const locator = geoLocator(fake.geolocation, (s) => states.push(s))
    locator.start()
    fake.fail(3)
    locator.start()
    expect(fake.calls).toEqual({ watch: 2, clear: 1 })
    expect(states).toEqual([{ status: 'locating' }, { status: 'error', code: 'timeout' }, { status: 'locating' }])
  })
})
