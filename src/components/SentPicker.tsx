import { useLang } from '../i18n'
import { BEST_STYLES, bestStyle, checklistStyle, isSent } from '../personal/model'
import { setBest, usePersonal } from '../personal/store'
import { SEND_SHORT, type SendStyle } from '../personal/stats'

type Personal = ReturnType<typeof usePersonal>

/** 路線的完攀方式：在清單勾選的（chosen），沒有勾選時是攀登紀錄裡最好的完攀方式（fromLog） */
export function routeStyle(personal: Personal, routeId: string): { chosen?: SendStyle; fromLog?: SendStyle } {
  const saved = personal.best.get(routeId)
  const chosen = saved && checklistStyle(saved)
  if (chosen) return { chosen }
  const logged = bestStyle(personal.ticks.filter((tk) => tk.routeId === routeId && isSent(tk.style)).map((tk) => tk.style))
  return { fromLog: logged && checklistStyle(logged) }
}

/** OS、RP、TR 三個按鈕，再按一次同一個是清除；沒有勾選時攀登紀錄裡的方式顯示外框。路線清單與路線卡片的「完攀」共用 */
export function SentPicker({ routeId, label }: { routeId: string; label: string }) {
  const { t } = useLang()
  const { chosen, fromLog } = routeStyle(usePersonal(), routeId)
  return (
    <div className="checklist-styles" role="group" aria-label={label}>
      {BEST_STYLES.map((s) => (
        <button
          key={s}
          type="button"
          className={`checklist-style style-${SEND_SHORT[s].toLowerCase()}${chosen === s ? ' on' : fromLog === s ? ' from-log' : ''}`}
          aria-pressed={chosen === s}
          title={fromLog === s ? t('checklist.fromLog', { style: t(`style.${s}`) }) : t(`style.${s}`)}
          onClick={() => void setBest(routeId, chosen === s ? null : s)}
        >
          {SEND_SHORT[s]}
        </button>
      ))}
    </div>
  )
}
