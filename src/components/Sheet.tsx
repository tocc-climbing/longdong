import { useEffect, useId, useRef, type ReactNode } from 'react'

/** 彈窗：手機從下方滑出、電腦置中；Esc 或點外面關閉（locked：處理中，不能關閉） */
export function Sheet({ open, onClose, title, className, locked, children }: { open: boolean; onClose: () => void; title: string; className?: string; locked?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className={className ? `sheet ${className}` : 'sheet'}
      onClose={onClose}
      // Chrome 不一定讓 cancel 事件取消關閉：Esc 在按鍵時就擋下
      onKeyDown={(e) => locked && e.key === 'Escape' && e.preventDefault()}
      onCancel={(e) => locked && e.preventDefault()}
      onClick={(e) => e.target === ref.current && !locked && onClose()}
      aria-labelledby={id}
    >
      <div className="sheet-body">
        <h2 id={id}>{title}</h2>
        {open && children}
      </div>
    </dialog>
  )
}
