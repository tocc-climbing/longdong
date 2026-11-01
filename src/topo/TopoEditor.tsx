import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useIsAdmin } from '../admin'
import { GradePill } from '../components/GradePill'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import type { Route, Sector } from '../data/schema'
import { relativeTime } from '../format'
import { localName, useLang } from '../i18n'
import { useCoarse, useWide } from '../layout'
import { NotFound } from '../pages/AreaPage'
import { useCloud } from '../personal/sync'
import { href, navigate } from '../router'
import { displayName, useSocial } from '../social/store'
import { removeEdit, removeTopo, submitEdit } from './actions'
import { smoothPath, type Pt } from '../core/topo/annotate'
import { CropBox } from './CropBox'
import { addLinePoint, forkLine, moveSharedPoint } from '../core/topo/lines'
import { fillShared, syncShared } from './shared'
import { boltPositions, imageUrl, sameMarks, type TopoEdit, type TopoPhoto } from './model'
import { FULL_CROP, isFullCrop, SCALE, sameCrop, toCropPoint, type Crop, type Marks, type Point, type RouteMarks } from '../core/topo/geometry'
import { savedOverlay, useBackGuard, type EditOverlay } from '../edit/backGuard'
import { HistorySection } from '../edit/HistorySection'
import { EditKeys } from '../edit/KeyList'
import { loadEdits, loadPhotos, useSectorTopos, useTopoState } from './store'
import { routeLabels } from './TopoSection'
import { px, RouteReveal, TopoFrame, TopoLines } from '../core/topo/TopoView'
import { routeInfo } from './routeInfo'
import { UploadButton } from './TopoUpload'
import { DRAG_PX, ZoomPane, type ZoomFocus } from './ZoomPane'
import '../edit/edit.css'

/**
 * Topo 編輯（電腦、手機）：照片上標記線段（由起攀點往上）與 bolt，另外選路線；手機的單指、雙指手勢在 ZoomPane。
 * 修改先存在這台裝置的草稿，按「提交」才上傳成新的版本；所有版本都保留，可以預覽、從舊版本繼續修改。
 * 手機版（窄螢幕）是整個畫面的編輯器（PhoneShell）：照片盡量大，關閉、提交、工具都浮在照片上，下面是路線清單；onClose 回到原來的畫面。
 * initial：一開始選的路線（從路線頁進來時是那條路線）。
 */
export function TopoEditor({
  data,
  id,
  embedded,
  side,
  initial,
  owner,
  onClose,
}: {
  data: LoadedData
  id: string
  embedded?: boolean
  side: HTMLElement | null
  initial?: string
  /** 手機版就地編輯：打開編輯器的那一頁（記在瀏覽紀錄裡） */
  owner?: string
  onClose: () => void
}) {
  const { lang, t } = useLang()
  const cloud = useCloud()
  const state = useTopoState()
  const phone = !useWide()
  useEffect(() => {
    void loadPhotos()
    void loadEdits(id)
  }, [id])

  const photo = state.photos?.[id]
  const edits = state.edits[id]
  const found = photo && data.sectorById.get(photo.sector)
  const signedIn = cloud.status === 'signed-in'
  if (phone && !(edits && found && signedIn))
    return (
      <PhoneShell onClose={onClose} overlay={{ kind: 'topo', owner, photo: id }}>
        <header className="topo-phone-top">
          <CloseButton />
        </header>
        <div className="topo-phone-message">
          {!state.photos || !edits ? <p className="muted">{t('app.loading')}</p> : !found ? <NotFound /> : cloud.status !== 'loading' && <SignInPrompt />}
        </div>
      </PhoneShell>
    )
  if (!state.photos || !edits) return <p className="empty muted">{t('app.loading')}</p>
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
      {cloud.status !== 'signed-in' ? (
        cloud.status !== 'loading' && <SignInPrompt />
      ) : (
        <Editor
          photo={photo}
          edits={edits}
          routes={sector.routes}
          labels={routeLabels(sector)}
          uid={cloud.user!.uid}
          side={side}
          initial={initial}
          owner={owner}
          onClose={phone ? onClose : undefined}
        />
      )}
    </div>
  )
}

/**
 * 手機版在路線頁、分區頁、區域頁就地編輯 Topo（不換頁，關閉回到原來那一頁）：
 * photo 沒指定時用標了這條路線（routeId）的第一張，沒有就用分區的第一張；分區還沒有照片時先上傳，上傳完接著編輯那一張。
 * owner：打開編輯器的那一頁。
 */
