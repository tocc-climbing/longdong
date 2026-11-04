import type { LoadedData } from '../data/dataset'
import { EMS_LOCATIONS, RESCUE_POINTS } from '../data/rescue'
import type { GeoState } from '../components/MyLocation'
import type { LatLng, Whereabouts } from '../geo'
import { useLang } from '../i18n'
import { KitMap, type KitMapFocus } from '../map/KitMap'
import { project, unproject, useScaleMap } from '../map/mapData'

const ALL_COORDS = [...RESCUE_POINTS.flatMap((point) => point.coords ? [point.coords] : []), ...EMS_LOCATIONS.map((ems) => ems.coords)]

/** 自動聚焦至少保留 400 公尺的寬、高，讓附近救援點、器材與步道仍在畫面內。 */
const CONTEXT_SPAN_M = 400

function withContext(coords: LatLng[]): LatLng[] {
  const points = coords.map(project)
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const halfW = Math.max(CONTEXT_SPAN_M, right - left) / 2
  const halfH = Math.max(CONTEXT_SPAN_M, bottom - top) / 2
  return [unproject([cx - halfW, cy - halfH]), unproject([cx + halfW, cy + halfH])]
}

/** 與救援清單同步：可靠的岩場內位置看附近，其他情況看全區。 */
export function RescueMap({ data, geo, nearby, focus }: { data: LoadedData; geo: GeoState; nearby?: Extract<Whereabouts, { kind: 'crag' }>; focus?: KitMapFocus }) {
  const { t } = useLang()
  const map = useScaleMap()
  const here = nearby && geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy } : undefined
  if (map.status !== 'ok') {
    return (
      <p className={map.status === 'error' ? 'small error map-status' : 'muted small map-status'} role={map.status === 'error' ? 'alert' : 'status'}>
        {map.status === 'error' ? t('map.loadFailed', { error: map.message }) : t('app.loading')}
      </p>
    )
  }
  const target = focus ?? (nearby && here ? {
    key: `near:${nearby.point.point.key}:${nearby.ems.point.no}`,
    coords: [here.coords, nearby.point.point.coords, nearby.ems.point.coords],
  } : { key: 'all', coords: ALL_COORDS })
  const coords = target.coords ?? map.data.areas.find((area) => `${data.dataset.crag.id}/${area.id}` === target.area)?.rings.flat().map(unproject)
  return (
    <KitMap
      key={focus?.area ?? (here ? 'near' : 'all')}
      map={map.data}
      data={data}
      here={here}
      marks={focus?.coords?.length === 1 ? [{ at: focus.coords[0], selected: true }] : []}
      walls={false}
      focus={{ ...target, ...(coords?.length ? { coords: withContext(coords) } : {}), tight: false }}
    />
  )
}
