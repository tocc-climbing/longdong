import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsAdmin } from '../admin'
import { GradePill } from '../components/GradePill'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import type { Route, Sector } from '../data/schema'
import { relativeTime } from '../format'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { NotFound } from '../pages/AreaPage'
import { useCloud } from '../personal/sync'
import { href, navigate } from '../router'
import { displayName, useSocial } from '../social/store'
import { removeEdit, removeTopo, submitEdit } from './actions'
import { fillShared, syncShared } from './shared'
import { boltPositions, imageUrl, sameMarks, type TopoEdit, type TopoPhoto } from './model'
import { isFullCrop, SCALE, sameCrop, type Crop, type Marks, type RouteMarks } from '../core/topo/geometry'
import { savedOverlay, useBackGuard, type EditOverlay } from '../edit/backGuard'
import { HistorySection } from '../edit/HistorySection'
import { EditKeys } from '../edit/KeyList'
import { loadEdits, loadPhotos, useSectorTopos, useTopoState } from './store'
import { routeLabels } from './TopoSection'
import { TopoEditor as KitEditor, type Tool } from '../../vendor/climbio-topokit/index.js'
import { KitTopo } from './KitTopo'
import { topoData } from './topoData'
import { cropFromKit, dropFilled, kitMarks, withMarks } from './kitEdit'
import { routeInfo } from './routeInfo'
import { TOPO_LOOK } from './look'
import { UploadButton } from './TopoUpload'
import '../edit/edit.css'

/**
 * Topo 編輯（電腦、手機）：照片上標記線段（由起攀點往上）與 bolt，另外選路線；照片上的編輯與手勢在 TopoKit。
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

/** 工具列的小圖示（24 格的線條圖） */
function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

/** select（手機版）：點照片不加點，點線選路線；line：畫線，每點一下加一個點；bolt：放 bolt；crop：裁切 */
type Mode = Tool

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

/** 快捷鍵：Z／Y 復原重做、Delete、Esc、L／B／C／F 由 TopoKit 處理，整個視窗都收；Ctrl／⌘ 的組合鍵與 Backspace 留給瀏覽器 */
const KIT_KEYS = { window: true, modifiers: false, backspace: false }

