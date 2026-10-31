import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch'
import { GradePill } from '../components/GradePill'
import type { LoadedData } from '../data/dataset'
import { localName, useLang } from '../i18n'
import { useCoarse, useWide } from '../layout'
import { href } from '../router'
import { CropBox } from './CropBox'
import { addLinePoint, fillShared, forkLine, moveSharedPoint, syncShared } from './lines'
import {
  boltPositions,
  isFullCrop,
  SCALE,
  sameCrop,
  sameMarks,
  toCropPoint,
  type Crop,
  type Marks,
  type Point,
  type RouteMarks,
  type TopoPhoto,
} from './model'
import { loadAllEdits, loadPhotos, useTopoState } from './store'
import {
  initialLabContent,
  isTapGesture,
  LAB_PHOTOS,
  labStorageKey,
  parseLabJson,
  screenK,
  serializeLabJson,
  TAP_MAX_PX,
} from './topoLab'
import { routeLabels } from './TopoSection'
import { px, routeInfo, TopoFrame, TopoLines } from './TopoView'

type Mode = 'line' | 'bolt' | 'crop'
type ViewMode = 'edit' | 'view'

interface Content {
  marks: Marks
  crop?: Crop
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

function readStoredLab(photoId: string): Content | undefined {
  try {
    const raw = localStorage.getItem(labStorageKey(photoId))
    if (!raw) return undefined
    const parsed = parseLabJson(raw)
    return { marks: parsed.marks, ...(parsed.crop ? { crop: parsed.crop } : {}) }
  } catch {
    return undefined
  }
}

function writeStoredLab(photoId: string, json: string | undefined) {
  try {
    if (json) localStorage.setItem(labStorageKey(photoId), json)
    else localStorage.removeItem(labStorageKey(photoId))
  } catch {
    /* 私密瀏覽無法寫入時只保留在記憶體 */
  }
}

/**
 * Topo Lab（/topo-lab）：隔離的手機 Topo 編輯實驗頁。
 * 免登入、不寫入 Firebase，直接載入現有兩張測試照片，以 react-zoom-pan-pinch 搭配 SVG 編輯器驗證：
 * 1. 單指點擊新增／線段中間插點、拖曳移動控制點、刪除控制點
 * 2. 雙指捏合縮放、單指拖曳平移與單指點擊畫線互不衝突
 * 3. 縮放時維持恆定螢幕線寬與獨立觸控命中範圍
 * 4. 單張照片多條路線繪製、選取與 Viewer 高亮切換
 * 5. JSON 儲存與重新載入後路線座標完全一致
 */
export function TopoLabPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const topoState = useTopoState()

  useEffect(() => {
    void loadPhotos()
    void loadAllEdits()
  }, [])

  const photos = useMemo<TopoPhoto[]>(() => {
    const live = Object.values(topoState.photos ?? {})
    if (live.length === 0) return LAB_PHOTOS
    const byId = new Map(LAB_PHOTOS.map((p) => [p.id, p]))
    for (const p of live) byId.set(p.id, p)
    return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
  }, [topoState.photos])

  const [photoId, setPhotoId] = useState<string>(LAB_PHOTOS[0].id)
  const photo = photos.find((p) => p.id === photoId) ?? photos[0]
  const found = data.sectorById.get(photo.sector)
  const sector = found?.sector
  const routes = sector?.routes ?? []
  const labels = useMemo(() => (sector ? routeLabels(sector) : new Map<string, string>()), [sector])

  const defaultContent = useMemo<Content>(() => {
    const liveLatest = topoState.edits[photo.id]?.at(-1)
    if (liveLatest) return { marks: liveLatest.marks, ...(liveLatest.crop ? { crop: liveLatest.crop } : {}) }
    return initialLabContent(photo.id)
  }, [photo.id, topoState.edits])

  return (
    <div className={`edit-app topo-lab${wide ? '' : ' narrow focus'}`}>
      <LabEditor
        key={photo.id}
        photo={photo}
        photos={photos}
        onSelectPhoto={setPhotoId}
        routes={routes}
        labels={labels}
        defaultContent={defaultContent}
        sectorName={sector ? localName(sector.name, lang).main : photo.id}
        photoLabel={(p) => {
          const s = data.sectorById.get(p.sector)?.sector
          return s ? localName(s.name, lang).main : p.id
        }}
        backLabel={t('app.title')}
      />
    </div>
  )
}

