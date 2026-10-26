import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Sector } from '../data/schema'
import { rescueKey } from '../data/rescue'
import { localName, LOCALES, useLang } from '../i18n'
import { useWide } from '../layout'
import { loadMapShapes, useMapShapes, type EditTarget } from '../map/shapes'
import { href, type EditKind } from '../router'
import { displayName, useSocial } from '../social/store'
import { useCloud } from '../personal/sync'
import { loadEdits, loadPhotos, useTopoState } from '../topo/store'
import { useTopoUpload } from '../topo/TopoUpload'
import { currentText, useTextEdits, type TextTarget } from './textEdits'

/** 頁面能修改與有修改記錄的對象；map、text 的 label 是顯示用的名稱（區域範圍、路線說明…） */
export interface ToolScope {
  /** 救援圖的大區域 */
  areaId: string
  map?: { target: EditTarget; label: string }
  text?: { target: TextTarget; label: string; original?: string }
  /** 這頁涵蓋的分區（Topo 的修改記錄） */
  sectors: Sector[]
  /** 這頁的 Topo 可以進修改模式（分區、路線頁；區域頁只列記錄） */
  topoEdit?: boolean
}

interface Entry {
  kind: EditKind
  label: string
  note?: string
  uid: string
  createdAt: number
}

/** 點選單外面或按 Esc 關閉 */
function useDismiss(open: boolean, onClose: () => void, box: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, box])
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

/**
 * 區域、分區、路線頁標題旁的圖示：修改記錄（點了才展開）、編輯（進修改模式的對應項目）、救援（只有手機版）。
 * 平常只佔三個圖示的位置，不影響閱讀。
 */
export function PageTools({ scope }: { scope: ToolScope }) {
  const { t } = useLang()
  const wide = useWide()
  const key = rescueKey(scope.areaId)
  return (
    <div className="page-tools">
      <HistoryButton scope={scope} />
      <EditButton scope={scope} />
      {!wide && (
        <a className="tool-button rescue" href={href.rescue(key)} aria-label={t('rescue.button')} title={t('rescue.button')}>
          <span className="rescue-cross" aria-hidden>
            +
          </span>
        </a>
      )}
    </div>
  )
}

function HistoryButton({ scope }: { scope: ToolScope }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), box)
  return (
    <div className="tool-wrap" ref={box}>
      <button type="button" className="tool-button" aria-label={t('tools.history')} title={t('tools.history')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </Icon>
      </button>
      {open && (
        <div className="tool-pop" role="dialog" aria-label={t('tools.history')}>
          <h2>{t('tools.history')}</h2>
          <HistoryList scope={scope} />
        </div>
      )}
    </div>
  )
}

