import { describe, expect, it } from 'vitest'
import { currentText, decodeTextEdits, textTarget } from '../src/edit/textEdits'

describe('說明修改', () => {
  it('對象：大區域 key、路線 ID（資料庫的 key 不能有 /）', () => {
    expect(textTarget.area('school-gate')).toBe('area:school-gate')
    expect(textTarget.route('longdong/jar2yu')).toBe('route:longdong:jar2yu')
  })

  it('版本依建立時間由舊到新；顯示最新的那一版', () => {
    const versions = decodeTextEdits({ 'area:school-gate': { b: { uid: 'bob', createdAt: 2, text: '新' }, a: { uid: 'alice', createdAt: 1, text: '舊' } } })['area:school-gate']
    expect(versions.map((v) => v.text)).toEqual(['舊', '新'])
    expect(currentText(versions)?.text).toBe('新')
  })

  it('最新版本是空白（改回原文）或沒有版本時，不顯示修改', () => {
    expect(currentText([{ id: 'a', uid: 'a', createdAt: 1, text: '有內容' }, { id: 'b', uid: 'b', createdAt: 2, text: '  ' }])).toBeUndefined()
    expect(currentText(undefined)).toBeUndefined()
  })
})