/** 手機版：按住點、把手，放開時沒拖動（DRAG_PX 內）才算點一下 */
const TAP_PX = 5

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
  const profiles = useSocial().profiles
  const info = useMemo(() => routeInfo(routes, (r) => localName(r.name, lang).main), [routes, lang])
  const latest = edits.at(-1)
  const [draft, setDraftState] = useState<Draft | undefined>(() => readDraft(photo.id))
  const [preview, setPreview] = useState<TopoEdit>()
  // 手機版重新載入、App 被系統關掉再回來：回到原來選的路線（記在瀏覽紀錄裡）
  const [selected, setSelected] = useState<string | undefined>(() => (onClose && savedOverlay()?.selected) || initial || routes.find((r) => r.number)?.id)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /** 手機版從下方滑出的路線清單 */
  const [sheet, setSheet] = useState<'routes'>()
  const [gray, toggleGray] = useGrayBase()
  // 全畫面：只放大編輯區（工具列與照片），用瀏覽器的全螢幕
  const layoutRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === layoutRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const toggleFull = () => void (document.fullscreenElement ? document.exitFullscreen() : layoutRef.current?.requestFullscreen())

  /**
   * 照片上的編輯在 TopoKit（線段、bolt、裁切、分岔、復原重做、手勢、放大鏡）；這裡收它的事件存草稿、更新工具列。
   * 草稿與資料庫的格式是萬分比（src/topo/kitEdit.ts 換算）；共用的 bolt、anchor 同步（syncShared）由 transform 套在每次修改上。
   */
  const host = useRef<HTMLDivElement>(null)
  const kit = useRef<KitEditor>(undefined)
  const [, setTick] = useState(0)
  const rerender = () => setTick((n) => n + 1)
  const ed = kit.current
  const mode: Mode = ed?.tool ?? (onClose ? 'select' : 'line')

  const shown = draft ?? latest
  const marks = useMemo(() => fillShared(shown?.marks ?? {}, routes), [shown, routes])
  const crop = shown?.crop
  const changed = !!draft && !(sameMarks(draft.marks, latest?.marks ?? {}) && sameCrop(draft.crop, latest?.crop))
  const route = routes.find((r) => r.id === selected)
  const positions = route ? boltPositions(route) : []
  const current: RouteMarks = (selected && marks[selected]) || {}
  const placing = ed?.nextBoltPos
  const picked = !preview && mode !== 'crop' ? ed?.picked : undefined
  const isForking = !!ed?.forking
  const canFork = !preview && (mode === 'line' || mode === 'select') && !!ed?.canFork
  /** 畫面上照片的寬高比（裁切後只顯示一塊）：照片高度不超過視窗，不用捲動就能編輯 */
  const shownCrop = mode === 'crop' && !preview ? undefined : (preview ?? shown)?.crop
  const fitAspect = (photo.width * (shownCrop?.w ?? SCALE)) / (photo.height * (shownCrop?.h ?? SCALE))

  /** 版本一定要有至少一條路線的標記（資料庫規則），所以只裁切、還沒標記時不能提交 */
  const needRoute = changed && Object.keys(draft!.marks).length === 0

  const setDraft = (d: Draft | undefined) => {
    if (d) setSaved(false)
    writeDraft(photo.id, d)
    setDraftState(d)
  }

  /** 載入到編輯器的標記：沒被動過的補畫共用點（fillShared）不算修改 */
  const loaded = useRef<{ marks: Marks; filled: Marks }>({ marks: {}, filled: {} })
  /** 換資料時編輯器會選路線、加還沒標記的路線：這段時間的 select 事件不是使用者選的 */
  const loading = useRef(false)
  // 事件處理只註冊一次，從這裡讀最新的狀態
  const latestRef = useRef({ draft, latest, selected })
  latestRef.current = { draft, latest, selected }

  const kitData = (c: Content) => {
    const filled = fillShared(c.marks, routes)
    loaded.current = { marks: c.marks, filled }
    return topoData(photo, imageUrl(photo.image), filled, c.crop, labels, info, 1)
  }
  /** 編輯器換成這個內容（復原紀錄清掉）；還沒標記的路線也加進去，選得到、畫得下去 */
  const load = (c: Content) => {
    const e = kit.current!
    loading.current = true
    e.setData(kitData(c))
    for (const r of routes)
      if (!e.routes.some((x) => x.id === r.id)) e.addRoute({ id: r.id, label: r.number, name: localName(r.name, lang).main, kind: r.type === 'sport' ? 'sport' : 'other' })
    e.select(latestRef.current.selected)
    loading.current = false
  }

  /** 編輯器的內容存成草稿（第一次修改時以最新版本為基礎） */
  const saveDraft = () => {
    const e = kit.current!
    const { draft: d, latest: l } = latestRef.current
    const next = dropFilled(kitMarks(e.routes, photo), loaded.current.marks, loaded.current.filled)
    const c = cropFromKit(e.cropRect, photo)
    setDraft({ base: d?.base ?? l?.id, marks: next, ...(c ? { crop: c } : {}) })
  }

  /** 手機版自動縮放到照片上的一塊（照片像素） */
  const zoomTo = (rect: { x: number; y: number; w: number; h: number }, keepZoom = false) => {
    if (onClose) kit.current?.zoomToRect(rect, { keepZoom })
  }
  const shownRect = () => kit.current?.cropRect ?? { x: 0, y: 0, w: photo.width, h: photo.height }
  /** 一條路線的線與 bolt 所在的範圍（留一點邊）；還沒標記時是整張 */
  const zoomToRoute = (id: string | undefined) => {
    const r = kit.current?.routes.find((x) => x.id === id)
    const pts = [...(r?.line ?? []), ...Object.values(r?.bolts ?? {}).map((b) => b.at)]
    const c = shownRect()
    if (pts.length === 0) return zoomTo(c)
    const xs = pts.map(([x]) => x)
    const ys = pts.map(([, y]) => y)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const w = Math.max(x1 - x0, c.w * 0.2) * 1.4
    const h = Math.max(y1 - y0, c.h * 0.2) * 1.3
    zoomTo({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h })
  }
  /** 放大到一個點附近（選點、繼續畫）：大約是整張的三分之一 */
  const zoomToPoint = ([x, y]: [number, number]) => {
    const c = shownRect()
    zoomTo({ x: x - c.w / 6, y: y - c.h / 6, w: c.w / 3, h: c.h / 3 }, true)
  }
  const pickedAt = () => {
    const e = kit.current
    const p = e?.picked
    const r = e?.routes.find((x) => x.id === e.selected)
    return p?.kind === 'line' ? r?.line?.[p.index] : undefined
  }

  // 建立編輯器（只一次）；之後的選項由下面的 setOptions 跟上
  const handlers = useRef({ onSelect: (_: string | undefined) => {}, onPoint: () => {} })
  handlers.current = {
    // 手機版：在照片上點線換路線，接著縮放到那條路線
    onSelect: (id) => {
      setSelected(id)
      zoomToRoute(id)
    },
    // 手機版：選了點（點在點旁邊）放大到點附近，方便調整；按住把手的話等放開、沒拖動才放大
    onPoint: () => {
      if (pressing.current) pendingZoom.current = true
      else {
        const at = pickedAt()
        if (at) zoomToPoint(at)
      }
    },
  }
  const pressing = useRef<{ x: number; y: number }>(undefined)
  const pendingZoom = useRef(false)
  useEffect(() => {
    const e = new KitEditor(host.current!, {
      ...TOPO_LOOK,
      boltCodes: true,   // 龍洞管理 bolt 編號：編輯時標出是哪一顆（× B01）
      tool: onClose ? 'select' : 'line',
      controls: !onClose,
      aim: !!onClose,
      revealWidth: 0.12,
      keys: KIT_KEYS,
      positions: (id) => {
        const r = routes.find((x) => x.id === id)
        return r ? boltPositions(r) : []
      },
      // 共用的 bolt、anchor（例如兩條路線共用頂端的 anchor）：另一條路線自動同步
      transform: (next, before, id) => {
        if (!id) return next
        const [b, n] = [kitMarks(before, photo), kitMarks(next, photo)]
        const synced = syncShared(n, b, id, routes)
        if (synced === n) return next
        return withMarks(next, synced, new Set(Object.keys({ ...synced, ...n }).filter((k) => synced[k] !== n[k])), photo)
      },
      text: { zoomIn: t('topo.zoomIn'), zoomOut: t('topo.zoomOut'), zoomFit: t('topo.zoomFit'), hand: t('topo.zoomPan') },
    })
    kit.current = e
    e.addEventListener('change', saveDraft)
    e.addEventListener('crop', saveDraft)
    for (const name of ['history', 'tool', 'fork', 'change', 'crop'] as const) e.addEventListener(name, rerender)
    e.addEventListener('select', (ev) => !loading.current && handlers.current.onSelect(ev.detail.id))
    e.addEventListener('selectpoint', (ev) => {
      rerender()
      if (onClose && ev.detail.picked) handlers.current.onPoint()
    })
    const el = host.current!
    const down = (ev: PointerEvent) => void (pressing.current = { x: ev.clientX, y: ev.clientY })
    const up = (ev: PointerEvent) => {
      const p = pressing.current
      pressing.current = undefined
      if (!pendingZoom.current) return
      pendingZoom.current = false
      const at = pickedAt()
      if (p && at && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) <= TAP_PX) zoomToPoint(at)
    }
    el.addEventListener('pointerdown', down, true)
    el.addEventListener('pointerup', up)
    const start = latestRef.current.draft ?? latestRef.current.latest
    load({ marks: start?.marks ?? {}, crop: start?.crop })
    // 手機版一打開就縮放到一開始選的路線
    if (onClose && initial) zoomToRoute(initial)
    rerender()
    return () => {
      el.removeEventListener('pointerdown', down, true)
      el.removeEventListener('pointerup', up)
      e.destroy()
      kit.current = undefined
    }
  }, [])
  // 灰階底（手機版）、預覽舊版本時不收快捷鍵
  useEffect(() => kit.current?.setOptions({ reveal: !!onClose && gray }), [gray])
  useEffect(() => kit.current?.setOptions({ keys: preview ? false : KIT_KEYS }), [preview])

  const setMode = (m: Mode) => kit.current?.setTool(m)
  const undoOnce = () => kit.current?.undo()
  const redoOnce = () => kit.current?.redo()
  const setForking = (on: boolean) => kit.current?.fork(on)
  const setBoltPos = (p: string | undefined) => {
    kit.current?.setBoltPos(p)
    rerender()
  }
  const removePicked = () => kit.current?.deletePicked()
  /** 從清單選路線（換路線時取消分岔、bolt 位置、選取的點）；手機版接著縮放到那條路線（select 事件） */
  const choose = (id: string) => kit.current?.select(id)

  /** 上一條、下一條路線（依清單的順序） */
  const stepRoute = (delta: number) => {
    const i = routes.findIndex((r) => r.id === selected)
    const next = routes[Math.min(routes.length - 1, Math.max(0, (i < 0 ? (delta > 0 ? -1 : routes.length) : i) + delta))]
    if (next) choose(next.id)
  }
  // ↑／↓ 換路線（其他快捷鍵在 TopoKit）
  const step = useRef(stepRoute)
  step.current = stepRoute
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      if (latestPreview.current) return
      e.preventDefault()
      step.current(e.key === 'ArrowUp' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const latestPreview = useRef(preview)
  latestPreview.current = preview

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const d = draft!
      await submitEdit(photo.id, d.marks, d.crop)
      setDraft(undefined)
      // 提交的內容就是新的基礎：補畫的共用點照舊不算修改
      loaded.current = { marks: d.marks, filled: fillShared(d.marks, routes) }
      kit.current?.clearHistory()
      setSaved(true)
      // 裁切模式顯示的是整張照片，提交後回到線段模式才看得到裁切的結果
      if (kit.current?.tool === 'crop') setMode(onClose ? 'select' : 'line')
    } catch (err) {
      setError(t('topo.submitError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const discard = () => {
    if (!confirm(t('topo.confirmDiscard'))) return
    setDraft(undefined)
    load({ marks: latest?.marks ?? {}, crop: latest?.crop })
    rerender()
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

  /** 預覽舊版本：TopoKit 的看圖（編輯器留著、藏起來，回到編輯時復原紀錄還在） */
  const previewData = useMemo(() => preview && topoData(photo, imageUrl(photo.image), fillShared(preview.marks, routes), preview.crop, labels, info), [preview, photo, routes, labels, info])
  const photoPane = (
    <>
      <div ref={host} className="topo-kit-editor" hidden={!!preview} />
      {previewData && <KitTopo data={previewData} options={{ highlight: selected, controls: !onClose }} className="topo-kit-editor" />}
    </>
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

  /** 從這個版本繼續修改：換掉編輯器的內容（可以復原），草稿的基礎仍是最新版本 */
  const restorePreview = () => {
    const e = kit.current!
    const p = preview!
    const data = kitData({ marks: p.marks, crop: p.crop })
    e.setLayer(data.layers![0])
    e.setCrop(data.view.props?.crop)
    setPreview(undefined)
  }

  if (onClose) {
    const status = error ?? (needRoute ? t('topo.needRoute') : changed && draft?.base !== latest?.id ? t('topo.newerVersion') : undefined)
    const done = () => {
      setMode('select')
      kit.current?.pickPoint(undefined)
      setBoltPos(undefined)
      zoomToRoute(selected)
    }
    /** 返回手勢：一次退一層（路線清單、分岔、畫線／放 bolt、選取的點），都沒有才關閉編輯器 */
    const backStep = () => {
      if (sheet) setSheet(undefined)
      else if (isForking) setForking(false)
      else if (mode !== 'select') done()
      else if (picked) kit.current?.pickPoint(undefined)
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
      kit.current?.pickPoint(undefined)
      // 繼續畫：放大到最後一點附近
      const last = kit.current?.routes.find((r) => r.id === selected)?.line?.at(-1)
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
        {float(t('topo.undo'), undoOnce, { icon: undoIcon, iconOnly: true, disabled: !ed?.canUndo })}
        {picked && (
          <button type="button" className="topo-float-btn danger" aria-label={t('topo.deletePoint')} title={t('topo.deletePoint')} onClick={removePicked}>
            <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </button>
        )}
      </>
    )
    return (
      <PhoneShell onClose={onClose} onBack={backStep} overlay={{ kind: 'topo', owner, photo: photo.id, selected }} label={t('topo.editTitle')}>
        <div className={`topo-phone-photo${gray ? ' gray' : ''}`} style={{ '--fit-aspect': fitAspect } as CSSProperties}>
          <div className="topo-edit-photo">{photoPane}</div>
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
            {tool(t('topo.undo'), 'Z', undoOnce, { disabled: !ed?.canUndo, icon: undoIcon })}
            {tool(t('topo.redo'), 'Y', redoOnce, { disabled: !ed?.canRedo, icon: redoIcon })}
          </div>
          <div className="topo-tool-group" role="group" aria-label={t('topo.tools')}>
            {tool(t('topo.modeLine'), 'L', () => setMode('line'), { pressed: mode === 'line', disabled: !route })}
            {tool('Bolt', 'B', () => setMode('bolt'), { pressed: mode === 'bolt', disabled: positions.length === 0 })}
            {tool(t('topo.modeCrop'), 'C', () => setMode('crop'), { pressed: mode === 'crop' })}
            {tool(t('topo.fork'), 'F', () => setForking(!isForking), { pressed: isForking, disabled: !canFork && !isForking })}
          </div>
          {positionsRow}
          {isForking && <span className="edit-status">{t('topo.forkPick')}</span>}
          {mode === 'crop' && (
            <div className="topo-tool-group">
              {tool(t('topo.cropDone'), 'Enter', () => setMode('line'))}
              {tool(t('topo.cropReset'), undefined, () => kit.current?.setCrop(undefined), { disabled: isFullCrop(crop) })}
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
          {tool(t('topo.deletePoint'), 'Delete', removePicked, { disabled: !picked })}
          {tool(t('topo.clearRoute'), undefined, () => kit.current?.clearRoute(), { disabled: !route || !marks[route.id] })}
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
