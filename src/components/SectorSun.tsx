import { direction } from '../geo'
import { useLang } from '../i18n'
import { meanFacing, sunWindows, wallFaces } from '../map/aspect'
import { useScaleMap } from '../map/mapData'
import { clock, todayInTaipei } from '../sun'

/** 分區的岩壁朝向與今天的日曬時段（由岩壁的線推算），前面帶分隔的「 · 」；還沒有岩壁（或地圖資料還沒載入）時整段不顯示 */
export function SectorSun({ sector }: { sector: string }) {
  const { t } = useLang()
  const map = useScaleMap()
  const lines = map.status === 'ok' ? map.data.walls[sector] : undefined
  const faces = lines?.flatMap(wallFaces) ?? []
  const facing = meanFacing(faces)
  if (!lines || facing === undefined) return null
  const windows = sunWindows(todayInTaipei(), faces, lines[0][0])
  const times = windows.map((w) => `${clock.format(w.from)}–${clock.format(w.to)}`).join(', ')
  return (
    <span className="sector-sun">
      {' · '}
      {t('sector.facing', { dir: t(`dir.${direction(facing)}`) })} · {windows.length ? t('sector.sun', { times }) : t('sector.noSun')}
    </span>
  )
}
