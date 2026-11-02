import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MapView } from '../../vendor/climbio-format/format'
import { MapViewer, type ViewerOptions } from '../../vendor/climbio-mapkit/index.js'
import type { LoadedData } from '../data/dataset'
import { useLang, type Lang } from '../i18n'
import { kitMapView } from './mapkitView'
import type { LatLng } from '../geo'
import type { ScaleMapData } from './mapData'

/**
 * mapkit 的看圖（src/map/mapkitView.ts 組出 v2 地圖畫面）：React 外殼。
 * 座標對外一律是龍洞的 [緯度, 經度]，對 mapkit 換成 [經度, 緯度]；區域、分區的節點 id 就是區域 ID、分區 ID。
 */

/** 建置時產生的底圖（scripts/gen-kit-base.ts）：只下載一次，各頁的地圖共用 */
let basePromise: Promise<MapView> | undefined
function loadKitBase(): Promise<MapView> {
  basePromise ??= fetch(`${import.meta.env.BASE_URL}rescue/kitbase.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`kitbase.json：${res.status}`)
      return res.json() as Promise<MapView>
    })
    .catch((err) => {
      basePromise = undefined
      throw err
    })
  return basePromise
}

export function useKitBase(): MapView | undefined {
  const [base, setBase] = useState<MapView>()
  useEffect(() => {
    let alive = true
    loadKitBase().then((b) => alive && setBase(b), () => {})
    return () => {
      alive = false
    }
  }, [])
  return base
}

const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat]
const MAPKIT_LANG: Record<Lang, string> = { zh: 'zh', en: 'en', ja: 'ja' }

export interface KitMapMark {
  at: LatLng
  picked?: LatLng
  label?: string
  selected?: boolean
}

/** 聚焦：key 改變時移過去；area（大區域 ID）也讓其他區域變淡 */
export interface KitMapFocus {
  key: string
  area?: string
  coords?: LatLng[]
  tight?: boolean
}

export function KitMap({
  map,
  data,
  marks = [],
  focus,
  ortho,
  topLeft,
  className,
}: {
  map: ScaleMapData
  data: LoadedData
  marks?: KitMapMark[]
  focus?: KitMapFocus
  ortho?: boolean
  topLeft?: ReactNode
  className?: string
}) {
  const { lang, t } = useLang()
  const base = useKitBase()
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<MapViewer>(undefined)
  const view = useMemo(() => base && kitMapView(base, map, data), [base, map, data])
  const options: ViewerOptions = {
    lang: MAPKIT_LANG[lang],
    text: {
      aria: t('map.mapAria'),
      locate: t('map.locate'),
      north: t('map.north'),
      zoomIn: t('rescue.zoomIn'),
      zoomOut: t('rescue.zoomOut'),
      meters: t('myloc.m', { n: '{n}' }),
      hazard: t('map.hazard'),
      boat: t('map.boat'),
      hoist: t('map.hoist'),
      aid: t('map.ems', { n: '{n}' }),
    },
    // 圖形來自 TOCC 救援資訊圖；道路與海岸以 OpenStreetMap 校正（ODbL 要求在地圖上標示）；島礁位置與航照來自國土測繪中心
    attribution: [{ text: `© TOCC · ${t('map.nlscCredit')} ·` }, { text: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' }],
    marks: marks.map((m) => ({ at: lngLat(m.at), ...(m.picked ? { picked: lngLat(m.picked) } : {}), ...(m.label ? { label: m.label } : {}), ...(m.selected ? { selected: true } : {}) })),
    basemap: { ortho: !!ortho },
    ...(focus?.area ? { dim: focus.area } : {}),
  }
  useEffect(() => {
    const v = new MapViewer(host.current!, { ...options, controls: true })
    viewer.current = v
    return () => v.destroy()
  }, [])
  useEffect(() => {
    if (view) viewer.current?.setData({ view })
  }, [view])
  const key = JSON.stringify(options)
  useEffect(() => viewer.current?.set(options), [key])
  // 聚焦：key 改變（或資料第一次到）時移過去
  const focused = useRef<string>(undefined)
  useEffect(() => {
    const v = viewer.current
    if (!v || !view || !focus || focus.key === focused.current) return
    focused.current = focus.key
    v.focus({ ...(focus.area ? { node: focus.area } : {}), points: (focus.coords ?? []).map(lngLat), tight: focus.tight })
  }, [focus?.key, view])
  return (
    <div className={`kit-map${className ? ` ${className}` : ''}`}>
      <div ref={host} className="kit-map-host" />
      {topLeft && <div className="sm-top-left">{topLeft}</div>}
    </div>
  )
}
