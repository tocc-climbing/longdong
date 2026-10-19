import type { LoadedData } from '../data/dataset'
import type { LatLng } from '../geo'
import { useLang } from '../i18n'
import { areaNames, useScaleMap } from './mapData'
import { ScaleMap, type MapFocus, type MapSelection } from './ScaleMap'

interface Props {
  data: LoadedData
  focus?: MapFocus
  selected?: MapSelection
  here?: { coords: LatLng; accuracy: number }
  onLocate: () => void
  onSelect: (selection: MapSelection) => void
}

/**
 * 救援頁的地圖（取代原本的救援資訊圖圖片）：可聚焦在某個大區域、救援點或急救器材，點救援點或急救器材看詳細資訊。
 * 跟著地圖分開打包，打開救援頁時才載入；地圖資料在離線快取裡。
 */
export default function RescueMap({ data, focus, selected, here, onLocate, onSelect }: Props) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  return (
    <div className="rescue-map" data-noswipe>
      {map.status === 'ok' ? (
        <ScaleMap map={map.data} areaNames={areaNames(data, lang)} marks={[]} here={here} focus={focus} selected={selected} onLocate={onLocate} onSelect={onSelect} />
      ) : (
        <p className={map.status === 'error' ? 'small error map-status' : 'muted small map-status'} role={map.status === 'error' ? 'alert' : 'status'}>
          {map.status === 'error' ? t('map.loadFailed', { error: map.message }) : t('app.loading')}
        </p>
      )}
    </div>
  )
}