/** 展開後才讀取 Topo 的版本；地圖、說明的版本全站共用，已經讀好 */
function HistoryList({ scope }: { scope: ToolScope }) {
  const { lang, t } = useLang()
  const maps = useMapShapes()
  const texts = useTextEdits()
  const topo = useTopoState()
  const { profiles } = useSocial()
  const sectorIds = scope.sectors.map((s) => s.id)
  const photos = Object.values(topo.photos ?? {}).filter((p) => sectorIds.includes(p.sector))
  const photoIds = photos.map((p) => p.id).join(' ')
  useEffect(() => {
    void loadMapShapes()
    void loadPhotos()
  }, [])
  useEffect(() => {
    for (const id of photoIds ? photoIds.split(' ') : []) void loadEdits(id)
  }, [photoIds])

  const entries: Entry[] = []
  if (scope.map)
    for (const v of maps.versions[scope.map.target] ?? [])
      entries.push({
        kind: 'map',
        label: scope.map.label,
        uid: v.uid,
        createdAt: v.createdAt,
      })
  if (scope.text)
    for (const v of texts[scope.text.target] ?? [])
      entries.push({
        kind: 'text',
        label: scope.text.label,
        uid: v.uid,
        createdAt: v.createdAt,
      })
  for (const sector of scope.sectors) {
    const own = photos.filter((p) => p.sector === sector.id).sort((a, b) => a.createdAt - b.createdAt)
    own.forEach((p, i) => {
      const label = [scope.sectors.length > 1 && localName(sector.name, lang).main, own.length > 1 && `${i + 1}`].filter(Boolean).join(' ')
      entries.push({
        kind: 'topo',
        label,
        note: t('tools.uploaded'),
        uid: p.uid,
        createdAt: p.createdAt,
      })
      for (const e of topo.edits[p.id] ?? [])
        entries.push({
          kind: 'topo',
          label,
          uid: e.uid,
          createdAt: e.createdAt,
        })
    })
  }
  entries.sort((a, b) => b.createdAt - a.createdAt)

  const kindLabel: Record<EditKind, string> = {
    map: t('edit.map'),
    topo: 'Topo',
    text: t('edit.text'),
  }
  const edited = scope.text && currentText(texts[scope.text.target])
  return (
    <>
      {entries.length === 0 ? (
        <p className="muted small">{t('tools.historyEmpty')}</p>
      ) : (
        <ol className="tool-history">
          {entries.map((e) => (
            <li key={`${e.kind}${e.label}${e.createdAt}${e.uid}`}>
              <span className={`tool-kind ${e.kind}`}>{kindLabel[e.kind]}</span>
              <span className="tool-entry">
                <b>{[e.label, e.note].filter(Boolean).join(' · ')}</b>
                <span className="muted small">
                  {displayName(profiles, e.uid)} · {new Date(e.createdAt).toLocaleDateString(LOCALES[lang])}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {edited && scope.text?.original && (
        <details className="tool-original">
          <summary className="small">{t('text.original')}</summary>
          <p className="pre small">{scope.text.original}</p>
        </details>
      )}
    </>
  )
}

interface EditOption {
  key: string
  label: string
  to?: string
  /** 沒有網址的選項（新增照片） */
  run?: () => void
}

/** 一個選項直接進入，多個選項跳小選單；地圖與 Topo 只在電腦版（手機版的修改模式只有說明） */
function EditButton({ scope }: { scope: ToolScope }) {
  const { t } = useLang()
  const wide = useWide()
  const topo = useTopoState()
  const signedIn = useCloud().status === 'signed-in'
  const upload = useTopoUpload(scope.sectors[0].id)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), box)
  useEffect(() => {
    if (scope.topoEdit) void loadPhotos()
  }, [scope.topoEdit])

  const options: EditOption[] = []
  if (wide && scope.map)
    options.push({
      key: 'map',
      label: scope.map.label,
      to: href.edit('map', scope.map.target),
    })
  if (scope.text)
    options.push({
      key: 'text',
      label: scope.text.label,
      to: href.edit('text', scope.text.target),
    })
  if (wide && scope.topoEdit) {
    const sector = scope.sectors[0]
    const photos = Object.values(topo.photos ?? {})
      .filter((p) => p.sector === sector.id)
      .sort((a, b) => a.createdAt - b.createdAt)
    photos.forEach((p, i) =>
      options.push({
        key: p.id,
        label: photos.length > 1 ? `Topo ${i + 1}` : 'Topo',
        to: href.topo(p.id),
      }),
    )
    if (signedIn) options.push({ key: 'upload', label: t(upload.busy ? 'topo.uploading' : 'topo.add'), run: upload.pick })
  }
  if (options.length === 0) return null

  const icon = (
    <Icon>
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </Icon>
  )
  if (options.length === 1 && options[0].to) {
    return (
      <a className="tool-button" href={options[0].to} aria-label={`${t('tools.edit')}：${options[0].label}`} title={`${t('tools.edit')}：${options[0].label}`}>
        {icon}
      </a>
    )
  }
  return (
    <div className="tool-wrap" ref={box}>
      <button
        type="button"
        className="tool-button"
        aria-label={t('tools.edit')}
        title={t('tools.edit')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {upload.input}
      {open && (
        <div className="tool-pop menu" role="menu">
          {options.map((o) =>
            o.to ? (
              <a key={o.key} role="menuitem" href={o.to}>
                {o.label}
              </a>
            ) : (
              <button key={o.key} type="button" role="menuitem" disabled={upload.busy} onClick={o.run}>
                {o.label}
              </button>
            ),
          )}
          {upload.error && <p className="small error">{upload.error}</p>}
        </div>
      )}
    </div>
  )
}
