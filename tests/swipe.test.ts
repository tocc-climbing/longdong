import { describe, expect, it } from 'vitest'
import { classifySwipe, neighbors } from '../src/swipe'

// 大區域 A 有兩個區域（a1、a2），B 只有一個區域，C 有兩個區域（c1、c2）
const sector = (id: string) => ({ id, name: { zh: id }, routes: [] })
const A = { id: 'A', name: { zh: 'A' }, sectors: [sector('a1'), sector('a2')] }
const B = { id: 'B', name: { zh: 'B' }, sectors: [sector('b1')] }
const C = { id: 'C', name: { zh: 'C' }, sectors: [sector('c1'), sector('c2')] }
// 路線：a2 有 r1、r2，b1 有 r3
const route = (id: string, number: string) => ({ id, number, name: { zh: id } })
const routes = [
  { route: route('r1', '1'), sector: A.sectors[1], area: A },
  { route: route('r2', '2'), sector: A.sectors[1], area: A },
  { route: route('r3', '3'), sector: B.sectors[0], area: B },
]
const data = {
  dataset: { areas: [A, B, C] },
  areaById: new Map([['A', A], ['B', B], ['C', C]]),
  sectorById: new Map(),
  routes,
} as unknown as Parameters<typeof neighbors>[1]

const hashes = (n: ReturnType<typeof neighbors>) => [n?.prev?.hash, n?.next?.hash]

describe('左右滑動的上一區／下一區', () => {
  it('區域頁：依序走過整個岩場，跨大區域時接下一個大區域', () => {
    expect(hashes(neighbors({ name: 'sector', id: 'a1' }, data))).toEqual([undefined, '#/sector/a2'])
    // 只有一個區域的大區域用大區域頁代表
    expect(hashes(neighbors({ name: 'sector', id: 'a2' }, data))).toEqual(['#/sector/a1', '#/area/B'])
    expect(hashes(neighbors({ name: 'area', id: 'B' }, data))).toEqual(['#/sector/a2', '#/sector/c1'])
    expect(hashes(neighbors({ name: 'sector', id: 'c2' }, data))).toEqual(['#/sector/c1', undefined])
  })

  it('有多個區域的大區域頁：切換大區域', () => {
    expect(hashes(neighbors({ name: 'area', id: 'A' }, data))).toEqual([undefined, '#/area/B'])
    expect(hashes(neighbors({ name: 'area', id: 'C' }, data))).toEqual(['#/area/B', undefined])
  })

  it('路線頁：依序切換路線，跨區域時標出區域名稱', () => {
    expect(neighbors({ name: 'route', id: 'r1' }, data)).toEqual({
      kind: 'route',
      prev: undefined,
      next: { hash: '#/route/r2', name: { zh: 'r2' }, number: '2', sector: undefined },
    })
    expect(neighbors({ name: 'route', id: 'r2' }, data)?.next).toEqual({ hash: '#/route/r3', name: { zh: 'r3' }, number: '3', sector: { zh: 'b1' } })
    expect(neighbors({ name: 'route', id: 'r3' }, data)?.next).toBeUndefined()
  })

  it('其他頁面不切換', () => {
    expect(neighbors({ name: 'home' }, data)).toBeUndefined()
    expect(neighbors({ name: 'route', id: 'x' }, data)).toBeUndefined()
    expect(neighbors({ name: 'search', q: '' }, data)).toBeUndefined()
  })
})

describe('判斷左右滑動', () => {
  const at = (x: number, y = 300, t = 0) => ({ x, y, t })
  it('往左滑看下一區、往右滑看上一區', () => {
    expect(classifySwipe(at(300), at(150, 310, 200), 390)).toBe('next')
    expect(classifySwipe(at(100), at(250, 290, 200), 390)).toBe('prev')
  })

  it('太短、太斜、太慢都不算', () => {
    expect(classifySwipe(at(200), at(160, 300, 100), 390)).toBeUndefined()
    expect(classifySwipe(at(300), at(150, 400, 200), 390)).toBeUndefined()
    expect(classifySwipe(at(300), at(150, 300, 900), 390)).toBeUndefined()
  })

  it('從螢幕邊緣起滑的留給系統的返回手勢', () => {
    expect(classifySwipe(at(10), at(200, 300, 200), 390)).toBeUndefined()
    expect(classifySwipe(at(380), at(200, 300, 200), 390)).toBeUndefined()
  })
})
