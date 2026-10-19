import type { LoadedData } from '../data/dataset'
import type { LatLng } from '../geo'
import { useLang } from '../i18n'
import { areaNames, useScaleMap } from './mapData'
import { ScaleMap, type MapFocus } from './ScaleMap'

interface Props {
  data: LoadedData
  focus?: MapFocus
  selected?: number
  here?: { coords: LatLng; accuracy: number }
  onLocate: () => void
  onPointPress: (no: number) => void
}

/**
 * 救援頁的地圖（取代原本的救援資訊圖圖片）：可聚焦在某個大區域或救援點，點救援點看座標。
 * 跟著地圖分開打包，打開救援頁時才載入；地圖資料在離線快取裡。
 */
export default function RescueMap({ data, focus, selected, here, onLocate, onPointPress }: Props) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  return (
    <div className="rescue-map" data-noswipe>
      {map.status === 'ok' ? (
        <ScaleMap map={map.data} areaNames={areaNames(data, lang)} marks={[]} here={here} focus={focus} selected={selected} onLocate={onLocate} onPointPress={onPointPress} />
      ) : (
        <p className={map.status === 'error' ? 'small error map-status' : 'muted small map-status'} role={map.status === 'error' ? 'alert' : 'status'}>
          {map.status === 'error' ? t('map.loadFailed', { error: map.message }) : t('app.loading')}
        </p>
      )}
    </div>
  )
}
