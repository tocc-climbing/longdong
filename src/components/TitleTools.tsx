import { useRef, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, Route, Sector } from '../data/schema'
import { HistoryView, useDismiss, useEditOptions, useHistory, type ToolScope } from '../edit/PageTools'
import { useLang } from '../i18n'
import { useWide } from '../layout'
import { setFavorite, usePersonal } from '../personal/store'
import { PlaceReport } from './PlaceReport'
import { ShareItems } from './ShareItems'

/**
 * 區域、分區、路線頁標題卡右上的工具：收藏、回報位置（都是圖示），「更多」選單：分享、記錄攀登（路線）、編輯、
 * 修改記錄（電腦版、有修改記錄才顯示）。收藏與記錄攀登要登入。
 * favoriteId：收藏的對象（路線、區域或分區的 ID；固定點不能收藏時 undefined）；report：回報位置的對象；
 * onTick：打開記錄攀登的視窗（只有路線）。
 */
export function TitleTools({
  data,
  favoriteId,
  report,
  share,
  signedIn,
  scope,
  onTick,
}: {
  data: LoadedData
  favoriteId?: string
  report: { area: Area; sector?: Sector; route?: Route }
  share: { url: string; text: string }
  signedIn: boolean
  scope: ToolScope
  onTick?: () => void
}) {
  const { t } = useLang()
  const personal = usePersonal()
  const wide = useWide()
  const mine = signedIn && !!favoriteId && !personal.error
  const favorite = !!favoriteId && personal.favorites.has(favoriteId)
  const edits = useEditOptions(scope)
  const history = useHistory(scope)
  const [menu, setMenu] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(menu || showHistory, () => (setMenu(false), setSharing(false), setShowHistory(false)), box)
  const close = () => (setMenu(false), setSharing(false))

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
          onClick={() => (setMenu(!menu), setSharing(false), setShowHistory(false))}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <circle cx="5" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
          </svg>
        </button>
        {menu && (
          <div className="tool-pop menu" role="menu">
            <button type="button" role="menuitem" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>
              {t('share.button')}
            </button>
            {sharing && (
              <div className="share-list">
                <ShareItems url={share.url} text={share.text} onDone={close} />
              </div>
            )}
            {mine && onTick && (
              <button
                type="button"
                role="menuitem"
                disabled={!personal.ready}
                onClick={() => {
                  close()
                  onTick()
                }}
              >
                {t('tick.menu')}
              </button>
            )}
            {edits.map((o) => (
              <a key={o.key} role="menuitem" href={o.to}>
                {t('tools.edit')}：{o.label}
              </a>
            ))}
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
          </div>
        )}
        {showHistory && (
          <div className="tool-pop" role="dialog" aria-label={t('tools.history')}>
            <h2>{t('tools.history')}</h2>
            <HistoryView scope={scope} history={history} />
          </div>
        )}
      </div>
    </div>
  )
}
