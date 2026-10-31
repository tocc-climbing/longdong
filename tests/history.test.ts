import { describe, expect, it } from 'vitest'
import { addView } from '../src/personal/history'

describe('addView', () => {
  it('新查的放最前面；同一條路線只留最新的一次', () => {
    const list = addView(addView(addView([], 'a', '1'), 'b', '2'), 'a', '3')
    expect(list).toEqual([
      { routeId: 'a', at: '3' },
      { routeId: 'b', at: '2' },
    ])
  })

  it('最多留 20 筆', () => {
    let list = addView([], 'r0', '0')
    for (let i = 1; i < 25; i++) list = addView(list, `r${i}`, String(i))
    expect(list).toHaveLength(20)
    expect(list[0].routeId).toBe('r24')
  })
})
