import { describe, expect, it } from 'vitest'
import { defaultLevel, keyNav, type NavInput } from '../src/keyboard'
import type { Page } from '../src/router'

// 大區域 A 有兩個區域（a1、a2），B 只有一個區域（b1）
const sector = (id: string) => ({ id, routes: [] })
const A = { id: 'A', sectors: [sector('a1'), sector('a2')] }
const B = { id: 'B', sectors: [sector('b1')] }
const data = {
  dataset: { areas: [A, B] },
  areaById: new Map([
    ['A', A],
    ['B', B],
  ]),
  sectorById: new Map([
    ['a1', { area: A, sector: A.sectors[0] }],
    ['a2', { area: A, sector: A.sectors[1] }],
    ['b1', { area: B, sector: B.sectors[0] }],
  ]),
  routeById: new Map([['r2', { area: A, sector: A.sectors[1], route: {} }]]),
} as unknown as NavInput['data']

const rows = ['#/sector/a2?r=r1', '#/sector/a2?r=r2', '#/sector/a2?r=r3']
const nav = (key: string, page: Page, level: NavInput['level'], selected = -1) => keyNav(key, { page, level, data, rows, selected })

describe('方向鍵瀏覽', () => {
  it('預設層級：多區域的大區域頁是大區域，其他是路線', () => {
    expect(defaultLevel({ name: 'area', id: 'A' }, data)).toBe('area')
    expect(defaultLevel({ name: 'area', id: 'B' }, data)).toBe('route')
    expect(defaultLevel({ name: 'sector', id: 'a1' }, data)).toBe('route')
  })

  it('路線層級：↑↓ 切換路線，到頭停住', () => {
    const page: Page = { name: 'sector', id: 'a2' }
    expect(nav('ArrowDown', page, 'route')).toEqual({ level: 'route', hash: rows[0], row: 0 })
    expect(nav('ArrowDown', page, 'route', 0)).toEqual({ level: 'route', hash: rows[1], row: 1 })
    expect(nav('ArrowDown', page, 'route', 2)).toEqual({ level: 'route' })
    expect(nav('ArrowUp', page, 'route', 1)).toEqual({ level: 'route', hash: rows[0], row: 0 })
  })

  it('← 往上一層，→ 往下一層', () => {
    const page: Page = { name: 'sector', id: 'a2', detail: 'r2' }
    expect(nav('ArrowLeft', page, 'route', 1)).toEqual({ level: 'sector' })
    expect(nav('ArrowLeft', page, 'sector', 1)).toEqual({ level: 'area' })
    expect(nav('ArrowLeft', page, 'area', 1)).toBeUndefined()
    expect(nav('ArrowRight', page, 'area', 1)).toEqual({ level: 'sector' })
    expect(nav('ArrowRight', page, 'sector', 1)).toEqual({ level: 'route' })
    expect(nav('ArrowRight', page, 'route', 1)).toBeUndefined()
    // 沒選路線時，進到路線層級會選第一條
    expect(nav('ArrowRight', { name: 'sector', id: 'a2' }, 'sector')).toEqual({ level: 'route', hash: rows[0], row: 0 })
  })

  it('區域層級：↑↓ 切換同一個大區域裡的區域', () => {
    expect(nav('ArrowDown', { name: 'sector', id: 'a1' }, 'sector')).toEqual({ level: 'sector', hash: '#/sector/a2' })
    expect(nav('ArrowDown', { name: 'sector', id: 'a2' }, 'sector')).toEqual({ level: 'sector' })
    expect(nav('ArrowUp', { name: 'route', id: 'r2' }, 'sector')).toEqual({ level: 'sector', hash: '#/sector/a1' })
  })

  it('大區域層級：↑↓ 切換大區域；→ 進到第一個區域', () => {
    expect(nav('ArrowDown', { name: 'sector', id: 'a2' }, 'area')).toEqual({ level: 'area', hash: '#/area/B' })
    expect(nav('ArrowUp', { name: 'area', id: 'B' }, 'area')).toEqual({ level: 'area', hash: '#/area/A' })
    expect(nav('ArrowRight', { name: 'area', id: 'A' }, 'area')).toEqual({ level: 'sector', hash: '#/sector/a1' })
  })

  it('只有一個區域的大區域：跳過區域層級', () => {
    const page: Page = { name: 'area', id: 'B', detail: 'x' }
    expect(nav('ArrowLeft', page, 'route', 0)).toEqual({ level: 'area' })
    expect(nav('ArrowRight', { name: 'area', id: 'B' }, 'area')).toEqual({ level: 'route', hash: rows[0], row: 0 })
  })

  it('搜尋、我的：只有 ↑↓ 切換路線', () => {
    const page: Page = { name: 'search', q: '5.10', detail: 'r1' }
    expect(nav('ArrowLeft', page, 'route', 0)).toBeUndefined()
    expect(nav('ArrowDown', page, 'route', 0)).toEqual({ level: 'route', hash: rows[1], row: 1 })
  })
})
