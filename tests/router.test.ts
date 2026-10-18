import { describe, expect, it } from 'vitest'
import { href, parseLocation, samePlace, withDetail } from '../src/router'

describe('parseLocation', () => {
  it('ID 可以含 "/"', () => {
    expect(parseLocation('/route/longdong/100.1')).toEqual({ name: 'route', id: 'longdong/100.1' })
    expect(parseLocation('/area/longdong/back-door')).toEqual({ name: 'area', id: 'longdong/back-door' })
    expect(parseLocation('/sector/longdong/back-door-s1')).toEqual({ name: 'sector', id: 'longdong/back-door-s1' })
  })

  it('其他頁面', () => {
    expect(parseLocation('/me')).toEqual({ name: 'me' })
    expect(parseLocation('/search?q=5.12')).toEqual({ name: 'search', q: '5.12' })
    expect(parseLocation('/search')).toEqual({ name: 'search', q: '' })
    expect(parseLocation('/?q=5.12')).toEqual({ name: 'home' })
    expect(parseLocation('')).toEqual({ name: 'home' })
    expect(parseLocation('/')).toEqual({ name: 'home' })
  })

  it('結尾的 / 不影響', () => {
    expect(parseLocation('/route/longdong/jar2yu/')).toEqual({ name: 'route', id: 'longdong/jar2yu' })
  })

  it('?r= 是右側（或手機上直接顯示）的路線', () => {
    expect(parseLocation('/sector/longdong/back-door-s1?r=longdong/100')).toEqual({
      name: 'sector',
      id: 'longdong/back-door-s1',
      detail: 'longdong/100',
    })
    expect(parseLocation('/search?q=%E9%BB%83%E9%87%91&r=longdong/523')).toEqual({ name: 'search', q: '黃金', detail: 'longdong/523' })
    expect(parseLocation('/me?r=longdong/523')).toEqual({ name: 'me', detail: 'longdong/523' })
    // 路線頁本身不帶右側路線
    expect(parseLocation('/route/longdong/1?r=longdong/2')).toEqual({ name: 'route', id: 'longdong/1' })
  })
})

describe('網址都不帶 #', () => {
  it('站內連結是從根目錄開始的路徑', () => {
    expect(href.home()).toBe('/')
    expect(href.route('longdong/jar2yu')).toBe('/route/longdong/jar2yu')
    expect(href.search('5.10', 'longdong/1')).toBe('/search?q=5.10&r=longdong/1')
    expect(href.map()).toBe('/map')
  })
})

describe('withDetail', () => {
  it('加上、替換、拿掉 ?r=，搜尋字串保留', () => {
    expect(withDetail('/sector/longdong/a', 'longdong/1')).toBe('/sector/longdong/a?r=longdong/1')
    expect(withDetail('/sector/longdong/a?r=longdong/1', 'longdong/2')).toBe('/sector/longdong/a?r=longdong/2')
    expect(withDetail('/sector/longdong/a?r=longdong/1', undefined)).toBe('/sector/longdong/a')
    const h = withDetail(href.search('5.10 黃金'), 'longdong/9')
    expect(parseLocation(h)).toEqual({ name: 'search', q: '5.10 黃金', detail: 'longdong/9' })
    expect(parseLocation(withDetail(h, undefined))).toEqual({ name: 'search', q: '5.10 黃金' })
  })
})

describe('samePlace：換頁時要不要捲回頂端', () => {
  it('同一頁只換搜尋字串或右側路線：不捲動', () => {
    expect(samePlace({ name: 'search', q: 'a' }, { name: 'search', q: 'ab' })).toBe(true)
    expect(samePlace({ name: 'sector', id: 's', detail: 'r1' }, { name: 'sector', id: 's', detail: 'r2' })).toBe(true)
  })

  it('從沒有 id 換到有 id 的同名頁面算換頁（/rescue → /rescue/golden-valley）', () => {
    expect(samePlace({ name: 'rescue' }, { name: 'rescue', id: 'golden-valley' })).toBe(false)
    expect(samePlace({ name: 'rescue', id: 'back-door' }, { name: 'rescue', id: 'golden-valley' })).toBe(false)
    expect(samePlace({ name: 'sector', id: 'a' }, { name: 'sector', id: 'b' })).toBe(false)
  })
})