export function InlineTopoEditor({
  data,
  sector,
  routeId,
  photo,
  owner,
  onClose,
}: {
  data: LoadedData
  sector: Sector
  routeId?: string
  photo?: string
  owner: string
  onClose: () => void
}) {
  const { t } = useLang()
  const cloud = useCloud()
  const topos = useSectorTopos(sector.id)
  const [uploaded, setUploaded] = useState<string>()
  const id = photo ?? uploaded ?? ((routeId && topos?.find((x) => x.latest?.marks[routeId])) || topos?.[0])?.photo.id
  if (id) return <TopoEditor data={data} id={id} side={null} initial={routeId} owner={owner} onClose={onClose} />
  return (
    <PhoneShell onClose={onClose} overlay={{ kind: 'topo', owner }}>
      <header className="topo-phone-top">
        <CloseButton />
      </header>
      <div className="topo-phone-message">
        {!topos || cloud.status === 'loading' ? (
          <p className="muted">{t('app.loading')}</p>
        ) : cloud.status === 'signed-in' ? (
          <UploadButton sector={sector.id} onUploaded={setUploaded} />
        ) : (
          <SignInPrompt />
        )}
      </div>
    </PhoneShell>
  )
}

/** PhoneShell 的關閉（退掉返回手勢用的那一筆瀏覽紀錄再關閉），給關閉按鈕用 */
const ShellClose = createContext<() => void>(() => {})

/**
 * 手機版的編輯畫面：蓋住整個頁面（dialog）。
 * 返回手勢（Android 返回鍵、iOS 從左緣滑回、Esc）先交給 onBack（關面板、結束畫線…），沒有要處理的才關閉（useBackGuard）；
 * 打開的狀態記在瀏覽紀錄裡（overlay），App 被系統關掉、重新載入後回到原來的編輯；修改本身一直存在這台裝置的草稿。
 * 觸控不往外傳：App 的左右滑動換頁（swipe.ts）掛在外層，編輯時的拖曳、縮放不能換頁。
 */
function PhoneShell({
  onClose,
  onBack = () => false,
  overlay,
  label,
  children,
}: {
  onClose: () => void
  onBack?: () => boolean
  overlay: EditOverlay
  label?: string
  children: ReactNode
}) {
  const close = useBackGuard(overlay, onBack, onClose)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current!
    el.showModal()
    const stop = (e: Event) => e.stopPropagation()
    const events = ['touchstart', 'touchmove', 'touchend', 'touchcancel']
    for (const name of events) el.addEventListener(name, stop)
    return () => {
      for (const name of events) el.removeEventListener(name, stop)
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="topo-phone"
      aria-label={label}
      onCancel={(e) => {
        // Android 的返回鍵在 dialog 打開時是 cancel（不是上一頁）：和返回手勢一樣處理
        e.preventDefault()
        if (!onBack()) close()
      }}
    >
      <ShellClose.Provider value={close}>{children}</ShellClose.Provider>
    </dialog>
  )
}

function CloseButton() {
  const { t } = useLang()
  const close = useContext(ShellClose)
  return (
    <button type="button" className="topo-round topo-phone-close" aria-label={t('layout.close')} onClick={close}>
      <Icon d="M6 6l12 12M18 6 6 18" />
    </button>
  )
}

/** 手機版定線時照片的底色：灰階（選到的路線周圍保留原色、其他路線淡一點）或原色；記在這台裝置 */
const GRAY_KEY = 'longdong.topoGray'

