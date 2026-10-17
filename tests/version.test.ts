import { describe, expect, it } from 'vitest'
import { appVersion } from '../scripts/lib/appVersion'
import { formatVersion } from '../src/version'

describe('App 版號', () => {
  it('主.次.提交數，附 commit 短碼與日期', () => {
    const v = appVersion()
    expect(v.version).toMatch(/^1\.0\.\d+$/)
    expect(v.commit).toMatch(/^[0-9a-f]{7}$/)
    expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formatVersion({ version: '1.0.65', commit: '0968ddc', date: '2026-10-17' })).toBe('1.0.65 (0968ddc)')
  })
})
