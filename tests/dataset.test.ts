import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Dataset } from '../src/data/schema'

// 匯入時已以 schema 驗證；這裡防的是「改了 schema 卻沒重新匯入」——repo 裡的資料檔必須符合目前的程式
describe('public/data/longdong.json', () => {
  it('符合目前的資料格式', () => {
    const raw = JSON.parse(readFileSync(new URL('../public/data/longdong.json', import.meta.url), 'utf8'))
    expect(() => Dataset.parse(raw)).not.toThrow()
  })
})
