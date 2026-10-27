import { createContext, useContext } from 'react'
import { useLang } from '../i18n'

/** 編輯模式兩側面板的收起狀態（電腦版）：左側目錄、右側資訊面板 */
export type DockPart = 'catalog' | 'panel'

export interface PanelLayout {
  open: Record<DockPart, boolean>
  toggle: (part: DockPart) => void
}

export const PanelLayoutContext = createContext<PanelLayout | null>(null)

export function usePanelLayout(): PanelLayout {
  const layout = useContext(PanelLayoutContext)
  if (!layout) throw new Error('PanelLayoutContext 沒有提供者：編輯模式的面板要放在 EditPage 裡')
  return layout
}

/** 面板收起、展開的按鈕圖示：箭頭指向面板移動的方向（收起往外側、展開往內側） */
export function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} />
    </svg>
  )
}

const SIDE: Record<DockPart, 'left' | 'right'> = { catalog: 'left', panel: 'right' }

/** 面板頂端的標題列：名稱與收起按鈕 */
export function DockHead({ part, title }: { part: DockPart; title: string }) {
  const { t } = useLang()
  const { toggle } = usePanelLayout()
  const side = SIDE[part]
  return (
    <div className="edit-dock-head">
      <span>{title}</span>
      <button
        type="button"
        className="edit-icon-btn"
        onClick={() => toggle(part)}
        title={t(part === 'catalog' ? 'edit.toggleCatalog' : 'edit.togglePanel')}
        aria-label={t(part === 'catalog' ? 'edit.toggleCatalog' : 'edit.togglePanel')}
        aria-expanded
      >
        <Chevron dir={side} />
      </button>
    </div>
  )
}

/** 收起後留下的窄條：直排名稱與展開按鈕 */
export function DockRail({ part, title }: { part: DockPart; title: string }) {
  const { t } = useLang()
  const { toggle } = usePanelLayout()
  const side = SIDE[part]
  return (
    <button
      type="button"
      className={`edit-rail ${side}`}
      onClick={() => toggle(part)}
      title={t(part === 'catalog' ? 'edit.toggleCatalog' : 'edit.togglePanel')}
      aria-label={t(part === 'catalog' ? 'edit.toggleCatalog' : 'edit.togglePanel')}
      aria-expanded={false}
    >
      <Chevron dir={side === 'left' ? 'right' : 'left'} />
      <span>{title}</span>
    </button>
  )
}
