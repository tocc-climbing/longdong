import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useIsAdmin } from '../admin'
import { GradePill } from '../components/GradePill'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import type { Route } from '../data/schema'
import { relativeTime } from '../format'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { NotFound } from '../pages/AreaPage'
import { useCloud } from '../personal/sync'
import { href, navigate } from '../router'
import { displayName, useSocial } from '../social/store'
import { removeEdit, removeTopo, submitEdit } from './actions'
import { CropBox } from './CropBox'
import { fillShared, forkLine, moveSharedPoint, syncShared } from './lines'
import { boltPositions, isFullCrop, SCALE, sameCrop, sameMarks, toCropPoint, type Crop, type Marks, type Point, type RouteMarks, type TopoEdit, type TopoPhoto } from './model'
import { HistorySection } from '../edit/HistorySection'
import { EditKeys } from '../edit/KeyList'
import { loadEdits, loadPhotos, useTopoState } from './store'
import { routeLabels } from './TopoSection'
import { px, routeInfo, TopoFrame, TopoLines } from './TopoView'
import { ZoomPane } from './ZoomPane'

/**
 * Topo 編輯（電腦版）：左邊是照片，右邊選路線，在照片上標記線段（由起攀點往上）與 bolt。
 * 修改先存在這台裝置的草稿，按「提交」才上傳成新的版本；所有版本都保留，可以預覽、從舊版本繼續修改。
 */
export function TopoEditor({ data, id, embedded, side }: { data: LoadedData; id: string; embedded?: boolean; side: HTMLElement | null }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const cloud = useCloud()
  const state = useTopoState()
  useEffect(() => {
    void loadPhotos()
    void loadEdits(id)
  }, [id])

  const photo = state.photos?.[id]
  const edits = state.edits[id]
  if (!state.photos || !edits) return <p className="empty muted">{t('app.loading')}</p>
  const found = photo && data.sectorById.get(photo.sector)
  if (!photo || !found) return <NotFound />
  const { sector, area } = found

  return (
    <div className="topo-editor">
      {!embedded && (
        <>
          <nav className="crumbs">
            <a href={href.area(area.id)}>{localName(area.name, lang).main}</a>
            {' › '}
            <a href={href.sector(sector.id)}>{localName(sector.name, lang).main}</a>
          </nav>
          <h1>{t('topo.editTitle')}</h1>
        </>
      )}
      {!wide ? (
        <p className="muted">{t('topo.desktopOnly')}</p>
      ) : cloud.status !== 'signed-in' ? (
        cloud.status !== 'loading' && <SignInPrompt message={t('topo.signIn')} />
      ) : (
        <Editor photo={photo} edits={edits} routes={sector.routes} labels={routeLabels(sector)} uid={cloud.user!.uid} side={side} />
      )}
    </div>
  )
}

/** 工具列的小圖示（24 格的線條圖） */
function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

type Mode = 'line' | 'bolt' | 'crop'

/** 切換工具的快捷鍵 */
const MODE_KEYS: Record<string, Mode> = { l: 'line', b: 'bolt', c: 'crop' }

/** 一個版本的內容 */
interface Content {
  marks: Marks
  crop?: Crop
}

/** 這台裝置上未提交的修改；base 是開始修改時的最新版本 */
interface Draft {
  base?: string
  marks: Marks
  crop?: Crop
}

const draftKey = (photo: string) => `longdong.topoDraft.${photo}`

function readDraft(photo: string): Draft | undefined {
  try {
    const raw = localStorage.getItem(draftKey(photo))
    return raw ? (JSON.parse(raw) as Draft) : undefined
  } catch {
    return undefined
  }
}

function writeDraft(photo: string, draft: Draft | undefined) {
  try {
    if (draft) localStorage.setItem(draftKey(photo), JSON.stringify(draft))
    else localStorage.removeItem(draftKey(photo))
  } catch {
    /* 私密瀏覽等情況：草稿只留在這個畫面 */
  }
}

