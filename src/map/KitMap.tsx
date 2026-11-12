import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { MapView } from '../../vendor/climbio-format/format'
import { MapEditor, MapViewer, type EditorOptions, type MapViewInfo } from '../../vendor/climbio-mapkit/index.js'
import type { LoadedData } from '../data/dataset'
import { useLang, type Lang } from '../i18n'
import { inMapBounds } from './bounds'
import { centerPending, type CenterRequest } from './mapView'
import { kitMapView } from './mapkitView'
import './map.css'
import type { LatLng } from '../geo'
import type { ScaleMapData } from './mapData'

/**
 * mapkit 的看圖（src/map/mapkitView.ts 組出 v2 地圖畫面）：React 外殼。
 * 座標對外一律是龍洞的 [緯度, 經度]，對 mapkit 換成 [經度, 緯度]；區域、分區的節點 id 就是區域 ID、分區 ID。
 */

/** 建置時產生的底圖（scripts/gen-kit-base.ts）：只下載一次，各頁的地圖共用 */
let basePromise: Promise<MapView> | undefined
export function loadKitBase(): Promise<MapView> {
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

/** 移到目前位置時最多放大到每像素這麼多公尺 */
const ME_SCALE = 0.5

/**
 * 編輯形狀（管理員）：rings 是正在編輯的多塊多邊形（closed）或多條線段（岩壁、步道）；選中的那塊顯示頂點，
 * 拖曳頂點移動、按邊上的小點加一個頂點、右鍵刪除頂點（多邊形至少三點、線段兩點）；點其他塊選它。草稿與復原由 App 負責。
 */
export interface MapEdit {
  rings: LatLng[][]
  closed: boolean
  selected?: number
  onChange: (rings: LatLng[][]) => void
  /** 一次修改開始（按下頂點、加頂點、刪頂點）：復原以這為一步，拖曳中的每次移動不算 */
  onChangeStart?: () => void
  onSelect: (index: number) => void
  /** 標出線段的右手邊（岩壁面朝向） */
  faces?: boolean
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
  here,
  pick,
  focus,
  selected,
  sectorLabels,
  onWallTap,
  onAreaPress,
  onLocate,
  ortho,
  topo,
  walls = true,
  hide,
  hideAreas,
  edit,
  draft,
  editable,
  topLeft,
  className,
  savedView,
}: {
  map: ScaleMapData
  data: LoadedData
  marks?: KitMapMark[]
  /** 目前位置與誤差（公尺） */
  here?: { coords: LatLng; accuracy: number }
  /** 在地圖上點位置的模式：點一下回傳那裡的經緯度；at 是目前點的位置（圖釘）。這時點到岩壁不算 */
  pick?: { at?: LatLng; onPick: (at: LatLng, metersPerPixel: number) => void }
  focus?: KitMapFocus
  /** 選中的岩壁：分區 ID 與第幾條（標名稱）；沒有 line 是整個分區 */
  selected?: { sector: string; line?: number }
  /** 點到岩壁：分區 ID 與第幾條 */
  onWallTap?: (sector: string, line: number) => void
  /** 長按（電腦為按右鍵）區域：大區域 ID */
  onAreaPress?: (area: string) => void
  /** 有的話顯示「回到我的位置」：還沒定位時由外層開始定位，定位到之後地圖移過去；在範圍外時地圖不動，由外層說明 */
  onLocate?: () => void
  ortho?: boolean
  /** 疊上 1/5000 基本地形圖的等高線與海岸線 */
  topo?: boolean
  /** 畫岩壁（預設 true） */
  walls?: boolean
  /** 不畫的區域、分區（ID） */
  hide?: string[]
  /** 不畫大區域（編輯步道、道路時看得比較清楚） */
  hideAreas?: boolean
  /** 編輯形狀（要 editable） */
  edit?: MapEdit
  /** 正在畫的線：虛線，標出每個點；closed 時還沒閉環也用半透明顯示暫時封閉的區域 */
  draft?: { points: LatLng[]; closed?: boolean }
  /** 編輯用的地圖（mapkit 的 MapEditor；建立時決定） */
  editable?: boolean
  topLeft?: ReactNode
  className?: string
  /** 只標這些分區的名稱（ID） */
  sectorLabels?: boolean | string[]
  savedView?: RefObject<MapViewInfo | undefined>
}) {
  const { lang, t } = useLang()
  const base = useKitBase()
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<MapViewer>(undefined)
  const view = useMemo(() => base && kitMapView(base, map, data), [base, map, data])
  const options: EditorOptions = {
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
    attribution: [{ text: `© TOCC · ${t('map.nlscCredit')}` }, { text: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' }],
    marks: marks.map((m) => ({ at: lngLat(m.at), ...(m.picked ? { picked: lngLat(m.picked) } : {}), ...(m.label ? { label: m.label } : {}), ...(m.selected ? { selected: true } : {}) })),
    basemap: { ortho: !!ortho, contours: !!topo },
    sectorLabels: sectorLabels ?? false,
    walls,
    ...(hide?.length ? { hide } : {}),
    ...(hideAreas ? { hideAreas: true } : {}),
    ...(draft ? { draft: { points: draft.points.map(lngLat), ...(draft.closed ? { closed: true } : {}) } } : {}),
    ...(editable ? { picking: !!pick } : {}),
    ...(focus?.area ? { dim: focus.area } : {}),
    ...(here ? { here: { at: lngLat(here.coords), accuracy: here.accuracy } } : {}),
    ...(pick?.at ? { pin: lngLat(pick.at) } : {}),
    ...(selected ? { selected: { node: selected.sector, ...(selected.line !== undefined ? { line: selected.line } : {}) } } : {}),
  }
  // 事件處理只註冊一次，從這裡讀最新的 props
  const latest = useRef({ pick, onWallTap, onAreaPress, onLocate, here, edit })
  latest.current = { pick, onWallTap, onAreaPress, onLocate, here, edit }

  // 移到目前位置：第一次定位到（在龍洞範圍內）時自動移過去；按了「回到我的位置」但還沒定位時，定位到再移過去。
  // 之後換了聚焦就以聚焦為準（centerPending）
  const centerRequest = useRef<CenterRequest | undefined>(focus || savedView?.current ? undefined : { focus: undefined })
  const goToMe = (at: LatLng) => {
    const v = viewer.current
    const now = v?.getView()
    if (!v || !now) return false
    centerRequest.current = undefined
    v.setView({ center: lngLat(at), metersPerPixel: Math.min(now.metersPerPixel, ME_SCALE), rotation: now.rotation })
    return true
  }

  useEffect(() => {
    const v = editable ? new MapEditor(host.current!, { ...options, controls: true }) : new MapViewer(host.current!, { ...options, controls: true, locate: !!onLocate })
    viewer.current = v
    v.addEventListener('editstart', () => latest.current.edit?.onChangeStart?.())
    v.addEventListener('editchange', (e) => latest.current.edit?.onChange((e as CustomEvent<{ rings: [number, number][][] }>).detail.rings.map((r) => r.map(([lng, lat]): LatLng => [lat, lng]))))
    v.addEventListener('select', (e) => latest.current.edit?.onSelect((e as CustomEvent<{ index: number }>).detail.index))
    v.addEventListener('tap', (e) => {
      const { at, metersPerPixel } = (e as CustomEvent<{ at: [number, number]; metersPerPixel: number }>).detail
      latest.current.pick?.onPick([at[1], at[0]], metersPerPixel)
    })
    v.addEventListener('pick', (e) => {
      const { node, line } = (e as CustomEvent<{ node: string; line: number }>).detail
      if (!latest.current.pick) latest.current.onWallTap?.(node, line)
    })
    v.addEventListener('areapress', (e) => latest.current.onAreaPress?.((e as CustomEvent<{ node: string }>).detail.node))
    v.addEventListener('locate', () => {
      const me = latest.current.here?.coords
      // 在範圍外：移過去只會看到範圍邊緣的空白，地圖不動
      if (me) {
        if (inMapBounds(me)) goToMe(me)
      } else centerRequest.current = { focus: focusKey.current }
      latest.current.onLocate?.()
    })
    return () => { if (savedView) savedView.current = v.getView(); v.destroy() }
  }, [])
  const focusKey = useRef(focus?.key)
  focusKey.current = focus?.key
  useEffect(() => {
    const me = here?.coords
    if (view && me && centerPending(centerRequest.current, focus?.key) && inMapBounds(me)) goToMe(me)
  }, [here?.coords[0], here?.coords[1], view])
  useEffect(() => {
    if (view) {
      const initial = !viewer.current?.getView()
      viewer.current?.setData({ view })
      if (initial && savedView?.current) {
        centerRequest.current = undefined
        viewer.current?.setView(savedView.current)
      }
    }
  }, [view])
  const key = JSON.stringify(options)
  useEffect(() => viewer.current?.set(options), [key])
  // 編輯中的形狀（受控）：App 的草稿變了就交給地圖
  const editKey = JSON.stringify(edit && [edit.rings, edit.closed, edit.selected, edit.faces])
  useEffect(() => {
    const v = viewer.current
    if (v instanceof MapEditor) v.setEdit(edit && { rings: edit.rings.map((r) => r.map(lngLat)), closed: edit.closed, selected: edit.selected, faces: edit.faces })
  }, [editKey, view])
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
