import { useRef, useState, type ReactNode } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, Route, Sector } from '../data/schema'
import { HistoryView, useDismiss, useEditOptions, useHistory, type ToolScope } from '../edit/PageTools'
import { useLang } from '../i18n'
import { useWide } from '../layout'
import { PlaceReport } from './PlaceReport'
import { ShareItems } from './ShareItems'
import { Sheet } from './Sheet'

/**
 * 區域、分區、路線頁標題卡右上的工具：回報位置（圖示），「更多」選單：分享、編輯、
 * 修改記錄（電腦版、有修改記錄才顯示）、路線資料（只有路線）。分享與路線資料從下方滑出，不在選單裡展開。
 * report：回報位置的對象；
 * info：路線資料的內容；inlineEdit：在這一頁就地編輯的項目（手機路線頁的說明、Topo），選了不換頁。
 */
export function TitleTools({
  data,
  report,
  share,
  scope,
  info,
  inlineEdit,
}: {
  data: LoadedData
  report: { area: Area; sector?: Sector; route?: Route }
  share: { url: string; text: string }
  scope: ToolScope
  info?: ReactNode
  inlineEdit?: Partial<Record<string, () => void>>
}) {
  const { t } = useLang()
  const wide = useWide()
  const edits = useEditOptions(scope)
  const history = useHistory(scope)
  const [menu, setMenu] = useState(false)
  const [sheet, setSheet] = useState<'share' | 'info'>()
  const [showHistory, setShowHistory] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(menu || showHistory, () => (setMenu(false), setShowHistory(false)), box)
  const close = () => setMenu(false)

  return (
    <div className="page-tools">
      <PlaceReport data={data} {...report} />
      <div className="tool-wrap" ref={box}>
        <button
          type="button"
          className="tool-button"
          aria-label={t('route.actionsMore')}
          title={t('route.actionsMore')}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => (setMenu(!menu), setShowHistory(false))}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <circle cx="5" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
          </svg>
        </button>
        {menu && (
          <div className="tool-pop menu" role="menu">
            <button type="button" role="menuitem" onClick={() => (close(), setSheet('share'))}>
              {t('share.button')}
            </button>
            {edits.map((o) => {
              const label = `${t('tools.edit')}：${o.label}`
              const here = inlineEdit?.[o.key]
              return here ? (
                <button key={o.key} type="button" role="menuitem" onClick={() => (close(), here())}>
                  {label}
                </button>
              ) : (
                <a key={o.key} role="menuitem" href={o.to}>
                  {label}
                </a>
              )
            })}
            {wide && history.entries.length > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close()
                  setShowHistory(true)
                }}
              >
                {t('tools.history')}
              </button>
            )}
            {info && (
              <button type="button" role="menuitem" onClick={() => (close(), setSheet('info'))}>
                {t('route.info')}
              </button>
            )}
          </div>
        )}
        {showHistory && (
          <div className="tool-pop" role="dialog" aria-label={t('tools.history')}>
            <h2>{t('tools.history')}</h2>
            <HistoryView scope={scope} history={history} />
          </div>
        )}
      </div>
      <Sheet open={sheet === 'share'} onClose={() => setSheet(undefined)} title={t('share.button')}>
        <div className="share-sheet" role="menu">
          <ShareItems url={share.url} text={share.text} onDone={() => setSheet(undefined)} />
        </div>
      </Sheet>
      {info && (
        <Sheet open={sheet === 'info'} onClose={() => setSheet(undefined)} title={t('route.info')}>
          {info}
        </Sheet>
      )}
    </div>
  )
}
