import { useState, type ReactNode } from 'react'

/** 修改記錄：預設收起，按標題旁的 i 展開 */
export function HistorySection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="edit-history">
      <div className="edit-history-head">
        <h2>{title}</h2>
        <button type="button" className="edit-icon-btn edit-history-toggle" aria-expanded={open} aria-label={title} title={title} onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </button>
      </div>
      {open && children}
    </section>
  )
}