function Editor({
  photo,
  edits,
  routes,
  labels,
  uid,
  side,
}: {
  photo: TopoPhoto
  edits: TopoEdit[]
  routes: Route[]
  labels: Map<string, string>
  uid: string
  side: HTMLElement | null
}) {
  const { lang, t } = useLang()
  const isAdmin = useIsAdmin()
  const profiles = useSocial().profiles
  const info = useMemo(() => routeInfo(routes, (r) => localName(r.name, lang).main), [routes, lang])
  const latest = edits.at(-1)
  const [draft, setDraftState] = useState<Draft | undefined>(() => readDraft(photo.id))
  const [preview, setPreview] = useState<TopoEdit>()
  const [selected, setSelected] = useState<string | undefined>(routes.find((r) => r.number)?.id)
  const [mode, setMode] = useState<Mode>('line')
  const [boltPos, setBoltPos] = useState<string>()
  const [forking, setForking] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // 全畫面：只放大編輯區（工具列與照片），用瀏覽器的全螢幕
  const layoutRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === layoutRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const toggleFull = () => void (document.fullscreenElement ? document.exitFullscreen() : layoutRef.current?.requestFullscreen())
  // 復原／重做：每個修改前的內容；改了畫面（按鈕可不可以按）要重新繪製，所以另外記一個計數
  const undo = useRef<Content[]>([])
  const redo = useRef<Content[]>([])
  const [, setHistoryTick] = useState(0)
  const tick = () => setHistoryTick((n) => n + 1)

  const shown = preview ?? draft ?? latest
  // 共用的 anchor 只標在一條路線時（舊資料），另一條路線也看得到
  const marks = useMemo(() => fillShared(shown?.marks ?? {}, routes), [shown, routes])
  const crop = shown?.crop
  const changed = !!draft && !(sameMarks(draft.marks, latest?.marks ?? {}) && sameCrop(draft.crop, latest?.crop))
  const route = routes.find((r) => r.id === selected)
  const positions = route ? boltPositions(route) : []
  const current: RouteMarks = (selected && marks[selected]) || {}
  const nextPos = positions.find((p) => !current.bolts?.[p])
  const placing = boltPos && positions.includes(boltPos) ? boltPos : nextPos
  const cropping = mode === 'crop' && !preview
  /** 畫面上照片的寬高比（裁切後只顯示一塊）：照片高度不超過視窗，不用捲動就能編輯 */
  const shownCrop = cropping ? undefined : crop
  const fitAspect = (photo.width * (shownCrop?.w ?? SCALE)) / (photo.height * (shownCrop?.h ?? SCALE))
  /** 可以分岔的路線：這張照片上已有線段的其他路線；目前這條還沒畫線才能分岔 */
  const forkable = Object.entries(marks).filter(([id, m]) => id !== selected && m.line)
  const canFork = !preview && mode === 'line' && !!route && !current.line && forkable.length > 0
  const isForking = forking && canFork

  /** 版本一定要有至少一條路線的標記（資料庫規則），所以只裁切、還沒標記時不能提交 */
  const needRoute = changed && Object.keys(draft!.marks).length === 0

  const setDraft = (d: Draft | undefined) => {
    if (d) setSaved(false)
    writeDraft(photo.id, d)
    setDraftState(d)
  }
  /** 目前可修改的內容：草稿，沒有草稿時是最新版本 */
  const base = (): Content => ({ marks: draft?.marks ?? latest?.marks ?? {}, crop: draft ? draft.crop : latest?.crop })
  const commit = (next: Content) => setDraft({ base: draft?.base ?? latest?.id, ...next })
  /** 修改前記一個復原點，清掉重做 */
  const record = (before: Content) => {
    undo.current.push(before)
    redo.current = []
    tick()
  }
  const clearHistory = () => {
    undo.current = []
    redo.current = []
    tick()
  }
  const undoOnce = () => {
    const prev = undo.current.pop()
    if (!prev || preview) return
    redo.current.push(base())
    commit(prev)
    tick()
  }
  const redoOnce = () => {
    const next = redo.current.pop()
    if (!next || preview) return
    undo.current.push(base())
    commit(next)
    tick()
  }
  /** 選一條路線（換路線時取消正在進行的分岔、bolt 位置的選擇） */
  const pick = (id: string) => {
    setSelected(id)
    setBoltPos(undefined)
    setForking(false)
  }
  /** 修改選取的路線；第一次修改時以最新版本為基礎建立草稿 */
  const edit = (change: (m: RouteMarks) => RouteMarks) => {
    if (!selected) return
    const { marks: before, crop: keep } = base()
    record({ marks: before, crop: keep })
    let next = { ...before, [selected]: change(before[selected] ?? {}) }
    if (!next[selected].line?.length && !Object.keys(next[selected].bolts ?? {}).length) delete next[selected]
    // 共用的 bolt、anchor（例如兩條路線共用頂端的 anchor）：另一條路線自動同步
    next = syncShared(next, before, selected, routes)
    commit({ marks: next, crop: keep })
  }
  /** 修改裁切；拖曳開始時記一次復原點（record），之後只更新草稿 */
  const setCrop = (next: Crop, recordUndo = false) => {
    const before = base()
    if (recordUndo) record(before)
    commit({ marks: before.marks, crop: isFullCrop(next) ? undefined : next })
  }

  /** 上一條、下一條路線（依清單的順序） */
  const stepRoute = (delta: number) => {
    const i = routes.findIndex((r) => r.id === selected)
    const next = routes[Math.min(routes.length - 1, Math.max(0, (i < 0 ? (delta > 0 ? -1 : routes.length) : i) + delta))]
    if (next) pick(next.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      // 在輸入框裡打字、焦點在按鈕（Enter、空白鍵留給它）時，不當作快捷鍵
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      const key = e.key.toLowerCase()
      // 快捷鍵都是單一按鍵（Windows、Mac 一樣）；Ctrl／⌘／Alt 的組合鍵留給瀏覽器
      if (e.ctrlKey || e.metaKey || e.altKey || preview) {
        return
      } else if (key === 'z') {
        e.preventDefault()
        undoOnce()
      } else if (key === 'y') {
        e.preventDefault()
        redoOnce()
      } else if (key === 'escape') {
        setForking(false)
      } else if (key === 'enter' && mode === 'crop' && !el.closest('button, a')) {
        setMode('line')
      } else if (key === 'arrowup' || key === 'arrowdown') {
        e.preventDefault()
        stepRoute(key === 'arrowup' ? -1 : 1)
      } else if (key === 'f') {
        setForking((on) => !on)
      } else if (MODE_KEYS[key]) {
        const next = MODE_KEYS[key]
        if (next === 'bolt' && positions.length === 0) return
        setMode(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** 畫面上的位置換成整張照片上的點（編輯時畫面可能只顯示裁切的一塊） */
  const pointAt = (e: { clientX: number; clientY: number }, svg: SVGSVGElement): Point => {
    const r = svg.getBoundingClientRect()
    return toCropPoint(crop, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  const onPhotoClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (preview || mode === 'crop' || isForking || !selected || dragging.current) return
    const p = pointAt(e, e.currentTarget)
    if (mode === 'line') edit((m) => ({ ...m, line: [...(m.line ?? []), p] }))
    else if (placing) {
      edit((m) => ({ ...m, bolts: { ...m.bolts, [placing]: p } }))
      setBoltPos(undefined)
    }
  }

  // 拖曳線段的點或 bolt：按下時記一次復原點，移動時直接改草稿
  const dragging = useRef<{ kind: 'line'; index: number; at: Point } | { kind: 'bolt'; pos: string } | null>(null)
  const startDrag = (e: ReactPointerEvent<SVGElement>, target: NonNullable<typeof dragging.current>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = target
    edit((m) => m)
  }
  const onDrag = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragging.current
    const svg = e.currentTarget.ownerSVGElement
    if (!d || !svg || !selected) return
    const p = pointAt(e, svg)
    const { marks: all, crop: keep } = base()
    if (d.kind === 'line') {
      // 分岔出來的路線與原路線共用的點一起移動
      commit({ marks: moveSharedPoint(all, d.at, p), crop: keep })
      d.at = p
      return
    }
    const m = all[selected] ?? {}
    commit({ marks: syncShared({ ...all, [selected]: { ...m, bolts: { ...m.bolts, [d.pos]: p } } }, all, selected, routes), crop: keep })
  }
  const endDrag = () => {
    // click 事件在 pointerup 之後才觸發：等它過去再清除，拖曳結束時不會多加一點
    setTimeout(() => (dragging.current = null))
  }

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await submitEdit(photo.id, draft!.marks, draft!.crop)
      setDraft(undefined)
      clearHistory()
      setSaved(true)
      // 裁切模式顯示的是整張照片，提交後回到線段模式才看得到裁切的結果
      setMode((m) => (m === 'crop' ? 'line' : m))
    } catch (err) {
      setError(t('topo.submitError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const discard = () => {
    if (!confirm(t('topo.confirmDiscard'))) return
    setDraft(undefined)
    clearHistory()
  }

  const deleteEdit = async (e: TopoEdit) => {
    if (!confirm(t('topo.confirmDeleteEdit'))) return
    try {
      setPreview(undefined)
      await removeEdit(photo.id, e.id)
    } catch (err) {
      setError(t('topo.deleteError', { error: (err as Error).message }))
    }
  }

  const deletePhoto = async () => {
    if (!confirm(t('topo.confirmDeletePhoto'))) return
    try {
      await removeTopo(photo)
      writeDraft(photo.id, undefined)
      navigate(href.sector(photo.sector), { replace: true })
    } catch (err) {
      setError(t('topo.deleteError', { error: (err as Error).message }))
    }
  }

  /** 分岔：點其他路線的點，把這條路線的線段設成到這個點為止的前段 */
  const forkPoints = (k: number) =>
    isForking && (
      <g className="topo-fork">
        {forkable.map(([id, m]) =>
          m.line!.map((p, i) => {
            const [x, y] = px(photo, p)
            return (
              <circle
                key={`${id}.${i}`}
                cx={x}
                cy={y}
                r={7 * k}
                strokeWidth={2 * k}
                onClick={(e) => {
                  e.stopPropagation()
                  edit((cur) => ({ ...cur, line: forkLine(m.line!, i) }))
                  setForking(false)
                }}
              />
            )
          }),
        )}
      </g>
    )

  const handles = (k: number) =>
    !preview &&
    mode !== 'crop' &&
    selected && (
      <g className="topo-handles">
        {current.line?.map((p, i) => {
          const [x, y] = px(photo, p)
          return (
            <circle
              key={`l${i}`}
              className={i === 0 ? 'start' : undefined}
              cx={x}
              cy={y}
              r={6 * k}
              strokeWidth={2 * k}
              onPointerDown={(e) => startDrag(e, { kind: 'line', index: i, at: p })}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault()
                edit((m) => ({ ...m, line: m.line!.filter((_, j) => j !== i) }))
              }}
            />
          )
        })}
        {Object.entries(current.bolts ?? {}).map(([pos, p]) => {
          const [x, y] = px(photo, p)
          return (
            <rect
              key={pos}
              className="bolt"
              x={x - 32 * k}
              y={y - 14 * k}
              width={64 * k}
              height={28 * k}
              rx={14 * k}
              strokeWidth={2 * k}
              onPointerDown={(e) => startDrag(e, { kind: 'bolt', pos })}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault()
                edit((m) => {
                  const bolts = { ...m.bolts }
                  delete bolts[pos]
                  return { ...m, bolts }
                })
              }}
            />
          )
        })}
      </g>
    )

  /** 工具列的一顆按鈕：文字與快捷鍵（滑過去也顯示） */
  const tool = (label: string, keys: string | undefined, onClick: () => void, opts: { pressed?: boolean; disabled?: boolean; icon?: ReactNode; iconOnly?: boolean } = {}) => (
    <button
      type="button"
      className="topo-tool"
      aria-pressed={opts.pressed}
      disabled={opts.disabled}
      title={keys ? `${label}（${keys}）` : label}
      aria-keyshortcuts={keys}
      aria-label={opts.iconOnly ? label : undefined}
      onClick={onClick}
    >
      {opts.icon}
      {!opts.iconOnly && <span>{label}</span>}
      {!opts.iconOnly && keys && <kbd>{keys}</kbd>}
    </button>
  )

  return (
    <div className="topo-edit-layout" ref={layoutRef}>
      {!preview && (
        <div className="topo-edit-toolbar" role="toolbar" aria-label={t('topo.toolbar')}>
          {/* 只有一列：最常用的在最前面（復原、重做），接著是工具；目前工具要用的選項接在同一列，最右邊是提交 */}
          <div className="topo-tool-group">
            {tool(t('topo.undo'), 'Z', undoOnce, { disabled: undo.current.length === 0, icon: <Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /> })}
            {tool(t('topo.redo'), 'Y', redoOnce, { disabled: redo.current.length === 0, icon: <Icon d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /> })}
          </div>
          <div className="topo-tool-group" role="group" aria-label={t('topo.tools')}>
            {tool(t('topo.modeLine'), 'L', () => setMode('line'), { pressed: mode === 'line', disabled: !route })}
            {tool('Bolt', 'B', () => setMode('bolt'), { pressed: mode === 'bolt', disabled: positions.length === 0 })}
            {tool(t('topo.modeCrop'), 'C', () => setMode('crop'), { pressed: mode === 'crop' })}
            {tool(t('topo.fork'), 'F', () => setForking((on) => !on), { pressed: isForking, disabled: !canFork && !isForking })}
          </div>
          {mode === 'bolt' && route && (
            <div className="topo-tool-group topo-positions" role="group" aria-label={t('topo.boltPosition')}>
              {positions.map((p) => (
                <button key={p} type="button" className={current.bolts?.[p] ? 'chip placed' : 'chip'} aria-pressed={p === placing} onClick={() => setBoltPos(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
          {isForking && <span className="edit-status">{t('topo.forkPick')}</span>}
          {mode === 'crop' && (
            <div className="topo-tool-group">
              {tool(t('topo.cropDone'), 'Enter', () => setMode('line'))}
              {tool(t('topo.cropReset'), undefined, () => setCrop({ x: 0, y: 0, w: 10000, h: 10000 }, true), { disabled: isFullCrop(crop) })}
            </div>
          )}
          <div className="topo-tool-group topo-stepper" role="group" aria-label={t('topo.keys.prevRoute')}>
            {tool(t('topo.keys.prevRoute'), '↑', () => stepRoute(-1), { iconOnly: true, icon: <Icon d="m6 15 6-6 6 6" /> })}
            {tool(t('topo.keys.nextRoute'), '↓', () => stepRoute(1), { iconOnly: true, icon: <Icon d="m6 9 6 6 6-6" /> })}
            {route && (
              <span className="topo-current-route">
                {route.number ?? '·'} {localName(route.name, lang).main}
              </span>
            )}
          </div>
          {tool(t('topo.clearRoute'), undefined, () => edit(() => ({})), { disabled: !route || !marks[route.id] })}
          <span className="edit-spacer" />
          <span className={needRoute ? 'edit-status warn-text' : 'edit-status'} role="status">
            {needRoute ? t('topo.needRoute') : changed ? t('topo.draft') : saved ? t('topo.saved') : t('topo.noChanges')}
          </span>
          {tool(t('topo.discard'), undefined, discard, { disabled: !draft || busy })}
          <button type="button" className="edit-btn primary" disabled={!changed || needRoute || busy} onClick={() => void submit()}>
            {busy ? t('topo.submitting') : t('topo.submit')}
          </button>
        </div>
      )}
      <div className="topo-edit-photo" style={{ '--fit-aspect': fitAspect } as CSSProperties}>
        <button type="button" className="topo-full-btn" aria-pressed={full} aria-label={t('topo.fullscreen')} title={t('topo.fullscreen')} onClick={toggleFull}>
          <Icon d={full ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
        </button>
        <ZoomPane>
          {(zoom) => (
            <TopoFrame
              photo={photo}
              alt=""
              crop={shownCrop}
              svgProps={{ className: preview ? undefined : `editing ${mode}`, onClick: onPhotoClick, onContextMenu: (e) => e.preventDefault() }}
            >
              {(frameK) => {
                // 放大後線、點、把手維持相同的螢幕大小
                const k = frameK / zoom
                return (
                  <>
                    <TopoLines photo={photo} marks={marks} labels={labels} k={k} highlight={selected} info={info} crop={shownCrop} />
                    {handles(k)}
                    {forkPoints(k)}
                    {cropping && <CropBox photo={photo} crop={crop} k={k} onChange={setCrop} />}
                  </>
                )
              }}
            </TopoFrame>
          )}
        </ZoomPane>
      </div>

      {side &&
        createPortal(
          <div className="topo-edit-side">
            {preview ? (
              <div className="topo-edit-bar notice">
                <span>{t('topo.previewing', { time: relativeTime(new Date(preview.createdAt).toISOString(), t), name: displayName(profiles, preview.uid) })}</span>
                <button
                  className="action"
                  onClick={() => {
                    record(base())
                    setDraft({ base: latest?.id, marks: preview.marks, ...(preview.crop ? { crop: preview.crop } : {}) })
                    setPreview(undefined)
                  }}
                >
                  {t('topo.restore')}
                </button>
                <button className="action" onClick={() => setPreview(undefined)}>
                  {t('topo.backToEditing')}
                </button>
              </div>
            ) : null}
            {changed && draft?.base !== latest?.id && <p className="small warn-text">{t('topo.newerVersion')}</p>}
            {error && <p className="small error">{error}</p>}

            <ul className="topo-route-list">
              {routes.map((r) => {
                const m = marks[r.id]
                const bolts = Object.keys(m?.bolts ?? {}).length
                const total = boltPositions(r).length
                return (
                  <li key={r.id}>
                    <button className={`topo-route-row${r.id === selected ? ' on' : ''}`} onClick={() => pick(r.id)}>
                      <span className="topo-route-no">{r.number ?? '·'}</span>
                      <span className="topo-route-name">{localName(r.name, lang).main}</span>
                      <GradePill grade={r.grade} value={r.gradeValue} size="sm" />
                      <span className="topo-route-state muted small">{[m?.line && '●', total > 0 && bolts > 0 && `${bolts}/${total}`].filter(Boolean).join(' ')}</span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* 其他快捷鍵都標在上方工具列的按鈕上；這裡只留沒有按鈕的操作 */}
            {!preview && <EditKeys rows={[{ keys: t('topo.keys.rightClick'), label: t('topo.keys.deletePoint') }]} />}

            <HistorySection title={t('topo.history')}>
              <div className="topo-history">
                {edits.length === 0 ? (
                  <p className="muted small">{t('topo.noHistory')}</p>
                ) : (
                  <ul>
                    {[...edits].reverse().map((e) => (
                      <li key={e.id} className={preview?.id === e.id ? 'on' : undefined}>
                        <button className="link-button" onClick={() => setPreview(preview?.id === e.id ? undefined : e)}>
                          {relativeTime(new Date(e.createdAt).toISOString(), t)} · {displayName(profiles, e.uid)}
                        </button>
                        <span className="muted small"> {t('count.routesShort', { n: Object.keys(e.marks).length })}</span>
                        {e === latest && <span className="muted small"> · {t('topo.current')}</span>}
                        {(e.uid === uid || isAdmin) && (
                          <button className="link-button topo-history-delete" onClick={() => void deleteEdit(e)}>
                            {t('topo.delete')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {(photo.uid === uid || isAdmin) && (
                  <button className="link-button danger" onClick={() => void deletePhoto()}>
                    {t('topo.deletePhoto')}
                  </button>
                )}
              </div>
            </HistorySection>
          </div>,
          side,
        )}
    </div>
  )
}
