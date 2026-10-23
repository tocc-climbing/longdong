import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findSector, indexDataset } from '../src/data/dataset'
import { Dataset } from '../src/data/schema'

// 匯入時已以 schema 驗證；這裡防的是「改了 schema 卻沒重新匯入」——repo 裡的資料檔必須符合目前的程式
describe('public/data/longdong.json', () => {
  it('符合目前的資料格式', () => {
    const raw = JSON.parse(readFileSync(new URL('../public/data/longdong.json', import.meta.url), 'utf8'))
    expect(() => Dataset.parse(raw)).not.toThrow()
  })
})

// 突變：findSector 不查舊 ID 對照時，舊的現場回報（target.sectorId 為依位置編號的舊 ID）對不到分區
describe('findSector', () => {
  const data = indexDataset(Dataset.parse(JSON.parse(readFileSync(new URL('../public/data/longdong.json', import.meta.url), 'utf8'))))
  const [old, id] = Object.entries(JSON.parse(readFileSync(new URL('../scripts/data/legacy-sector-ids.json', import.meta.url), 'utf8')) as Record<string, string>)[0]

  it('現在的 ID 與以前依位置編號的舊 ID 都找得到同一個分區', () => {
    expect(findSector(data, id)?.sector.id).toBe(id)
    expect(findSector(data, old)?.sector.id).toBe(id)
  })

  it('都對不到時回傳 undefined', () => {
    expect(findSector(data, 'longdong/back-door-s99')).toBeUndefined()
  })
})
