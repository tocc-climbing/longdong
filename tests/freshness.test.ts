import { describe, expect, it } from 'vitest'
import { due } from '../src/freshness'

describe('回到前景時檢查更新的間隔', () => {
  it('從沒檢查過時要檢查；距離上次未滿間隔時不檢查', () => {
    expect(due(1_000, undefined, 60_000)).toBe(true)
    expect(due(30_000, 0, 60_000)).toBe(false)
    expect(due(60_000, 0, 60_000)).toBe(true)
  })
})
