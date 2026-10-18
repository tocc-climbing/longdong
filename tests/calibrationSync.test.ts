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
    cloudListeners.clear()
    setCloud('signed-out', false)
  })

  it('沒登入時排隊；登入且連上網路後自動上傳，上傳後不再排隊', async () => {
    const c = await import('../src/calibration')
    c.startCalibrationSync()
    upload.mockResolvedValue()
    c.addMark(mark('鐘塔'))
    await tick()
    expect(upload).not.toHaveBeenCalled()
    expect(JSON.parse(store.get('longdong.calibration')!).queued).toBe(true)

    setCloud('signed-in', true)
    await tick()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(JSON.parse(upload.mock.calls[0][1]).features).toHaveLength(1)
    expect(JSON.parse(store.get('longdong.calibration')!)).toMatchObject({ queued: false, uploaded: { marks: 1 } })
  })

  it('上傳途中又新增的記錄，接著再上傳一次', async () => {
    const c = await import('../src/calibration')
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
    const c = await import('../src/calibration')
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
