import { useRef, useState, type ReactNode } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, Route, Sector } from '../data/schema'
import { HistoryView, useDismiss, useEditOptions, useHistory, type ToolScope } from '../edit/PageTools'
import { useLang } from '../i18n'
import { useWide } from '../layout'
import { setFavorite, usePersonal } from '../personal/store'
import { PlaceReport } from './PlaceReport'
import { ShareItems } from './ShareItems'
import { Sheet } from './Sheet'

/**
 * 區域、分區、路線頁標題卡右上的工具：收藏、回報位置（都是圖示），「更多」選單：分享、編輯、
 * 修改記錄（電腦版、有修改記錄才顯示）、路線資料（只有路線）。收藏要登入。分享與路線資料從下方滑出，不在選單裡展開。
 * favoriteId：收藏的對象（路線、區域或分區的 ID；固定點不能收藏時 undefined）；report：回報位置的對象；
 * info：路線資料的內容；inlineEdit：在這一頁就地編輯的項目（手機路線頁的說明、Topo），選了不換頁。
 */
export function TitleTools({
  data,
  favoriteId,
  report,
  share,
  signedIn,
  scope,
  info,
  inlineEdit,
}: {
  data: LoadedData
  favoriteId?: string
  report: { area: Area; sector?: Sector; route?: Route }
  share: { url: string; text: string }
  signedIn: boolean
  scope: ToolScope
  info?: ReactNode
  inlineEdit?: Partial<Record<string, () => void>>
}) {
  const { t } = useLang()
  const personal = usePersonal()
  const wide = useWide()
  const mine = signedIn && !!favoriteId && !personal.error
  const favorite = !!favoriteId && personal.favorites.has(favoriteId)
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
      {mine && (
        <button
          type="button"
          className={`tool-button fav${favorite ? ' on' : ''}`}
          aria-pressed={favorite}
          aria-label={favorite ? t('fav.on') : t('fav.off')}
          title={favorite ? t('fav.on') : t('fav.off')}
          disabled={!personal.ready}
          onClick={() => setFavorite(favoriteId!, !favorite)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path
              d="M12 21s-7-4.4-9.5-9C.8 8.6 3 5 6.5 5c2 0 3.5 1.2 5.5 3 2-1.8 3.5-3 5.5-3C21 5 23.2 8.6 21.5 12 19 16.6 12 21 12 21z"
              fill={favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
      )}
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
