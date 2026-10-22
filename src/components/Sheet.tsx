import { useEffect, useId, useRef, type ReactNode } from 'react'

/** 彈窗：手機從下方滑出、電腦置中；Esc 或點外面關閉（樣式在 src/map/map.css 的 .sheet：目前都和地圖一起用） */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
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
      className="sheet"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={id}
    >
      <div className="sheet-body">
        <h2 id={id}>{title}</h2>
        {open && children}
      </div>
    </dialog>
  )
}
