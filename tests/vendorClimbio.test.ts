import { describe, expect, it } from 'vitest'
import { vendorMismatches } from '../scripts/vendor-climbio'

describe('TopoKit、mapkit 的副本', () => {
  it('和 SOURCE.md 記的 climbio-internal 檔案一致（副本不在龍洞改）', () => {
    expect(vendorMismatches('.')).toEqual([])
  })
})
