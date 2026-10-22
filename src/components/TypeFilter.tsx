import type { RouteType } from '../data/schema'
import { useLang } from '../i18n'

/** 路線種類，依路線數由多到少 */
export const ROUTE_TYPES: RouteType[] = ['trad', 'sport', 'toprope', 'boulder', 'mixed']

/** 篩選膠囊的分組：上方架繩、抱石的路線很少，合成一個「其他」放在最後 */
const GROUPS: { label: 'type.trad' | 'type.sport' | 'type.mixed' | 'type.other'; types: RouteType[] }[] = [
  { label: 'type.trad', types: ['trad'] },
  { label: 'type.sport', types: ['sport'] },
  { label: 'type.mixed', types: ['mixed'] },
  { label: 'type.other', types: ['toprope', 'boulder'] },
]

/**
 * 路線種類的篩選膠囊（可複選，都不選為全部）：區域頁、搜尋、路線清單、難度金字塔共用；options 為要列出的種類。
 * 「其他」一次選取或取消上方架繩與抱石。
 */
export function TypeFilter({ value, onChange, options = ROUTE_TYPES }: { value: RouteType[]; onChange: (types: RouteType[]) => void; options?: RouteType[] }) {
  const { t } = useLang()
  return (
    <>
      {GROUPS.map(({ label, types }) => {
        const shown = types.filter((type) => options.includes(type))
        if (shown.length === 0) return null
        const on = shown.every((type) => value.includes(type))
        const next = on ? value.filter((type) => !shown.includes(type)) : [...value.filter((type) => !shown.includes(type)), ...shown]
        return (
          <button key={label} type="button" className="chip" aria-pressed={on} onClick={() => onChange(next)}>
            {t(label)}
          </button>
        )
      })}
    </>
  )
}
