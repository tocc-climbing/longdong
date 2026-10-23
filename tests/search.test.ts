import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { indexDataset } from '../src/data/dataset'
import type { Dataset } from '../src/data/schema'
import { searchIndex } from '../src/search'

const data = indexDataset(JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset)

describe('搜尋索引', () => {
  it('同一份資料只建一次索引；另一份資料另外建', () => {
    const index = searchIndex(data)
    expect(searchIndex(data)).toBe(index)
    // 另一份資料（例如更新後重新載入）另外建
    const reloaded = indexDataset(JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset)
    expect(searchIndex(reloaded)).not.toBe(index)
  })
})
