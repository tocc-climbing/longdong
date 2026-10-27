import { describe, expect, it } from 'vitest'
import type { EditItem } from '../src/edit/Catalog'
import { itemProgress, topoProgress } from '../src/edit/progress'

const item = (kind: EditItem['kind'], id: string, edited: boolean): EditItem => ({ kind, id, label: id, path: [], edited })

describe('itemProgress（地圖、說明的完成度）', () => {
  it('只算指定種類，已修改的才算完成', () => {
    const items = [item('map', 'a', true), item('map', 'b', false), item('text', 'c', true), item('topo', 'd', true)]
    expect(itemProgress(items, 'map')).toEqual({ done: 1, total: 2 })
    expect(itemProgress(items, 'text')).toEqual({ done: 1, total: 1 })
  })
})

describe('topoProgress（Topo 的完成度：畫了線段的路線）', () => {
  const routes = ['r1', 'r2', 'r3']
  it('有線段才算；只有 bolt 或不在路線清單裡的不算', () => {
    const marks = [
      {
        r1: {
          line: [
            [0, 0],
            [1, 1],
          ] as [number, number][],
        },
        r2: { bolts: { B1: [0, 0] as [number, number] } },
        other: {
          line: [
            [0, 0],
            [1, 1],
          ] as [number, number][],
        },
      },
    ]
    expect(topoProgress(routes, marks)).toEqual({ done: 1, total: 3 })
  })
  it('同一條路線在兩張照片上都有線段，只算一次', () => {
    const line = [
      [0, 0],
      [1, 1],
    ] as [number, number][]
    expect(topoProgress(routes, [{ r1: { line } }, { r1: { line }, r3: { line } }])).toEqual({ done: 2, total: 3 })
  })
})
