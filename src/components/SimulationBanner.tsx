import { formatCoords } from '../data/rescue'
import { useLang } from '../i18n'
import { setSimulation, useSimulation } from '../simulate'

/** 模擬位置時（/map@緯度,經度）畫面上方的提示：座標與「結束模擬」；這時的回報不會送出 */
export function SimulationBanner() {
  const { t } = useLang()
  const at = useSimulation()
  if (!at) return null
  return (
    <div className="sim-banner" role="status">
      <span>
        {t('sim.banner', { coords: formatCoords(at) })} · {t('sim.notSent')}
      </span>
      <button type="button" className="link-button" onClick={() => setSimulation(undefined)}>
        {t('sim.stop')}
      </button>
    </div>
  )
}