function useGrayBase() {
  const [gray, setGray] = useState(() => {
    try {
      return localStorage.getItem(GRAY_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggle = () =>
    setGray((on) => {
      try {
        localStorage.setItem(GRAY_KEY, on ? '0' : '1')
      } catch {
        // 存不了就只在這次有效
      }
      return !on
    })
  return [gray, toggle] as const
}

/** 從下方滑出的面板（路線清單）：點外面關閉；也是 dialog，返回手勢、Esc 先關這個，不會關掉整個編輯器 */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => ref.current!.showModal(), [])
  return (
    <dialog
      ref={ref}
      className="topo-sheet-backdrop"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="topo-sheet">{children}</div>
    </dialog>
  )
}

/** 放大鏡的大小（螢幕像素）與倍率（比照片目前在畫面上放大幾倍） */
const LOUPE_PX = 128
const LOUPE_ZOOM = 2.5

/** 手指擋住的範圍：放大鏡的下緣離手指這麼遠（螢幕像素） */
const LOUPE_GAP = 36

/** 放大鏡：at 是中心（萬分比），span 是看得到的寬度（照片像素）；x、y 是放大鏡左上角在照片區的位置 */
interface LoupeState {
  at: Point
  span: number
  x: number
  y: number
}

/**
 * 放大鏡：手指按住瞄準、拖曳點時，手指底下那一塊放大顯示在手指正上方（上面放不下時放在旁邊），
 * 十字中心就是點會放的位置；也畫出這條路線目前的線與點。
 */
function Loupe({ photo, loupe, line, kind }: { photo: TopoPhoto; loupe: LoupeState; line?: Point[]; kind?: string }) {
  const [cx, cy] = px(photo, loupe.at)
  const span = loupe.span
  const k = span / LOUPE_PX
  const pts = (line ?? []).map((p) => px(photo, p) as Pt)
  return (
    <div className={`topo-loupe kind-${kind ?? 'other'}`} style={{ left: loupe.x, top: loupe.y }} aria-hidden>
      <svg viewBox={`${cx - span / 2} ${cy - span / 2} ${span} ${span}`} width={LOUPE_PX} height={LOUPE_PX}>
        <image href={imageUrl(photo.image)} x={0} y={0} width={photo.width} height={photo.height} />
        {pts.length >= 2 && <path className="topo-loupe-line" d={smoothPath(pts)} strokeWidth={2 * k} />}
        {pts.map(([x, y], i) => (
          <circle key={i} className="topo-loupe-point" cx={x} cy={y} r={4 * k} />
        ))}
        <path
          className="topo-loupe-cross"
          d={`M${cx - 14 * k} ${cy}h${10 * k}M${cx + 4 * k} ${cy}h${10 * k}M${cx} ${cy - 14 * k}v${10 * k}M${cx} ${cy + 4 * k}v${10 * k}`}
          strokeWidth={1.5 * k}
        />
      </svg>
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

/** 手機版：手指按住不動這麼久（毫秒）出現放大鏡，滑動對準、放開才放點 */
const AIM_MS = 250

/** select（手機版）：點照片不加點，點線選路線；line：畫線，每點一下加一個點；bolt：放 bolt；crop：裁切 */
type Mode = 'select' | 'line' | 'bolt' | 'crop'

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

/** 手指按得到的範圍（半徑，螢幕像素）：比看得到的點大，不必按得很準 */
const HIT_R = 22
/** 手指點在點旁邊這個距離內（螢幕像素，比 HIT_R 寬）：選取那個點，不加新的點 */
const NEAR_R = 36
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
  initial,
  owner,
  onClose,
}: {
  photo: TopoPhoto
  edits: TopoEdit[]
  routes: Route[]
  labels: Map<string, string>
  uid: string
  side: HTMLElement | null
  initial?: string
  owner?: string
  /** 手機版：整個畫面的編輯器，關閉時呼叫 */
  onClose?: () => void
}) {
  const { lang, t } = useLang()
  const isAdmin = useIsAdmin()
  const coarse = useCoarse()
  const profiles = useSocial().profiles
  const info = useMemo(() => routeInfo(routes, (r) => localName(r.name, lang).main), [routes, lang])
  const latest = edits.at(-1)
  const [draft, setDraftState] = useState<Draft | undefined>(() => readDraft(photo.id))
  const [preview, setPreview] = useState<TopoEdit>()
  // 手機版重新載入、App 被系統關掉再回來：回到原來選的路線（記在瀏覽紀錄裡）
  const [selected, setSelected] = useState<string | undefined>(() => (onClose && savedOverlay()?.selected) || initial || routes.find((r) => r.number)?.id)
  // 手機版從選路線開始，按「畫線」才標點；電腦版一開始就能畫
  const [mode, setMode] = useState<Mode>(onClose ? 'select' : 'line')
  const [boltPos, setBoltPos] = useState<string>()
  const [forking, setForking] = useState(false)
  /** 按住的點或 bolt：手指沒有右鍵，用工具列的「刪除這個點」刪除 */
  const [picked, setPicked] = useState<NonNullable<typeof dragging.current>>()
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /** 手機版從下方滑出的路線清單 */
  const [sheet, setSheet] = useState<'routes'>()
  const [gray, toggleGray] = useGrayBase()
  /** 手機版：放大鏡（按住瞄準、拖曳點時） */
  const [loupe, setLoupe] = useState<LoupeState>()
  /** 手機版：自動縮放到的地方（選路線、選點、繼續畫、完成） */
  const [focus, setFocus] = useState<ZoomFocus>()
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
  const canFork = !preview && (mode === 'line' || mode === 'select') && !!route && !current.line && forkable.length > 0
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
    setPicked(undefined)
  }
  /** 手機版自動縮放到照片上的一塊（萬分比）：換算成畫面上（裁切後）的比例 */
  const zoomTo = (box: { x: number; y: number; w: number; h: number }, keepZoom = false) => {
    if (!onClose) return
    const c = crop ?? FULL_CROP
    setFocus((f) => ({ x: (box.x - c.x) / c.w, y: (box.y - c.y) / c.h, w: box.w / c.w, h: box.h / c.h, seq: (f?.seq ?? 0) + 1, keepZoom }))
  }
  /** 一條路線的線與 bolt 所在的範圍（留一點邊）；還沒標記時是整張 */
  const zoomToRoute = (id: string | undefined) => {
    const m = id ? marks[id] : undefined
    const pts = [...(m?.line ?? []), ...Object.values(m?.bolts ?? {})]
    const c = crop ?? FULL_CROP
    if (pts.length === 0) return zoomTo(c)
    const xs = pts.map(([x]) => x)
    const ys = pts.map(([, y]) => y)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const w = Math.max(x1 - x0, c.w * 0.2) * 1.4
    const h = Math.max(y1 - y0, c.h * 0.2) * 1.3
    zoomTo({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h })
  }
  /** 放大到一個點附近（選點、繼續畫）：大約是整張的三分之一 */
  const zoomToPoint = ([x, y]: Point) => {
    const c = crop ?? FULL_CROP
    zoomTo({ x: x - c.w / 6, y: y - c.h / 6, w: c.w / 3, h: c.h / 3 }, true)
  }
  /** 從清單或照片上選路線：手機版接著縮放到那條路線 */
  const choose = (id: string) => {
    pick(id)
    zoomToRoute(id)
  }
  // 手機版一打開就縮放到一開始選的路線（只在打開時）
  useEffect(() => {
    if (onClose && initial) zoomToRoute(initial)
  }, [])

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
  /** 修改所有路線的標記（一次動到不只選取的路線時用） */
  const editMarks = (change: (all: Marks) => Marks) => {
    const { marks: before, crop: keep } = base()
    record({ marks: before, crop: keep })
    commit({ marks: change(before), crop: keep })
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
      } else if (key === 'delete') {
        removePicked()
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

  /** 手指點的位置附近（NEAR_R 內）最近的點；放大後點與點之間夠遠，照樣能在旁邊加點 */
  const nearPoint = (e: { clientX: number; clientY: number }, svg: SVGSVGElement): number => {
    const r = svg.getBoundingClientRect()
    const c = crop ?? FULL_CROP
    let best = -1
    let bestDistance = NEAR_R
    current.line?.forEach(([x, y], i) => {
      const d = Math.hypot(r.left + ((x - c.x) / c.w) * r.width - e.clientX, r.top + ((y - c.y) / c.h) * r.height - e.clientY)
      if (d <= bestDistance) [best, bestDistance] = [i, d]
    })
    return best
  }

  /** 在這個位置加一個點（畫線）或放目前位置的 bolt */
  /** 手機版：剛剛點一下加了點、放了 bolt 的時間；接著點兩下（回到原尺寸）時收回這一個 */
  const tapped = useRef(0)
  const placeAt = (p: Point) => {
    if (!selected) return
    tapped.current = performance.now()
    if (mode === 'line') editMarks((all) => addLinePoint(all, selected, p, photo.width / photo.height))
    else if (mode === 'bolt' && placing) {
      edit((m) => ({ ...m, bolts: { ...m.bolts, [placing]: p } }))
      setBoltPos(undefined)
    }
  }

  const onPhotoClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    // 按住瞄準已經放了點：放開後的這次點擊不再加一個
    if (aimed.current) return void (aimed.current = false)
    if (preview || mode === 'crop' || isForking || !selected || dragging.current) return
    const near = coarse && (mode === 'line' || mode === 'select') ? nearPoint(e, e.currentTarget) : -1
    if (near >= 0) {
      setPicked({ kind: 'line', index: near, at: current.line![near] })
      // 選了點要調整：放大到點附近，方便拖曳
      zoomToPoint(current.line![near])
      return
    }
    const p = pointAt(e, e.currentTarget)
    setPicked(undefined)
    if (mode !== 'select') placeAt(p)
  }

  /** 放大鏡顯示在手指的位置 */
  const showLoupe = (e: { clientX: number; clientY: number }, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect()
    const c = crop ?? FULL_CROP
    const area = svg.closest('.topo-phone-photo')?.getBoundingClientRect() ?? r
    const fx = e.clientX - area.left
    const fy = e.clientY - area.top
    const clampX = (x: number) => Math.max(4, Math.min(area.width - LOUPE_PX - 4, x))
    const above = fy - LOUPE_GAP - LOUPE_PX
    const [x, y] =
      above >= 4
        ? [clampX(fx - LOUPE_PX / 2), above]
        : // 手指在照片上緣：放在手指旁邊（左半邊放右邊，右半邊放左邊）
          [clampX(fx < area.width / 2 ? fx + LOUPE_GAP : fx - LOUPE_GAP - LOUPE_PX), Math.max(4, fy - LOUPE_PX / 2)]
    setLoupe({ at: pointAt(e, svg), span: (LOUPE_PX * px(photo, [c.w, 0])[0]) / r.width / LOUPE_ZOOM, x, y })
  }

  // 手機版按住瞄準：手指按住不動一下出現放大鏡，滑動對準，放開才放點（點一下照樣直接放）
  const aim = useRef<{ id: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; on: boolean } | null>(null)
  /** 瞄準放了點：擋掉放開後的那次點擊；下一次按下時清掉 */
  const aimed = useRef(false)
  const fingers = useRef(new Set<number>())
  const aimable = !!onClose && !preview && !isForking && !!selected && (mode === 'line' || (mode === 'bolt' && !!placing))
  const svgIn = (el: Element) => el.querySelector<SVGSVGElement>('.topo-frame svg')
  const stopAim = () => {
    if (aim.current) clearTimeout(aim.current.timer)
    aim.current = null
    setLoupe(undefined)
  }
  const aimHandlers = {
    onPointerDownCapture: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'touch') return
      // 拖曳點時改成捏合（縮放區接走手指），點可能收不到放開：按在點以外的地方時，上一次的拖曳一定結束了
      if (e.isPrimary && !(e.target as Element).closest('.topo-handles, .topo-hits')) dragging.current = null
      if (e.isPrimary) fingers.current.clear()
      fingers.current.add(e.pointerId)
      aimed.current = false
      // 第二根手指（捏合）、按在點或把手上（拖曳它們）：不瞄準
      if (fingers.current.size > 1 || !aimable || (e.target as Element).closest('.topo-handles, .topo-hits, .topo-zoom-controls')) return stopAim()
      const at = { clientX: e.clientX, clientY: e.clientY }
      const box = e.currentTarget
      const id = e.pointerId
      aim.current = {
        id,
        x: e.clientX,
        y: e.clientY,
        on: false,
        timer: setTimeout(() => {
          const svg = svgIn(box)
          if (!aim.current || aim.current.id !== id || !svg) return
          aim.current.on = true
          showLoupe(at, svg)
        }, AIM_MS),
      }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const a = aim.current
      if (!a || a.id !== e.pointerId) return
      const svg = svgIn(e.currentTarget)
      if (a.on && svg) showLoupe(e, svg)
      else if (Math.hypot(e.clientX - a.x, e.clientY - a.y) > DRAG_PX) stopAim()
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      fingers.current.delete(e.pointerId)
      const a = aim.current
      if (!a || a.id !== e.pointerId) return
      const svg = svgIn(e.currentTarget)
      if (a.on && svg) {
        placeAt(pointAt(e, svg))
        aimed.current = true
      }
      stopAim()
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => {
      fingers.current.delete(e.pointerId)
      stopAim()
    },
  }

  // 拖曳線段的點或 bolt：真的移動時才記一次復原點（只按一下、點兩下按到點不多一個復原點），移動時直接改草稿
  const dragging = useRef<{ kind: 'line'; index: number; at: Point } | { kind: 'bolt'; pos: string } | null>(null)
  const dragMoved = useRef(false)
  const startDrag = (e: ReactPointerEvent<SVGElement>, target: NonNullable<typeof dragging.current>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = target
    dragMoved.current = false
    setPicked(target)
    if (onClose && e.pointerType === 'touch' && e.currentTarget.ownerSVGElement) showLoupe(e, e.currentTarget.ownerSVGElement)
  }
  const onDrag = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragging.current
    const svg = e.currentTarget.ownerSVGElement
    if (!d || !svg || !selected) return
    const p = pointAt(e, svg)
    if (loupe) showLoupe(e, svg)
    if (!dragMoved.current) {
      dragMoved.current = true
      edit((m) => m)
    }
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
    setLoupe(undefined)
  }

  const pickedLive = !preview && mode !== 'crop' && picked && (picked.kind === 'line' ? !!current.line?.[picked.index] : !!current.bolts?.[picked.pos]) ? picked : undefined
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

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await submitEdit(photo.id, draft!.marks, draft!.crop)
      setDraft(undefined)
      clearHistory()
      setSaved(true)
      // 裁切模式顯示的是整張照片，提交後回到線段模式才看得到裁切的結果
      setMode((m) => (m === 'crop' ? (onClose ? 'select' : 'line') : m))
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

  /** 點、bolt 共用的拖曳事件 */
  const grab = (target: NonNullable<typeof dragging.current>) => ({
    onPointerDown: (e: ReactPointerEvent<SVGElement>) => startDrag(e, target),
    onPointerMove: onDrag,
    onPointerUp: endDrag,
    onLostPointerCapture: endDrag,
    onClick: (e: ReactMouseEvent) => {
      e.stopPropagation()
      // 點一下（沒拖）選了點：手機版放大到點附近，方便調整
      if (target.kind === 'line') zoomToPoint(target.at)
    },
  })

  const handles = (k: number) =>
    !preview &&
    mode !== 'crop' &&
    selected && (
      <>
        <g className={`topo-handles kind-${info?.get(selected)?.kind ?? 'other'}`}>
          {current.line?.map((p, i) => {
            const [x, y] = px(photo, p)
            return (
              <circle
                key={`l${i}`}
                className={pickedLive?.kind === 'line' && pickedLive.index === i ? 'picked' : undefined}
                cx={x}
                cy={y}
                r={(pickedLive?.kind === 'line' && pickedLive.index === i ? 6 : 4) * k}
                strokeWidth={2 * k}
                // 手指：按下的是外面那圈透明的 .topo-hits（比看得到的點大）
                pointerEvents={coarse ? 'none' : undefined}
                {...(coarse ? {} : grab({ kind: 'line', index: i, at: p }))}
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
                {...grab({ kind: 'bolt', pos })}
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
        {coarse && (
          <g className="topo-hits">
            {current.line?.map((p, i) => {
              const [x, y] = px(photo, p)
              return <circle key={`h${i}`} cx={x} cy={y} r={HIT_R * k} {...grab({ kind: 'line', index: i, at: p })} />
            })}
          </g>
        )}
      </>
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

  const undoIcon = <Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
  const redoIcon = <Icon d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />

  const positionsRow = mode === 'bolt' && route && (
    <div className="topo-tool-group topo-positions" role="group" aria-label={t('topo.boltPosition')}>
      {positions.map((p) => (
        <button key={p} type="button" className={current.bolts?.[p] ? 'chip placed' : 'chip'} aria-pressed={p === placing} onClick={() => setBoltPos(p)}>
          {p}
        </button>
      ))}
    </div>
  )

  const photoPane = (
    <ZoomPane
      holding={() => !!aim.current?.on}
      focus={focus}
      aspect={onClose ? fitAspect : undefined}
      onDoubleTap={() => {
        if (performance.now() - tapped.current < 500) undoOnce()
        tapped.current = 0
      }}
    >
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
            const revealLine = onClose && gray && selected ? marks[selected]?.line : undefined
            return (
              <>
                {revealLine && revealLine.length >= 2 && <RouteReveal photo={photo} line={revealLine} width={0.12 * px(photo, [(shownCrop ?? FULL_CROP).w, 0])[0]} />}
                <TopoLines
                  photo={photo}
                  marks={marks}
                  labels={labels}
                  k={k}
                  highlight={selected}
                  info={info}
                  crop={shownCrop}
                  editing
                  // 手機版選路線時：點照片上的線換到那條路線
                  onPick={mode === 'select' && !preview && !isForking ? choose : undefined}
                />
                {handles(k)}
                {forkPoints(k)}
                {cropping && <CropBox photo={photo} crop={crop} k={k} onChange={setCrop} />}
              </>
            )
          }}
        </TopoFrame>
      )}
    </ZoomPane>
  )

  /** 路線清單；after：選了之後（手機版關掉清單） */
  const routeList = (after?: () => void) => (
    <ul className="topo-route-list">
      {routes.map((r) => {
        const m = marks[r.id]
        const bolts = Object.keys(m?.bolts ?? {}).length
        const total = boltPositions(r).length
        return (
          <li key={r.id}>
            <button className={`topo-route-row${r.id === selected ? ' on' : ''}`} onClick={() => (choose(r.id), after?.())}>
              <span className="topo-route-no">{r.number ?? '·'}</span>
              <span className="topo-route-name">{localName(r.name, lang).main}</span>
              <GradePill grade={r.grade} value={r.gradeValue} size="sm" />
              <span className="topo-route-state muted small">{[m?.line && '●', total > 0 && bolts > 0 && `${bolts}/${total}`].filter(Boolean).join(' ')}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  /** 修改記錄：點一個版本預覽；after：選了之後（手機版關掉面板，看得到照片） */
  const history = (after?: () => void) => (
    <HistorySection title={t('topo.history')}>
      <div className="topo-history">
        {edits.length === 0 ? (
          <p className="muted small">{t('topo.noHistory')}</p>
        ) : (
          <ul>
            {[...edits].reverse().map((e) => (
              <li key={e.id} className={preview?.id === e.id ? 'on' : undefined}>
                <button className="link-button" onClick={() => (setPreview(preview?.id === e.id ? undefined : e), after?.())}>
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
  )

  const restorePreview = () => {
    record(base())
    setDraft({ base: latest?.id, marks: preview!.marks, ...(preview!.crop ? { crop: preview!.crop } : {}) })
    setPreview(undefined)
  }

  if (onClose) {
    const status = error ?? (needRoute ? t('topo.needRoute') : changed && draft?.base !== latest?.id ? t('topo.newerVersion') : undefined)
    const done = () => {
      setMode('select')
      setPicked(undefined)
      setBoltPos(undefined)
      zoomToRoute(selected)
    }
    /** 返回手勢：一次退一層（路線清單、分岔、畫線／放 bolt、選取的點），都沒有才關閉編輯器 */
    const backStep = () => {
      if (sheet) setSheet(undefined)
      else if (isForking) setForking(false)
      else if (mode !== 'select') done()
      else if (pickedLive) setPicked(undefined)
      else return false
      return true
    }
    const float = (label: string, onClick: () => void, opts: { icon?: ReactNode; primary?: boolean; disabled?: boolean; iconOnly?: boolean } = {}) => (
      <button
        type="button"
        className={`topo-float-btn${opts.primary ? ' primary' : ''}`}
        disabled={opts.disabled}
        aria-label={opts.iconOnly ? label : undefined}
        title={label}
        onClick={onClick}
      >
        {opts.icon}
        {!opts.iconOnly && <span>{label}</span>}
      </button>
    )
    // 下面只有一層，只放手機修改要用的：左邊選工具（畫線、Bolt；再按一次結束），右邊復原、刪除選到的點、畫線時從其他路線分岔
    const startLine = () => {
      setMode('line')
      setPicked(undefined)
      // 繼續畫：放大到最後一點附近
      const last = current.line?.at(-1)
      if (last) zoomToPoint(last)
    }
    const startBolt = () => {
      setMode('bolt')
      zoomToRoute(selected)
    }
    const modeButton = (label: string, on: boolean, start: () => void, icon: ReactNode, disabled: boolean) => (
      <button type="button" aria-pressed={on} disabled={disabled} onClick={on ? done : start}>
        {icon}
        <span>{label}</span>
      </button>
    )
    const floating = isForking ? (
      <>
        <span className="topo-float-note">{t('topo.forkPick')}</span>
        {float(t('action.cancel'), () => setForking(false))}
      </>
    ) : (
      <>
        {mode === 'line' && canFork && float(t('topo.fork'), () => setForking(true), { icon: <Icon d="M6 3v18M6 15a9 9 0 0 0 9-9M18 6a3 3 0 1 0-6 0 3 3 0 0 0 6 0" />, iconOnly: true })}
        {float(t('topo.undo'), undoOnce, { icon: undoIcon, iconOnly: true, disabled: undo.current.length === 0 })}
        {pickedLive && (
          <button type="button" className="topo-float-btn danger" aria-label={t('topo.deletePoint')} title={t('topo.deletePoint')} onClick={removePicked}>
            <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </button>
        )}
      </>
    )
    return (
      <PhoneShell onClose={onClose} onBack={backStep} overlay={{ kind: 'topo', owner, photo: photo.id, selected }} label={t('topo.editTitle')}>
        <div className={`topo-phone-photo${gray ? ' gray' : ''}`} style={{ '--fit-aspect': fitAspect } as CSSProperties}>
          <div className="topo-edit-photo" {...aimHandlers}>
            {photoPane}
          </div>
          {/* 照片固定滿版，控制浮在上面（和 Climbio 的定線同一套）：左上關閉、旁邊是目前的路線（點了換路線），右上底色切換、提交 */}
          <div className="topo-phone-top">
            <CloseButton />
            <button type="button" className="topo-phone-title" aria-haspopup="dialog" onClick={() => setSheet('routes')}>
              {route ? (
                <>
                  <b>{route.number ?? '·'}</b>
                  <span>{localName(route.name, lang).main}</span>
                </>
              ) : (
                <span>{t('topo.chooseRoute')}</span>
              )}
              <Icon d="m6 9 6 6 6-6" />
            </button>
            <button type="button" className="topo-round topo-gray-btn" aria-pressed={gray} aria-label={t('topo.grayBase')} title={t('topo.grayBase')} onClick={toggleGray}>
              <Icon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 8h7M12 12h9M12 16h7" />
            </button>
            <button
              type="button"
              className={`topo-round primary topo-phone-submit${busy ? ' busy' : ''}`}
              aria-label={busy ? t('topo.submitting') : saved && !changed ? t('topo.saved') : t('topo.submit')}
              title={t('topo.submit')}
              disabled={!changed || needRoute || busy}
              onClick={() => void submit()}
            >
              <Icon d="m5 12 5 5L20 7" />
            </button>
          </div>
          {status && (
            <div className="topo-phone-notice">
              <p className="topo-phone-status" role="status">
                {status}
              </p>
            </div>
          )}
          {loupe && <Loupe photo={photo} loupe={loupe} line={current.line} kind={selected && info?.get(selected)?.kind} />}
          {mode === 'bolt' && <div className="topo-float-chips">{positionsRow}</div>}
          <div className="topo-modes" role="group" aria-label={t('topo.tools')}>
            {modeButton(t('topo.drawLine'), mode === 'line', startLine, <Icon d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3" />, !route || isForking)}
            {modeButton('Bolt', mode === 'bolt', startBolt, <Icon d="M9 3h6l3 7-6 11-6-11zM12 8.5v.01" />, positions.length === 0 || isForking)}
          </div>
          <div className="topo-float" role="toolbar" aria-label={t('topo.toolbar')}>
            {floating}
          </div>
        </div>
        {sheet === 'routes' && (
          <Sheet label={t('topo.chooseRoute')} onClose={() => setSheet(undefined)}>
            <div className="topo-phone-list">{routeList(() => setSheet(undefined))}</div>
          </Sheet>
        )}
      </PhoneShell>
    )
  }

  return (
    <div className="topo-edit-layout" ref={layoutRef}>
      {!preview && (
        <div className="topo-edit-toolbar" role="toolbar" aria-label={t('topo.toolbar')}>
          {/* 只有一列：最常用的在最前面（復原、重做），接著是工具；目前工具要用的選項接在同一列，最右邊是提交 */}
          <div className="topo-tools-row">
          <div className="topo-tool-group">
            {tool(t('topo.undo'), 'Z', undoOnce, { disabled: undo.current.length === 0, icon: undoIcon })}
            {tool(t('topo.redo'), 'Y', redoOnce, { disabled: redo.current.length === 0, icon: redoIcon })}
          </div>
          <div className="topo-tool-group" role="group" aria-label={t('topo.tools')}>
            {tool(t('topo.modeLine'), 'L', () => setMode('line'), { pressed: mode === 'line', disabled: !route })}
            {tool('Bolt', 'B', () => setMode('bolt'), { pressed: mode === 'bolt', disabled: positions.length === 0 })}
            {tool(t('topo.modeCrop'), 'C', () => setMode('crop'), { pressed: mode === 'crop' })}
            {tool(t('topo.fork'), 'F', () => setForking((on) => !on), { pressed: isForking, disabled: !canFork && !isForking })}
          </div>
          {positionsRow}
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
        {'requestFullscreen' in document.documentElement && (
        <button type="button" className="topo-full-btn" aria-pressed={full} aria-label={t('topo.fullscreen')} title={t('topo.fullscreen')} onClick={toggleFull}>
          <Icon d={full ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
        </button>
        )}
        {photoPane}
      </div>

      {side &&
        createPortal(
          <div className="topo-edit-side">
            {preview ? (
              <div className="topo-edit-bar notice">
                <span>{t('topo.previewing', { time: relativeTime(new Date(preview.createdAt).toISOString(), t), name: displayName(profiles, preview.uid) })}</span>
                <button className="action" onClick={restorePreview}>
                  {t('topo.restore')}
                </button>
                <button className="action" onClick={() => setPreview(undefined)}>
                  {t('topo.backToEditing')}
                </button>
              </div>
            ) : null}
            {changed && draft?.base !== latest?.id && <p className="small warn-text">{t('topo.newerVersion')}</p>}
            {error && <p className="small error">{error}</p>}

            {routeList()}

            {/* 其他快捷鍵都標在上方工具列的按鈕上；這裡只留沒有按鈕的操作 */}
            {!preview && <EditKeys rows={[{ keys: t('topo.keys.rightClick'), label: t('topo.keys.deletePoint') }]} />}

            {history()}
          </div>,
          side,
        )}
    </div>
  )
}
