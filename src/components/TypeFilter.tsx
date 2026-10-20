import type { RouteType } from '../data/schema'
import { useLang } from '../i18n'
import { toggle } from '../listView'

/** 路線種類，依路線數由多到少 */
export const ROUTE_TYPES: RouteType[] = ['trad', 'sport', 'toprope', 'boulder', 'mixed']

/** 路線種類的篩選膠囊（可複選，都不選為全部）：區域頁、搜尋、路線清單共用 */
export function TypeFilter({ value, onChange }: { value: RouteType[]; onChange: (types: RouteType[]) => void }) {
  const { t } = useLang()
  return (
    <>
      {ROUTE_TYPES.map((type) => (
        <button key={type} type="button" className="chip" aria-pressed={value.includes(type)} onClick={() => onChange(toggle(value, type))}>
          {t(`type.${type}`)}
        </button>
      ))}
    </>
  )
}
