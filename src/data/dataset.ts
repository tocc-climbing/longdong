import { useEffect, useState } from 'react'
import type { Area, Dataset, Route, Sector } from './schema'

export interface RouteRef {
  route: Route
  sector: Sector
  area: Area
}

export interface LoadedData {
  dataset: Dataset
  routes: RouteRef[]
  routeById: Map<string, RouteRef>
  areaById: Map<string, Area>
  sectorById: Map<string, { sector: Sector; area: Area }>
  hardwareByCode: Map<string, string>
}

export function indexDataset(dataset: Dataset): LoadedData {
  const routes: RouteRef[] = []
  for (const area of dataset.areas)
    for (const sector of area.sectors) for (const route of sector.routes) routes.push({ route, sector, area })
  return {
    dataset,
    routes,
    routeById: new Map(routes.map((r) => [r.route.id, r])),
    areaById: new Map(dataset.areas.map((a) => [a.id, a])),
    sectorById: new Map(dataset.areas.flatMap((area) => area.sectors.map((sector) => [sector.id, { sector, area }] as const))),
    hardwareByCode: new Map(dataset.hardware.map((h) => [h.code, h.description])),
  }
}

let cache: Promise<LoadedData> | undefined

/** 資料檔由 Service Worker 預先快取，離線時也從快取讀取 */
function load(): Promise<LoadedData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/longdong.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<Dataset>
    })
    .then(indexDataset)
    .catch((err) => {
      cache = undefined
      throw err
    })
  return cache
}

export type DataState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: LoadedData }

export function useData(): DataState {
  const [state, setState] = useState<DataState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    load().then(
      (data) => alive && setState({ status: 'ready', data }),
      (err: Error) => alive && setState({ status: 'error', error: err.message }),
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}
