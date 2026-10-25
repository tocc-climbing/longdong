import { describe, expect, it } from 'vitest'
import { reportsOf } from '../src/map/uploadedReports'

const feature = (note: string, time: string) => ({ properties: { note, accuracy: 5, time }, geometry: { coordinates: [121.92, 25.11] } })
const upload = (createdAt: number, features: ReturnType<typeof feature>[]) => ({ geojson: JSON.stringify({ features }), createdAt })
const who = (id: string) => id
const place = () => ''

describe('地圖回報的上傳範圍', () => {
  const a = feature('A', '2026-10-01T00:00:00Z')
  const b = feature('B', '2026-10-02T00:00:00Z')
  // 第二次上傳是完整的一份，但使用者已在手機上刪掉 A
  const all = { alice: { u1: upload(1, [a]), u2: upload(2, [b]) } }

  it('latest 只取每人最新一份', () => {
    expect(reportsOf(all, who, place, 'latest').map((r) => r.note)).toEqual(['B'])
  })

  it('all 含舊版上傳，重複的回報只算一次', () => {
    const dup = { alice: { u1: upload(1, [a]), u2: upload(2, [a, b]) } }
    expect(reportsOf(all, who, place, 'all').map((r) => r.note).sort()).toEqual(['A', 'B'])
    expect(reportsOf(dup, who, place, 'all')).toHaveLength(2)
  })
})
