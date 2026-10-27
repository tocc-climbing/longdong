import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Sector } from '../data/schema'
import { rescueKey } from '../data/rescue'
import { localName, LOCALES, useLang } from '../i18n'
import { useWide } from '../layout'
import { loadMapShapes, useMapShapes, type EditTarget } from '../map/shapes'
import { href, type EditKind } from '../router'
import { displayName, useSocial } from '../social/store'
import { loadEdits, loadPhotos, useTopoState } from '../topo/store'
import { currentText, useTextEdits, type TextTarget } from './textEdits'
import { groupVersions, type Versioned } from './versions'

/** 頁面能修改與有修改記錄的對象；map、text 的 label 是顯示用的名稱（區域範圍、路線說明…） */
export interface ToolScope {
  /** 救援圖的大區域 */
  areaId: string
  map?: { target: EditTarget; label: string }
  text?: { target: TextTarget; label: string; original?: string }
  /** 這頁涵蓋的分區（Topo 的修改記錄） */
  sectors: Sector[]
  /** 這頁的 Topo 可以進編輯模式（分區、路線頁；區域頁只列記錄） */
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
 * 區域、分區、路線頁標題旁的圖示：修改記錄（點了才展開）、編輯（進編輯模式的對應項目）、救援（只有手機版）。
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
  // 同一天同一人連續的版本合併成一筆（見 versions.ts）
  const addVersions = (kind: EditKind, label: string, versions: Versioned[] | undefined) => {
    for (const { latest, members } of groupVersions(versions ?? []))
      entries.push({ kind, label, note: members.length > 1 ? t('shape.mergedCount', { n: members.length }) : undefined, uid: latest.uid, createdAt: latest.createdAt })
  }
  if (scope.map) addVersions('map', scope.map.label, maps.versions[scope.map.target])
  if (scope.text) addVersions('text', scope.text.label, texts[scope.text.target])
  for (const sector of scope.sectors) {
    const own = photos.filter((p) => p.sector === sector.id).sort((a, b) => a.createdAt - b.createdAt)
    own.forEach((p, i) => {
      const label = [scope.sectors.length > 1 && localName(sector.name, lang).main, own.length > 1 && `${i + 1}`].filter(Boolean).join(' ')
      entries.push({ kind: 'topo', label, note: t('tools.uploaded'), uid: p.uid, createdAt: p.createdAt })
      addVersions('topo', label, topo.edits[p.id])
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
  to: string
}

/** 一個選項直接進入，多個選項跳小選單；地圖與 Topo 只在電腦版（手機版的編輯模式只有說明） */
function EditButton({ scope }: { scope: ToolScope }) {
  const { t } = useLang()
  const wide = useWide()
  const topo = useTopoState()
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
  // 一個「Topo」入口：有照片進第一張；沒有照片進新增頁（edit/topo/sector:<分區>，載入完照片才知道時也會轉到第一張）
  if (wide && scope.topoEdit) {
    const sector = scope.sectors[0]
    const first = Object.values(topo.photos ?? {})
      .filter((p) => p.sector === sector.id)
      .sort((a, b) => a.createdAt - b.createdAt)[0]
    options.push({ key: 'topo', label: 'Topo', to: first ? href.topo(first.id) : href.topoAdd(sector.id) })
  }
  if (options.length === 0) return null

  const icon = (
    <Icon>
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </Icon>
  )
  if (options.length === 1) {
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
      {open && (
        <div className="tool-pop menu" role="menu">
          {options.map((o) => (
            <a key={o.key} role="menuitem" href={o.to}>
              {o.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
