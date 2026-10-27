import { useLang } from '../i18n'

/** 快捷鍵清單的一列：有 onClick 的是按鈕（按下去和按鍵一樣）；沒有的只是說明（滑鼠、滾輪） */
export interface KeyRow {
  keys: string
  label: string
  onClick?: () => void
  disabled?: boolean
}

/** 編輯模式的快捷鍵：單一按鍵（Windows、Mac 都一樣，不用 Ctrl／⌘），每個都有對應的按鈕 */
export function KeyList({ rows }: { rows: KeyRow[] }) {
  return (
    <div className="key-list">
      {rows.map(({ keys, label, onClick, disabled }) =>
        onClick ? (
          <button key={keys + label} type="button" className="key-row" disabled={disabled} onClick={onClick} aria-keyshortcuts={keys}>
            <span>{label}</span>
            <kbd>{keys}</kbd>
          </button>
        ) : (
          <div key={keys + label} className="key-row info">
            <span>{label}</span>
            <kbd>{keys}</kbd>
          </div>
        ),
      )}
    </div>
  )
}

/** 右側面板的快捷鍵一節：每個頁面自己的快捷鍵 */
export function EditKeys({ rows }: { rows: KeyRow[] }) {
  const { t } = useLang()
  return (
    <section className="edit-keys">
      <h2>{t('edit.shortcuts')}</h2>
      <KeyList rows={rows} />
    </section>
  )
}
