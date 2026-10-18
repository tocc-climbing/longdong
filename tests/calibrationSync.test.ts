import { beforeEach, describe, expect, it, vi } from 'vitest'

// 登入狀態與上傳用假的：測試背景上傳的時機
const cloud = { status: 'signed-out', connected: false }
const cloudListeners = new Set<() => void>()
const upload = vi.fn<(uid: string, geojson: string) => Promise<void>>()
vi.mock('../src/personal/sync', () => ({
  getCloud: () => cloud,
  subscribeCloud: (l: () => void) => (cloudListeners.add(l), () => cloudListeners.delete(l)),
  withCloud: async () => ({ m: { uploadCalibration: upload }, uid: 'alice' }),
}))

// 沒登入時用 REST 上傳
const anonFetch = vi.fn<(url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>>()
globalThis.fetch = anonFetch as unknown as typeof fetch
const net = { onLine: true }
Object.defineProperty(globalThis, 'navigator', { value: net, configurable: true })
globalThis.crypto.randomUUID ??= () => '0f8e2c1a-1234-4abc-8def-0123456789ab'

const store = new Map<string, string>()
globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } as unknown as Storage
globalThis.window = { addEventListener: () => {} } as unknown as Window & typeof globalThis

const setCloud = (status: string, connected: boolean) => {
  Object.assign(cloud, { status, connected })
  cloudListeners.forEach((l) => l())
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const mark = (note: string) => ({ coords: [25.11, 121.92] as [number, number], accuracy: 5, time: 0, note })

describe('回報在背景上傳（不必停在地圖頁）', () => {
  beforeEach(() => {
    vi.resetModules()
    store.clear()
    upload.mockReset()
    anonFetch.mockReset().mockResolvedValue({ ok: true, status: 200 })
    net.onLine = true
    cloudListeners.clear()
    setCloud('loading', false)
  })

  it('登入狀態載入中先排隊；載入完是登入的，用帳號上傳，上傳後不再排隊', async () => {
    const c = await import('../src/map/calibration')
    c.startCalibrationSync()
    upload.mockResolvedValue()
    c.addMark(mark('鐘塔'))
    await tick()
    expect(upload).not.toHaveBeenCalled()
    expect(anonFetch).not.toHaveBeenCalled()
    expect(JSON.parse(store.get('longdong.calibration')!).queued).toBe(true)

    setCloud('signed-in', true)
    await tick()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(anonFetch).not.toHaveBeenCalled()
    expect(JSON.parse(upload.mock.calls[0][1]).features).toHaveLength(1)
    expect(JSON.parse(store.get('longdong.calibration')!)).toMatchObject({ queued: false, uploaded: { marks: 1 } })
  })

  it('沒登入也會上傳：用這台手機的裝置代號，同一台手機每次用同一個代號', async () => {
    const c = await import('../src/map/calibration')
    c.startCalibrationSync()
    setCloud('signed-out', false)
    c.addMark(mark('鐘塔'))
    await tick()
    await tick()
    expect(upload).not.toHaveBeenCalled()
    expect(anonFetch).toHaveBeenCalledTimes(1)
    const [url, init] = anonFetch.mock.calls[0]
    const device = store.get('longdong.device')!
    expect(url).toBe(`https://longdong.firebaseio.com/v2/anonReports/${device}.json`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.createdAt).toEqual({ '.sv': 'timestamp' })
    expect(JSON.parse(body.geojson).features).toHaveLength(1)
    expect(JSON.parse(store.get('longdong.calibration')!)).toMatchObject({ queued: false, uploaded: { marks: 1 } })

    c.addMark(mark('第二洞'))
    await tick()
    await tick()
    expect(anonFetch.mock.calls[1][0]).toBe(url)
  })

  it('沒登入又沒網路時排隊，連上網路後上傳', async () => {
    let online!: () => void
    globalThis.window = { addEventListener: (_: string, l: () => void) => (online = l) } as unknown as Window & typeof globalThis
    const c = await import('../src/map/calibration')
    c.startCalibrationSync()
    setCloud('signed-out', false)
    net.onLine = false
    c.addMark(mark('鐘塔'))
    await tick()
    expect(anonFetch).not.toHaveBeenCalled()

    net.onLine = true
    online()
    await tick()
    await tick()
    expect(anonFetch).toHaveBeenCalledTimes(1)
  })

  it('上傳途中又新增的記錄，接著再上傳一次', async () => {
    const c = await import('../src/map/calibration')
    c.startCalibrationSync()
    setCloud('signed-in', true)
    let release!: () => void
    upload.mockImplementationOnce(() => new Promise<void>((r) => (release = r))).mockResolvedValue()
    c.addMark(mark('第一筆'))
    await tick()
    c.addMark(mark('第二筆'))
    release()
    await tick()
    await tick()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(JSON.parse(upload.mock.calls[1][1]).features).toHaveLength(2)
  })

  it('上傳失敗不馬上重試（不會一直重試），之後連線改變時再試', async () => {
    const c = await import('../src/map/calibration')
    c.startCalibrationSync()
    const events: string[] = []
    c.onCalibrationEvent((e) => events.push(e.kind))
    upload.mockRejectedValueOnce(new Error('network')).mockResolvedValue()
    setCloud('signed-in', true)
    c.addMark(mark('鐘塔'))
    await tick()
    await tick()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['failed'])

    setCloud('signed-in', true)
    await tick()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(events).toEqual(['failed', 'sent'])
  })
})
