import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapView, Mark } from '../vendor/climbio-format/format'
import { indexDataset } from '../src/data/dataset'
import type { Dataset } from '../src/data/schema'
import { kitMapView } from '../src/map/mapkitView'
import { loadScaleMap } from '../src/map/mapData'
import { KIT_BASE_FILE, kitBase } from '../scripts/gen-kit-base'
import { longdongMap } from '../scripts/lib/climbioMap'

const dataset = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as Dataset
const flat = (m: Mark | undefined): number[] => JSON.stringify(m?.geometry.coordinates ?? []).match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number)

describe('mapkit 的地圖畫面', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('public/rescue/kitbase.json 是最新的（public/rescue 的 geojson 改了要跑 npm run kit-base）', () => {
    expect(JSON.parse(readFileSync(KIT_BASE_FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(kitBase())))
  })

  it('底圖加上 App 的地圖資料：區域、岩壁、頁框裡的線和完整的龍洞地圖一樣（經緯度差不到 1e-6 度）', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(`public${url.replace(/^\/+/, '/')}`, 'utf8')))
    const view = kitMapView(JSON.parse(readFileSync(KIT_BASE_FILE, 'utf8')) as MapView, await loadScaleMap(), indexDataset(dataset))
    const full = longdongMap(dataset)
    const codeOf = (v: MapView, id: string | undefined) => v.nodes?.find((n) => n.id === id)?.props?.code
    const byCode = (v: MapView, type: string) => new Map((v.nodes ?? []).filter((n) => n.type === type).map((n) => [n.props?.code, v.marks!.find((m) => m.node === n.id)]))
    for (const type of ['area', 'sector']) {
      const [mine, theirs] = [byCode(view, type), byCode(full, type)]
      expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort())
      for (const [code, mark] of theirs) {
        const [a, b] = [flat(mine.get(code)), flat(mark)]
        expect(a.length, `${code}`).toBe(b.length)
        expect(Math.max(...a.map((v, i) => Math.abs(v - b[i]))), `${code}`).toBeLessThan(1e-6)
      }
    }
    const lines = (v: MapView) => Object.fromEntries((v.marks ?? []).filter((m) => !m.node && m.props?.source !== 'osm' && ['highway', 'tunnel', 'road', 'trail'].includes(String(m.props?.kind))).map((m) => [m.props!.kind, flat(m)]))
    const [mine, theirs] = [lines(view), lines(full)]
    for (const kind of Object.keys(theirs)) expect(Math.max(...mine[kind].map((v: number, i: number) => Math.abs(v - theirs[kind][i]))), kind).toBeLessThan(1e-6)
    expect(codeOf(view, view.nodes?.find((n) => n.type === 'sector')?.id)).toBeTruthy()
  })
})
