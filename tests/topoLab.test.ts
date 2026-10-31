import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { indexDataset } from '../src/data/dataset'
import type { Dataset } from '../src/data/schema'
import { sameCrop, sameMarks } from '../src/topo/model'
import { initialLabContent, isTapGesture, LAB_PHOTOS, parseLabJson, screenK, serializeLabJson, TAP_MAX_PX } from '../src/topo/topoLab'

const data = indexDataset(JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset)

describe('LAB_PHOTOS：兩張測試 Topo 照片與路線資料對齊', () => {
  it('兩張照片的分區與預設路線都在資料集裡', () => {
    expect(LAB_PHOTOS).toHaveLength(2)
    for (const photo of LAB_PHOTOS) {
      const found = data.sectorById.get(photo.sector)
      expect(found).toBeDefined()
      const routeIds = new Set(found!.sector.routes.map((r) => r.id))
      const initial = initialLabContent(photo.id)
      expect(Object.keys(initial.marks).length).toBeGreaterThan(0)
      for (const id of Object.keys(initial.marks)) {
        expect(routeIds.has(id)).toBe(true)
      }
    }
  })
})

describe('isTapGesture：單指點擊與平移、雙指縮放互不衝突', () => {
  it('未移動或微小抖動（<= TAP_MAX_PX）且單指：判定為點擊', () => {
    expect(isTapGesture({ x: 100, y: 200 }, { x: 100, y: 200 }, false, false)).toBe(true)
    expect(isTapGesture({ x: 100, y: 200 }, { x: 100 + TAP_MAX_PX, y: 200 }, false, false)).toBe(true)
  })

  it('位移超過閾值、已進入拖曳平移、或曾出現第二指（雙指縮放）：一律不觸發點擊', () => {
    expect(isTapGesture({ x: 100, y: 200 }, { x: 100 + TAP_MAX_PX + 1, y: 200 }, false, false)).toBe(false)
    expect(isTapGesture({ x: 100, y: 200 }, { x: 100, y: 200 }, true, false)).toBe(false)
    expect(isTapGesture({ x: 100, y: 200 }, { x: 100, y: 200 }, false, true)).toBe(false)
  })
})

describe('screenK：縮放時維持恆定螢幕線寬與觸控範圍', () => {
  it('隨放大倍率反比縮小 SVG 單位，使螢幕像素尺寸恆定', () => {
    expect(screenK(4, 1)).toBe(4)
    expect(screenK(4, 2)).toBe(2)
    expect(screenK(4, 4)).toBe(1)
  })
})

describe('JSON 儲存與重新載入', () => {
  it('兩張照片的標記與裁切匯出 JSON 後重新載入，座標完全一致', () => {
    for (const photo of LAB_PHOTOS) {
      const initial = initialLabContent(photo.id)
      const json = serializeLabJson(photo.id, initial.marks, initial.crop)
      const reloaded = parseLabJson(json)
      expect(reloaded.photoId).toBe(photo.id)
      expect(reloaded.marks).toEqual(initial.marks)
      expect(sameMarks(reloaded.marks, initial.marks)).toBe(true)
      expect(sameCrop(reloaded.crop, initial.crop)).toBe(true)
    }
  })

  it('格式錯誤或越界座標明確拒絕，不靜默吞掉錯誤', () => {
    expect(() => parseLabJson('not-json')).toThrow('JSON 語法錯誤')
    expect(() => parseLabJson('[]')).toThrow('JSON 必須是物件')
    expect(() => parseLabJson('{}')).toThrow('缺少 routes 欄位')
    expect(() => parseLabJson(JSON.stringify({ routes: { 'longdong:6ns9n4': { line: '100,200' } } }))).toThrow('line 座標不合法')
    expect(() => parseLabJson(JSON.stringify({ routes: { 'longdong:6ns9n4': { line: '100,200 10001,300' } } }))).toThrow('line 座標不合法')
    expect(() => parseLabJson(JSON.stringify({ routes: { 'longdong:6ns9n4': { bolts: { B01: '99999,0' } } } }))).toThrow('bolt B01 座標不合法')
    expect(() => parseLabJson(JSON.stringify({ routes: {}, crop: { x: 0, y: 0, w: 100, h: 100 } }))).toThrow('crop 範圍不合法')
  })
})
