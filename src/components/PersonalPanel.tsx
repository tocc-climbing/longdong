import type { Route } from '../data/schema'
import { formatDate } from '../format'
import { useLang } from '../i18n'
import { deleteTick, usePersonal } from '../personal/store'
import { TickSheet } from './TickSheet'

/** 路線頁上我的攀登紀錄（有才顯示）；記錄攀登的視窗由右上的「更多」選單打開（open） */
export function PersonalPanel({ route, open, onClose }: { route: Route; open: boolean; onClose: () => void }) {
  const personal = usePersonal()
  const { t } = useLang()
  if (personal.error) return null
  const ticks = personal.ticks.filter((x) => x.routeId === route.id)

  return (
    <section className="personal">
      <TickSheet route={route} open={open} onClose={onClose} />

      {ticks.length > 0 && (
        <ul className="my-ticks">
          {ticks.map((tick) => (
            <li key={tick.id}>
              <span className="tick-date">{formatDate(tick.date)}</span>
              <span className={`tick-style style-${tick.style}`}>{t(`style.${tick.style}`)}</span>
              {tick.note && <span className="tick-note">{tick.note}</span>}
              <button
                className="link-button"
                aria-label={t('tick.deleteAria')}
                onClick={() => confirm(t('tick.confirmDelete')) && deleteTick(tick.id)}
              >
                {t('tick.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