function LabEditor({
  photo,
  photos,
  onSelectPhoto,
  routes,
  labels,
  defaultContent,
  sectorName,
  photoLabel,
  backLabel,
}: {
  photo: TopoPhoto
  photos: TopoPhoto[]
  onSelectPhoto: (id: string) => void
  routes: LoadedData['dataset']['areas'][number]['sectors'][number]['routes']
  labels: Map<string, string>
  defaultContent: Content
  sectorName: string
  photoLabel: (p: TopoPhoto) => string
  backLabel: string
}) {
  const { lang, t } = useLang()
  const coarse = useCoarse()
  const info = useMemo(() => routeInfo(routes, (r) => localName(r.name, lang).main), [routes, lang])

  const [content, setContent] = useState<Content>(() => readStoredLab(photo.id) ?? defaultContent)
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [mode, setMode] = useState<Mode>('line')
  const [selected, setSelected] = useState<string | undefined>(() => routes.find((r) => r.number)?.id ?? routes[0]?.id)
  const [boltPos, setBoltPos] = useState<string>()
  const [forking, setForking] = useState(false)
  const [picked, setPicked] = useState<{ kind: 'line'; index: number; at: Point } | { kind: 'bolt'; pos: string }>()
  const [zoom, setZoom] = useState(1)
  const [showJson, setShowJson] = useState(false)
  const [jsonText, setJsonText] = useState(() => serializeLabJson(photo.id, content.marks, content.crop))
  const [jsonError, setJsonError] = useState<string>()
  const [statusMsg, setStatusMsg] = useState<string>()

  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null)
  const undo = useRef<Content[]>([])
  const redo = useRef<Content[]>([])
  const [, setHistoryTick] = useState(0)
  const tick = () => setHistoryTick((n) => n + 1)

  const marks = useMemo(() => fillShared(content.marks, routes), [content.marks, routes])
  const crop = content.crop
  const route = routes.find((r) => r.id === selected)
  const positions = route ? boltPositions(route) : []
  const current: RouteMarks = (selected && marks[selected]) || {}
  const nextPos = positions.find((p) => !current.bolts?.[p])
  const placing = boltPos && positions.includes(boltPos) ? boltPos : nextPos
  const cropping = viewMode === 'edit' && mode === 'crop'
  const shownCrop = cropping ? undefined : crop
  const fitAspect = (photo.width * (shownCrop?.w ?? SCALE)) / (photo.height * (shownCrop?.h ?? SCALE))

  const forkable = Object.entries(marks).filter(([id, m]) => id !== selected && m.line)
  const canFork = viewMode === 'edit' && mode === 'line' && !!route && !current.line && forkable.length > 0
  const isForking = forking && canFork
  const modified = !(sameMarks(content.marks, defaultContent.marks) && sameCrop(content.crop, defaultContent.crop))

  const commit = (next: Content) => {
    setContent(next)
    const serialized = serializeLabJson(photo.id, next.marks, next.crop)
    setJsonText(serialized)
    setJsonError(undefined)
  }

  const record = (before: Content) => {
    undo.current.push(before)
    redo.current = []
    tick()
  }

  const undoOnce = () => {
    const prev = undo.current.pop()
    if (!prev || viewMode !== 'edit') return
    redo.current.push(content)
    commit(prev)
    tick()
  }

  const redoOnce = () => {
    const next = redo.current.pop()
    if (!next || viewMode !== 'edit') return
    undo.current.push(content)
    commit(next)
    tick()
  }

  const pick = (id: string) => {
    setSelected(id)
    setBoltPos(undefined)
    setForking(false)
    setPicked(undefined)
  }

  const edit = (change: (m: RouteMarks) => RouteMarks) => {
    if (!selected) return
    const { marks: before, crop: keep } = content
    record({ marks: before, crop: keep })
    let next = { ...before, [selected]: change(before[selected] ?? {}) }
    if (!next[selected].line?.length && !Object.keys(next[selected].bolts ?? {}).length) delete next[selected]
    next = syncShared(next, before, selected, routes)
    commit({ marks: next, crop: keep })
  }

  const editMarks = (change: (all: Marks) => Marks) => {
    const { marks: before, crop: keep } = content
    record({ marks: before, crop: keep })
    commit({ marks: change(before), crop: keep })
  }

  const setCrop = (next: Crop, recordUndo = false) => {
    if (recordUndo) record(content)
    commit({ marks: content.marks, crop: isFullCrop(next) ? undefined : next })
  }

  const stepRoute = (delta: number) => {
    const i = routes.findIndex((r) => r.id === selected)
    const next = routes[Math.min(routes.length - 1, Math.max(0, (i < 0 ? (delta > 0 ? -1 : routes.length) : i) + delta))]
    if (next) pick(next.id)
  }

  const pickedLive =
    viewMode === 'edit' && mode !== 'crop' && picked && (picked.kind === 'line' ? !!current.line?.[picked.index] : !!current.bolts?.[picked.pos])
      ? picked
      : undefined

  const removePicked = () => {
    const target = pickedLive
    if (!target) return
    setPicked(undefined)
    edit((m) => {
      if (target.kind === 'line') return { ...m, line: m.line!.filter((_, j) => j !== target.index) }
      const bolts = { ...m.bolts }
      delete bolts[target.pos]
      return { ...m, bolts }
    })
  }

  const pointAt = (e: { clientX: number; clientY: number }, svg: SVGSVGElement): Point => {
    const r = svg.getBoundingClientRect()
    return toCropPoint(crop, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  // ── 單指點擊 vs 平移／雙指縮放手勢分離 ──
  const tapState = useRef<{ id: number; start: { x: number; y: number }; moved: boolean; multi: boolean } | null>(null)
  const lastPointerTapAt = useRef(0)
  const dragging = useRef<{ kind: 'line'; index: number; at: Point } | { kind: 'bolt'; pos: string } | null>(null)

  const addPointAt = (client: { clientX: number; clientY: number }, svg: SVGSVGElement) => {
    if (viewMode !== 'edit' || mode === 'crop' || isForking || !selected || dragging.current) return
    const p = pointAt(client, svg)
    setPicked(undefined)
    if (mode === 'line') editMarks((all) => addLinePoint(all, selected, p, photo.width / photo.height))
    else if (placing) {
      edit((m) => ({ ...m, bolts: { ...m.bolts, [placing]: p } }))
      setBoltPos(undefined)
    }
  }

  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('.topo-handles, .topo-fork, .topo-crop')) return
    if (tapState.current) {
      tapState.current.multi = true
      return
    }
    if (e.button !== 0) return
    tapState.current = { id: e.pointerId, start: { x: e.clientX, y: e.clientY }, moved: false, multi: false }
  }

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const st = tapState.current
    if (!st || e.pointerId !== st.id) return
    if (Math.hypot(e.clientX - st.start.x, e.clientY - st.start.y) > TAP_MAX_PX) {
      st.moved = true
    }
  }

  const onSvgPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const st = tapState.current
    if (!st || e.pointerId !== st.id) return
    tapState.current = null
    if (isTapGesture(st.start, { x: e.clientX, y: e.clientY }, st.moved, st.multi)) {
      lastPointerTapAt.current = Date.now()
      addPointAt(e, e.currentTarget)
    }
  }

  const onSvgPointerCancel = () => {
    tapState.current = null
  }

  const onSvgClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (Date.now() - lastPointerTapAt.current < 350) return
    if ((e.target as Element).closest('.topo-handles, .topo-fork, .topo-crop')) return
    addPointAt(e, e.currentTarget)
  }

  // ── 拖曳控制點／Bolt 把手（已列入 react-zoom-pan-pinch 的 panning.excluded，不觸發畫布平移） ──
  const startDrag = (e: ReactPointerEvent<SVGElement>, target: NonNullable<typeof dragging.current>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = target
    setPicked(target)
    edit((m) => m)
  }

  const onDrag = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragging.current
    const svg = e.currentTarget.ownerSVGElement
    if (!d || !svg || !selected) return
    const p = pointAt(e, svg)
    const { marks: all, crop: keep } = content
    if (d.kind === 'line') {
      commit({ marks: moveSharedPoint(all, d.at, p), crop: keep })
      d.at = p
      return
    }
    const m = all[selected] ?? {}
    commit({ marks: syncShared({ ...all, [selected]: { ...m, bolts: { ...m.bolts, [d.pos]: p } } }, all, selected, routes), crop: keep })
  }

  const endDrag = () => {
    setTimeout(() => {
      dragging.current = null
    })
  }

  // ── JSON 儲存與重新載入 ──
  const saveJson = () => {
    const serialized = serializeLabJson(photo.id, content.marks, content.crop)
    writeStoredLab(photo.id, serialized)
    setJsonText(serialized)
    setJsonError(undefined)
    setStatusMsg('已儲存 JSON')
  }

  const reloadJson = (rawInput?: string) => {
    try {
      const source = rawInput ?? localStorage.getItem(labStorageKey(photo.id)) ?? jsonText
      const parsed = parseLabJson(source)
      record(content)
      const next: Content = { marks: parsed.marks, ...(parsed.crop ? { crop: parsed.crop } : {}) }
      setContent(next)
      const canonical = serializeLabJson(photo.id, next.marks, next.crop)
      writeStoredLab(photo.id, canonical)
      setJsonText(canonical)
      setJsonError(undefined)
      setStatusMsg('已載入 JSON')
    } catch (err) {
      setJsonError((err as Error).message)
    }
  }

  const resetSample = () => {
    record(content)
    writeStoredLab(photo.id, undefined)
    commit(defaultContent)
    undo.current = []
    redo.current = []
    setPicked(undefined)
    setStatusMsg('已重設範例')
    tick()
  }

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
                r={(coarse ? 13 : 7) * k}
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
    viewMode === 'edit' &&
    mode !== 'crop' &&
    selected && (
      <g className="topo-handles">
        {current.line?.map((p, i) => {
          const [x, y] = px(photo, p)
          return (
            <circle
              key={`l${i}`}
              className={[i === 0 && 'start', pickedLive?.kind === 'line' && pickedLive.index === i && 'picked'].filter(Boolean).join(' ') || undefined}
              cx={x}
              cy={y}
              r={(coarse ? 13 : 6) * k}
              strokeWidth={2 * k}
              onPointerDown={(e) => startDrag(e, { kind: 'line', index: i, at: p })}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onLostPointerCapture={endDrag}
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
              className={pickedLive?.kind === 'bolt' && pickedLive.pos === pos ? 'bolt picked' : 'bolt'}
              x={x - 32 * k}
              y={y - (coarse ? 22 : 14) * k}
              width={64 * k}
              height={(coarse ? 44 : 28) * k}
              rx={(coarse ? 22 : 14) * k}
              strokeWidth={2 * k}
              onPointerDown={(e) => startDrag(e, { kind: 'bolt', pos })}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onLostPointerCapture={endDrag}
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
    <>
      <header className="edit-top topo-lab-top">
        <a className="edit-back" href={href.home()}>
          ← {backLabel}
        </a>
        <strong className="edit-title">Topo Lab</strong>
        <div className="topo-lab-photos" role="tablist" aria-label="Topo">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === photo.id}
              className={`chip${p.id === photo.id ? ' active' : ''}`}
              onClick={() => onSelectPhoto(p.id)}
            >
              {photoLabel(p)}
            </button>
          ))}
        </div>
        <span className="edit-spacer" />
        <div className="topo-lab-modes" role="group">
          <button type="button" className="edit-btn" aria-pressed={viewMode === 'edit'} onClick={() => setViewMode('edit')}>
            {t('topo.edit')}
          </button>
          <button type="button" className="edit-btn" aria-pressed={viewMode === 'view'} onClick={() => setViewMode('view')}>
            Viewer
          </button>
          <button type="button" className="edit-btn" aria-pressed={showJson} onClick={() => setShowJson((s) => !s)}>
            JSON
          </button>
        </div>
      </header>

      <section className="edit-center edit-topo topo-lab-center">
        <div className="topo-edit-layout">
          {viewMode === 'edit' && (
            <div className="topo-edit-toolbar" role="toolbar" aria-label={t('topo.toolbar')}>
              <div className="topo-tools-row">
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
                {tool(t('topo.deletePoint'), 'Delete', removePicked, { disabled: !pickedLive })}
                {tool(t('topo.clearRoute'), undefined, () => edit(() => ({})), { disabled: !route || !marks[route.id] })}
              </div>
              <span className="edit-spacer" />
              <span className="edit-status" role="status">
                {statusMsg ?? (modified ? t('topo.draft') : t('topo.noChanges'))}
              </span>
              <button type="button" className="edit-btn" onClick={() => reloadJson()}>
                載入 JSON
              </button>
              <button type="button" className="edit-btn primary" onClick={saveJson}>
                儲存 JSON
              </button>
            </div>
          )}

          <div className="topo-edit-photo topo-lab-stage" style={{ '--fit-aspect': fitAspect } as CSSProperties}>
            <div className="topo-zoom pinchable">
              <TransformWrapper
                ref={transformRef}
                minScale={1}
                maxScale={8}
                limitToBounds
                centerOnInit
                doubleClick={{ disabled: true }}
                panning={{ velocityDisabled: true, excluded: ['topo-handles', 'topo-fork', 'topo-crop', 'topo-zoom-controls'] }}
                wheel={{ step: 0.15 }}
                onTransform={(_, s) => setZoom(s.scale)}
                onPinchStart={() => {
                  if (tapState.current) tapState.current.multi = true
                  dragging.current = null
                }}
              >
                <TransformComponent
                  wrapperClass="topo-lab-transform-wrapper"
                  contentClass="topo-lab-transform-content"
                  wrapperStyle={{ width: '100%' }}
                  contentStyle={{ width: '100%', display: 'block' }}
                >
                  <TopoFrame
                    photo={photo}
                    alt={sectorName}
                    crop={shownCrop}
                    svgProps={{
                      className: viewMode === 'edit' ? `editing ${mode}` : undefined,
                      onPointerDown: onSvgPointerDown,
                      onPointerMove: onSvgPointerMove,
                      onPointerUp: onSvgPointerUp,
                      onPointerCancel: onSvgPointerCancel,
                      onClick: onSvgClick,
                      onContextMenu: (e) => e.preventDefault(),
                    }}
                  >
                    {(frameK) => {
                      const k = screenK(frameK, zoom)
                      return (
                        <>
                          <TopoLines
                            photo={photo}
                            marks={marks}
                            labels={labels}
                            k={k}
                            highlight={selected}
                            info={info}
                            crop={shownCrop}
                            onPick={viewMode === 'view' ? pick : undefined}
                          />
                          {handles(k)}
                          {forkPoints(k)}
                          {cropping && <CropBox photo={photo} crop={crop} k={k} onChange={setCrop} />}
                        </>
                      )
                    }}
                  </TopoFrame>
                </TransformComponent>
              </TransformWrapper>

              <div className="topo-zoom-controls">
                <button type="button" aria-label={t('topo.zoomOut')} title={t('topo.zoomOut')} onClick={() => void transformRef.current?.zoomOut(0.4, 0)}>
                  −
                </button>
                <button type="button" className="topo-zoom-fit" aria-label={t('topo.zoomFit')} title={t('topo.zoomFit')} onClick={() => void transformRef.current?.resetTransform(0)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" aria-label={t('topo.zoomIn')} title={t('topo.zoomIn')} onClick={() => void transformRef.current?.zoomIn(0.4, 0)}>
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="edit-panel topo-lab-panel">
        <div className="topo-edit-side">
          <ul className="topo-route-list">
            {routes.map((r) => {
              const m = marks[r.id]
              const bolts = Object.keys(m?.bolts ?? {}).length
              const total = boltPositions(r).length
              return (
                <li key={r.id}>
                  <button type="button" className={`topo-route-row${r.id === selected ? ' on' : ''}`} onClick={() => pick(r.id)}>
                    <span className="topo-route-no">{r.number ?? '·'}</span>
                    <span className="topo-route-name">{localName(r.name, lang).main}</span>
                    <GradePill grade={r.grade} value={r.gradeValue} size="sm" />
                    <span className="topo-route-state muted small">{[m?.line && '●', total > 0 && bolts > 0 && `${bolts}/${total}`].filter(Boolean).join(' ')}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          {showJson && (
            <div className="topo-lab-json">
              <textarea
                aria-label="Topo JSON"
                rows={8}
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  setJsonError(undefined)
                }}
              />
              {jsonError && <p className="small error">{jsonError}</p>}
              <div className="topo-lab-json-actions">
                <button type="button" className="edit-btn primary" onClick={() => reloadJson(jsonText)}>
                  套用 JSON
                </button>
                <button type="button" className="edit-btn" onClick={resetSample}>
                  重設範例
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
