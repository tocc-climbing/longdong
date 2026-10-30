import { describe, expect, it } from 'vitest'
import { activeTab } from '../src/components/BottomNav'

describe('底部分頁', () => {
  it('搜尋是自己的分頁；救援頁（從頂欄進入）不標示任何分頁', () => {
    expect(activeTab({ name: 'search', q: '' })).toBe('search')
    expect(activeTab({ name: 'rescue' })).toBeUndefined()
    expect(activeTab({ name: 'home' })).toBe('crags')
    expect(activeTab({ name: 'about' })).toBe('me')
  })
})
