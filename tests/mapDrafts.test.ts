import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatLng } from '../src/geo'
import type { MapShapes } from '../src/map/shapes'

const A: LatLng[] = [[25.1127, 121.9214], [25.1128, 121.9216], [25.1126, 121.9215]]
const B: LatLng[] = [[25.11, 121.92], [25.111, 121.921], [25.112, 121.92]]
const BASE: MapShapes = { areas: { 'school-gate': [A] }, sectors: [{ id: 'sector:longdong:s1#0', sector: 'longdong/s1', ring: A }], walls: {}, lines: {}, versions: {} }

// 提交要登入、寫資料庫：以假的 addMapEdit 與 REST 讀取代替，檢查的是「寫了什麼、讀回什麼、草稿剩什麼」
const added: [string, string][] = []
let failOn: string | undefined
let readBack: Record<string, Record<string, { uid: string; createdAt: number; rings: string }>> = {}
vi.mock('../src/personal/sync', () => ({
  withCloud: async () => ({
    uid: 'u1',
    m: {
      addMapEdit: async (_uid: string, target: string, value: { rings?: string; lines?: string }) => {
        if (target === failOn) throw new Error('PERMISSION_DENIED')
        const id = `v${added.length + 1}`
        added.push([target, id])
        readBack[target] = { ...readBack[target], [id]: { uid: 'u1', createdAt: added.length, rings: value.rings ?? value.lines ?? '' } }
        return id
      },
    },
  }),
}))

const drafts = () => import('../src/edit/mapDrafts')

beforeEach(() => {
  added.length = 0
  failOn = undefined
  readBack = {}
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => readBack }))
})
afterEach(async () => {
  ;(await drafts()).discardDrafts()
  vi.unstubAllGlobals()
})

describe('地圖草稿', () => {
  it('套用：大區域、分區範圍、岩壁、步道各取代對應的形狀；沒改過的草稿不套', async () => {
    const { applyDrafts, changeDraft, undoDraft } = await drafts()
    changeDraft('area:school-gate', [A], () => [B])
    changeDraft('sector:longdong:s1', [A], () => [B, B])
    changeDraft('wall:longdong:s1', [], () => [[B[0], B[1]]])
    changeDraft('trails', [], () => [[B[0], B[1]]])
    changeDraft('area:clocktower', [A], () => [B])
    undoDraft('area:clocktower')
    const out = applyDrafts(BASE, getState(await drafts()).drafts)
    expect(out.areas['school-gate']).toEqual([B])
    expect(out.areas.clocktower).toBeUndefined()
    expect(out.sectors.filter((s) => s.sector === 'longdong/s1').map((s) => s.ring)).toEqual([B, B])
    expect(out.walls['longdong/s1']).toEqual([[B[0], B[1]]])
    expect(out.lines.trails).toEqual([[B[0], B[1]]])
  })

  it('刪光的形狀不會留下舊的：分區範圍的草稿是空的時，地圖上沒有這個分區的範圍', async () => {
    const { applyDrafts, changeDraft } = await drafts()
    changeDraft('sector:longdong:s1', [A], () => [])
    expect(applyDrafts(BASE, getState(await drafts()).drafts).sectors).toEqual([])
  })

  it('復原到原樣：不算有修改', async () => {
    const { changeDraft, undoDraft, changedTargets } = await drafts()
    changeDraft('area:school-gate', [A], () => [B])
    expect(changedTargets(getState(await drafts()).drafts)).toEqual(['area:school-gate'])
    undoDraft('area:school-gate')
    expect(changedTargets(getState(await drafts()).drafts)).toEqual([])
  })

  it('全部提交：每項各寫一個版本，讀回之後草稿清空', async () => {
    const { changeDraft, submitDrafts, changedTargets } = await drafts()
    changeDraft('area:school-gate', [A], () => [B])
    changeDraft('area:clocktower', [A], () => [B])
    const r = await submitDrafts()
    expect(added.map(([t]) => t).sort()).toEqual(['area:clocktower', 'area:school-gate'])
    expect(r).toMatchObject({ submitted: 2, failed: 0, unsynced: false })
    expect(changedTargets(getState(await drafts()).drafts)).toEqual([])
  })

  it('其中一項失敗：成功的清掉，失敗的保留草稿與原因，再按一次只重送失敗的', async () => {
    const { changeDraft, submitDrafts, changedTargets } = await drafts()
    changeDraft('area:school-gate', [A], () => [B])
    changeDraft('area:clocktower', [A], () => [B])
    failOn = 'area:clocktower'
    const r = await submitDrafts()
    expect(r).toMatchObject({ submitted: 1, failed: 1 })
    expect(changedTargets(getState(await drafts()).drafts)).toEqual(['area:clocktower'])
    expect(getState(await drafts()).errors['area:clocktower']).toContain('PERMISSION_DENIED')
    failOn = undefined
    added.length = 0
    await submitDrafts()
    expect(added.map(([t]) => t)).toEqual(['area:clocktower'])
  })

  it('寫入了但讀回的資料沒有新版本：回報沒同步', async () => {
    const { changeDraft, submitDrafts } = await drafts()
    changeDraft('area:school-gate', [A], () => [B])
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({}) }))
    expect((await submitDrafts()).unsynced).toBe(true)
  })

  it('提交中不能再修改', async () => {
    const { changeDraft, submitDrafts, changedTargets } = await drafts()
    changeDraft('area:school-gate', [A], () => [B])
    const submitting = submitDrafts()
    changeDraft('area:clocktower', [A], () => [B])
    await submitting
    expect(added.map(([t]) => t)).toEqual(['area:school-gate'])
    expect(changedTargets(getState(await drafts()).drafts)).toEqual([])
  })

  it('大區域刪光了不能提交（至少要有一塊），整批都不寫', async () => {
    const { changeDraft, canSubmitDraft } = await drafts()
    changeDraft('area:school-gate', [A], () => [])
    const d = getState(await drafts()).drafts['area:school-gate']
    expect(canSubmitDraft('area:school-gate', d)).toBe(false)
    expect(canSubmitDraft('sector:longdong:s1', d)).toBe(true)
  })
})

/** useDrafts 是 React hook：測試直接讀存放區的目前內容 */
function getState(m: Awaited<ReturnType<typeof drafts>>) {
  return m.draftsSnapshot()
}
