import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useIsAdmin } from '../admin'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import { LOCALES, localName, useLang, type MessageKey } from '../i18n'
import { useWide } from '../layout'
import { useScaleMap, withShapes } from '../map/mapData'
import type { MapView } from '../map/mapView'
import { ScaleMap } from '../map/ScaleMap'
import { isLineTarget, loadMapShapes, sectorOf, useMapShapes, useSectorWalls, wallLabelAt, type EditTarget, type MapEditVersion } from '../map/shapes'
import { useReportPins } from './useReportPins'
import { useCloud, withCloud } from '../personal/sync'
import { TOPO_ADD_PREFIX, href, navigate, type EditKind } from '../router'
import { displayName, useSocial } from '../social/store'
import { loadPhotos, useTopoState } from '../topo/store'
import { TopoEditor } from '../topo/TopoEditor'
import type { PinGroup } from '../map/reportPins'
import { UploadButton } from '../topo/TopoUpload'
import { Catalog, useCatalog, type EditItem } from './Catalog'
import { HistorySection } from './HistorySection'
import { EditKeys } from './KeyList'
import { LatestEdits } from './LatestEdits'
import { ProgressStats } from './ProgressStats'
import { DockHead, DockRail, PanelLayoutContext, type DockPart } from './PanelLayout'
import { groupVersions } from './versions'
import { currentText, loadTextEdits, textTarget, useTextEdits, type TextTarget, type TextVersion } from './textEdits'
import { applyDrafts, changedTargets, discardDrafts, canSubmitDraft, submitDrafts, useDrafts } from './mapDrafts'
import { useMapItem } from './useMapItem'
import './edit.css'

const TOAST_MS = 3500
/** 收起目錄、資訊面板（這台裝置記住） */
const LAYOUT_KEY = 'longdong.edit.layout'

function readLayout(): { catalog: boolean; panel: boolean } {
  try {
    return { catalog: true, panel: true, ...(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as object) }
  } catch {
    return { catalog: true, panel: true }
  }
}

/**
 * 編輯模式（/edit/<種類>/<項目>）：地圖（步道、大區域、分區的岩壁）、Topo、區域與路線說明，所有登入者都能修改，每次提交是一個新版本。
 * 電腦版三欄：左側目錄、中間編輯、右側資訊（說明、修改紀錄、快捷鍵）；上方工具列。
 * 目錄與資訊面板可以收起，讓中間的編輯區最大（[、]）。
 * 手機版只能看目錄與修改說明；地圖與 Topo 提示用電腦開啟。每個項目有自己的網址，可以分享給岩友一起修改。
 */
export function EditPage({ data, kind, id }: { data: LoadedData; kind?: EditKind; id?: string }) {
  const { t } = useLang()
  const wide = useWide()
  const { items } = useCatalog(data)
  const itemId = id
  const { lang } = useLang()
  const addSector = kind === 'topo' && itemId?.startsWith(TOPO_ADD_PREFIX) ? data.sectorById.get(itemId.slice(TOPO_ADD_PREFIX.length)) : undefined
  const addName = (n: { zh: string; en?: string }) => localName(n, lang).main
  const item: EditItem | undefined = addSector
    ? { kind: 'topo', id: itemId!, label: addName(addSector.sector.name), path: ['Topo', addName(addSector.area.name), addName(addSector.sector.name)], edited: false }
    : kind && itemId
      ? items.find((i) => i.kind === kind && i.id === itemId)
      : undefined
  // 文字、Topo 的修改只在這一頁；地圖的草稿在 mapDrafts（換項目也保留），只在關閉網頁時提醒
  const [dirty, setDirty] = useState(false)
  const { drafts, submitting } = useDrafts()
  const hasDrafts = changedTargets(drafts).length > 0
  const [toast, setToast] = useState<string>()
  const [layout, setLayout] = useState(readLayout)
  const toggle = (part: DockPart) =>
    setLayout((l) => {
      const next = { ...l, [part]: !l[part] }
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next))
      } catch {
        /* 存不了就只在這次有效 */
      }
      return next
    })
  // 收起、展開兩側：[ 目錄、] 資訊面板
  useEffect(() => {
    if (!wide) return
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        toggle(e.key === '[' ? 'catalog' : 'panel')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wide])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])
  // 有未提交的修改時，離開網頁先確認
  useEffect(() => {
    if (!dirty && !hasDrafts) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, hasDrafts])

  const leaveOk = () => !submitting && (!dirty || confirm(t('shape.confirmDiscard')))
  const open = () => {
    if (!leaveOk()) return false
    setDirty(false)
    return true
  }
  const share = async () => {
    const title = item ? t('edit.shareTitle', { item: item.label }) : t('edit.shareSite')
    try {
      if (navigator.share) await navigator.share({ title, text: title, url: location.href })
      else {
        await navigator.clipboard.writeText(location.href)
        setToast(t('edit.linkCopied'))
      }
    } catch {
      /* 使用者取消分享 */
    }
  }

  const props = { data, onToast: setToast, onDirty: setDirty }
  const body: ReactNode = !item ? (
    <Welcome data={data} items={items} />
  ) : item.kind === 'text' ? (
    <TextItemView key={item.id} item={item} {...props} />
  ) : !wide ? (
    <section className="edit-center edit-message">
      <p>{t('edit.desktopOnly')}</p>
    </section>
  ) : item.kind === 'map' ? (
    <MapEditor key={item.id} item={item} {...props} target={item.id as EditTarget} />
  ) : addSector ? (
    <TopoAddView key={item.id} item={item} sectorId={addSector.sector.id} />
  ) : (
    <TopoItemView key={item.id} item={item} data={data} />
  )

  return (
    <PanelLayoutContext.Provider value={{ open: layout, toggle }}>
      <div
        className={`edit-app${wide ? '' : ' narrow'}${item ? ' has-item' : ''}${wide && !layout.catalog ? ' no-catalog' : ''}${wide && !item ? ' no-panel' : ''}${wide && item && !layout.panel ? ' panel-rail' : ''}`}
      >
        <header className="edit-top">
          <a className="edit-back" href={href.home()} onClick={(e) => !leaveOk() && e.preventDefault()}>
            ← {t('app.title')}
          </a>
          <strong className="edit-title">{t('edit.title')}</strong>
          {item && (
            <span className="edit-crumb">
              {item.path.join(' › ')} › <b>{item.label}</b>
            </span>
          )}
          <span className="edit-spacer" />
          <button type="button" className="edit-btn" onClick={() => void share()}>
            {t('edit.share')}
          </button>
        </header>
        {wide ? (
          layout.catalog ? (
            <div className="edit-dock">
              <DockHead part="catalog" title={t('edit.catalog')} />
              <Catalog data={data} current={item} onOpen={open} />
            </div>
          ) : (
            <DockRail part="catalog" title={t('edit.catalog')} />
          )
        ) : (
          !item && <Catalog data={data} current={item} onOpen={open} />
        )}
        {!wide && item && (
          <button type="button" className="edit-btn edit-back-to-list" onClick={() => leaveOk() && navigate(href.edit())}>
            ← {t('edit.catalog')}
          </button>
        )}
        {body}
        {wide && item && !layout.panel && <DockRail part="panel" title={t('edit.panel')} />}
        {toast && (
          <p className="edit-toast" role="status">
            {toast}
          </p>
        )}
      </div>
    </PanelLayoutContext.Provider>
  )
}

/** 還沒選項目：標題與重點（與分享小卡相同）、最新的更新、怎麼修改 */
function Welcome({ data, items }: { data: LoadedData; items: EditItem[] }) {
  const { t } = useLang()
  // 標題裡 *…* 的部分用品牌色（分享小卡的「修改」）
  const title = t('edit.welcome')
    .split(/\*(.+?)\*/)
    .map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part))
  return (
    <>
      <section className="edit-center edit-message edit-welcome">
        <h1>{title}</h1>
        <p className="edit-tags">{t('edit.welcomeTags')}</p>
        <ProgressStats data={data} items={items} />
        <LatestEdits items={items} />
      </section>
    </>
  )
}

/** 修改紀錄：新到舊；最新的是目前顯示的；本人與管理員可以刪除 */
function VersionList({ versions, empty, onDelete }: { versions: (MapEditVersion | TextVersion)[]; empty: string; onDelete: (id: string) => void }) {
  const { lang, t } = useLang()
  const cloud = useCloud()
  const admin = useIsAdmin() === true
  const { profiles } = useSocial()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const time = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const groups = groupVersions(versions)
  return (
    <HistorySection title={t('shape.history', { n: groups.length })}>
      {versions.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ol className="edit-versions">
          {groups.map(({ latest: v, members }, i) => (
            <li key={v.id}>
              <span className="edit-version-who">
                <b>{displayName(profiles, v.uid)}</b>
                {i === 0 && <span className="edit-badge">{t('shape.current')}</span>}
              </span>
              <span className="edit-version-time muted">
                {time(v.createdAt)}
                {members.length > 1 && ` · ${t('shape.mergedCount', { n: members.length })}`}
              </span>
              {(v.uid === uid || admin) && (
                <button type="button" className="link-button danger edit-version-delete" onClick={() => confirm(t('shape.confirmDeleteVersion')) && onDelete(v.id)}>
                  {t('shape.deleteVersion')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </HistorySection>
  )
}

/** 沒登入時：面板上的登入提示 */
function NeedSignIn() {
  const { t } = useLang()
  const cloud = useCloud()
  if (cloud.status === 'signed-in' || cloud.status === 'loading') return null
  return <SignInPrompt message={t('edit.signIn')} />
}

/**
 * 這個區域的回報（修改地圖時當參考）：同一個點附近的合併成一個，標出有幾筆、相同的說明各幾筆；編號對應地圖上的圓點；
 * 只有位置與說明，不顯示是誰、什麼時候回報的。
 */
function ReportPins({ pins, data, on, onPick }: { pins: PinGroup[]; data: LoadedData; on?: string; onPick: (id?: string) => void }) {
  const { lang, t } = useLang()
  if (pins.length === 0) return null
  const where = (p: PinGroup) =>
    p.targets
      .map((target) => {
        const route = target.routeId ? data.routeById.get(target.routeId)?.route : undefined
        const sector = data.sectorById.get(target.sectorId)?.sector
        return [t(`place.kind.${target.kind}` as MessageKey), route ? localName(route.name, lang).main : sector ? localName(sector.name, lang).main : undefined]
          .filter(Boolean)
          .join(' · ')
      })
      .join('、')
  return (
    <>
      <h2>{t('edit.pins', { n: pins.reduce((sum, p) => sum + p.count, 0) })}</h2>
      <ol className="edit-pins">
        {pins.map((p) => (
          <li key={p.id} className={p.id === on ? 'on' : undefined}>
            <button type="button" onClick={() => onPick(p.id === on ? undefined : p.id)} aria-pressed={p.id === on}>
              <b>{Number(p.id) + 1}</b>
              <span>
                {where(p) && <span className="edit-pin-where">{where(p)}</span>}
                {p.notes.map((n) => (
                  <span key={n.text}>
                    {n.text}
                    {n.count > 1 && <span className="edit-pin-count"> ×{n.count}</span>}
                  </span>
                ))}
                {p.blank > 0 && (
                  <span className="muted">
                    {t('edit.pinNoNote')}
                    {p.blank > 1 && <span className="edit-pin-count"> ×{p.blank}</span>}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}

type ItemProps = { item: EditItem; data: LoadedData; onToast: (text: string) => void; onDirty: (dirty: boolean) => void }

/** 是不是在輸入框裡打字（快捷鍵不處理） */
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** 地圖的編輯畫面：工具列（選取、新增、刪除、復原、重做、航照、提交）、地圖、右側面板（說明、修改紀錄、快捷鍵） */
/** 畫岩壁時的地圖畫面：換到別的分區也停在原處 */
const wallView: { current?: MapView } = {}

function MapEditor({ item, data, onToast, target }: ItemProps & { target: EditTarget }) {
  const { lang, t } = useLang()
  const cloud = useCloud()
  const map = useScaleMap()
  const shapes = useMapShapes()
  const m = useMapItem({ target, map: map.status === 'ok' ? map.data : undefined })
  const { drafts, submitting, errors } = useDrafts()
  const changed = changedTargets(drafts)
  // 地圖上顯示的是套上所有草稿的：沒提交的修改（包括別的區域的）看得到，刪光的形狀不會留下舊的
  const overlay = useMemo(() => applyDrafts(shapes, drafts), [shapes, drafts])
  const shown = useMemo(() => (map.status === 'ok' ? withShapes(map.data, overlay) : undefined), [map, overlay])
  const [ortho, setOrtho] = useState(true)
  const [topo, setTopo] = useState(true)
  const signedIn = cloud.status === 'signed-in'
  const canSubmit = signedIn && !submitting && changed.length > 0 && changed.every((x) => canSubmitDraft(x, drafts[x]))
  const submit = async () => {
    const r = await submitDrafts()
    if (r.failed) onToast(t('shape.submitPartial', { ok: r.submitted, failed: r.failed }))
    else if (r.unsynced) onToast(t('shape.submitUnsynced', { n: r.submitted }))
    else onToast(t('shape.submittedAll', { n: r.submitted }))
  }
  const isWall = target.startsWith('wall:')
  const sector = isWall ? sectorOf(target) : undefined
  // 畫岩壁時，其他分區已有的岩壁也畫出來（名稱標在岩壁中間，點不到）
  const { walls } = useSectorWalls()
  const others = isWall ? walls.filter((w) => w.sector !== sector) : []
  const otherWalls = others.map((w) => ({ key: w.key, points: w.points }))
  const otherLabels = [...new Set(others.map((w) => w.sector))].flatMap((id) => {
    const at = wallLabelAt(others.filter((w) => w.sector === id).map((w) => w.points))
    const found = data.sectorById.get(id)
    return at && found ? [{ id, text: localName(found.sector.name, lang).main, at }] : []
  })
  // 範圍、岩壁（不含步道）：這個區域的回報位置與說明畫在地圖上當參考（不顯示是誰、什麼時候）
  const pins = useReportPins(m.closed || isWall ? { target, data, map: map.status === 'ok' ? map.data : undefined } : undefined)
  const [pinOn, setPinOn] = useState<string>()

  // 快捷鍵都是單一按鍵（Windows、Mac 一樣）：V 選取、N 新增、Enter 完成、Esc 取消、Delete 刪除選中的、Z 復原、Y 重做、S 提交、A 航照、T 地形圖
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || m.locked) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      const run = (f: () => void) => {
        e.preventDefault()
        f()
      }
      // 畫新的形狀時，Z、Backspace 退回上一個點；畫完才是復原、重做
      if (m.drawing && (key === 'z' || key === 'backspace')) return run(m.actions.undoPoint)
      if (key === 'z') return run(m.actions.undo)
      if (key === 'y') return run(m.actions.redo)
      if (key === 's') return canSubmit ? run(() => void submit()) : undefined
      if (key === 'v') return run(m.actions.cancel)
      if (key === 'n' && !m.drawing) return run(m.actions.draw)
      if (key === 'enter' && m.drawing) return run(m.actions.finishDrawing)
      if (key === 'escape') return run(m.actions.cancel)
      if ((key === 'delete' || key === 'backspace') && !m.drawing) return run(m.actions.removeSelected)
      if (key === 'a') return run(() => setOrtho((o) => !o))
      if (key === 't') return run(() => setTopo((o) => !o))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 打開時放大到這個項目；分區還沒有岩壁時放大到所在的大區域；步道看整個地圖
  const focusArea = sector ? data.sectorById.get(sector)?.area.id.split('/').pop() : undefined
  const focus =
    m.ready && !isLineTarget(target)
      ? m.rings.length
        ? { key: target, coords: m.rings.flat() }
        : focusArea && { key: target, area: focusArea }
      : undefined

  const deleteVersion = async (version: string) => {
    if (submitting) return
    try {
      const { m: fb } = await withCloud()
      await fb.deleteMapEdit(target, version)
      await loadMapShapes(true)
      onToast(t('shape.versionDeleted'))
    } catch (err) {
      onToast(t('shape.saveFailed', { error: (err as Error).message }))
    }
  }

  const tool = (on: boolean, label: string, key: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      className={`edit-tool${on ? ' on' : ''}`}
      aria-pressed={on}
      aria-keyshortcuts={key}
      title={`${label}（${key}）`}
      disabled={disabled || m.locked}
      onClick={onClick}
    >
      {label}
    </button>
  )
  const addLabel = t(m.closed ? 'shape.add' : isWall ? 'shape.addWall' : 'shape.addLine')
  const finishLabel = t(m.closed ? 'shape.finish' : isWall ? 'shape.finishWall' : 'shape.finishLine')

  return (
    <>
      <section className="edit-center">
        <div className="edit-toolbar">
          <div className="edit-segment">
            {tool(!m.drawing, t('edit.select'), 'V', m.actions.cancel)}
            {tool(!!m.drawing, addLabel, 'N', m.actions.draw)}
          </div>
          {m.drawing ? (
            <>
              <span className="edit-status">{t('shape.points', { n: m.drawing.length })}</span>
              {tool(false, t('wall.undo'), 'Z', m.actions.undoPoint, m.drawing.length === 0)}
              {tool(false, finishLabel, 'Enter', m.actions.finishDrawing, !m.canFinish)}
            </>
          ) : (
            <>
              {tool(false, t('shape.removeRing'), 'Del', m.actions.removeSelected, m.selected === undefined)}
              <span className="edit-divider" />
              {tool(false, t('edit.undo'), 'Z', m.actions.undo, !m.canUndo)}
              {tool(false, t('edit.redo'), 'Y', m.actions.redo, !m.canRedo)}
            </>
          )}
          <span className="edit-spacer" />
          {tool(ortho, t('map.ortho'), 'A', () => setOrtho(!ortho))}
          {tool(topo, t('map.topo'), 'T', () => setTopo(!topo))}
          {submitting && <span className="edit-status">{t('shape.submitting')}</span>}
          <button type="button" className="edit-btn primary" disabled={!canSubmit} onClick={() => void submit()} title="S">
            {changed.length ? t('shape.saveAll', { n: changed.length }) : t('shape.save')}
          </button>
        </div>
        <div className="edit-canvas">
          {map.status === 'ok' ? (
            <ScaleMap
              map={shown!}
              areaNames={{}}
              marks={pins.map((p) => ({ at: p.at, picked: p.picked, label: String(Number(p.id) + 1), selected: p.id === pinOn }))}
              ortho={ortho}
              topo={topo}
              hideAreas={isLineTarget(target)}
              edit={m.edit}
              pick={m.pick}
              lines={[...otherWalls, ...(m.draftLine ? [m.draftLine] : [])]}
              focus={focus || undefined}
              keepView={isWall ? wallView : undefined}
              sectorLabels={otherLabels}
            />
          ) : (
            <p className="muted edit-message">{map.status === 'error' ? map.message : t('app.loading')}</p>
          )}
        </div>
      </section>
      <aside className="edit-panel">
        <DockHead part="panel" title={t('edit.panel')} />
        <h2>{item.label}</h2>
        <NeedSignIn />
        <PendingList changed={changed} errors={errors} data={data} current={target} locked={submitting} />
        <ReportPins pins={pins} data={data} on={pinOn} onPick={setPinOn} />
        <VersionList versions={m.versions} empty={t('shape.noVersions')} onDelete={(v) => void deleteVersion(v)} />
        {/* 其他快捷鍵都標在上方工具列的按鈕上；這裡只留沒有按鈕的操作 */}
        <EditKeys rows={[{ keys: 'S', label: t('shape.save') }, { keys: t('edit.rightClick'), label: t('edit.deletePoint') }]} />
      </aside>
    </>
  )
}

/** 還沒提交的修改（跨項目）：每個項目一列，點了切過去；失敗的列出原因；可以全部放棄 */
function PendingList({
  changed,
  errors,
  data,
  current,
  locked,
}: {
  changed: EditTarget[]
  errors: Readonly<Record<string, string>>
  data: LoadedData
  current: EditTarget
  locked: boolean
}) {
  const { t } = useLang()
  const { items } = useCatalog(data)
  if (!changed.length) return null
  const label = (target: EditTarget) => items.find((i) => i.kind === 'map' && i.id === target)?.label ?? target
  return (
    <>
      <h2>{t('shape.pending', { n: changed.length })}</h2>
      <ul className="edit-pending">
        {changed.map((target) => (
          <li key={target}>
            {target === current ? (
              <b>{label(target)}</b>
            ) : (
              <a href={href.edit('map', target)} onClick={(e) => locked && e.preventDefault()}>
                {label(target)}
              </a>
            )}
            {errors[target] && <span className="edit-error"> {t('shape.saveFailed', { error: errors[target] })}</span>}
          </li>
        ))}
      </ul>
      <button type="button" className="edit-btn" disabled={locked} onClick={() => confirm(t('shape.confirmDiscardAll')) && discardDrafts()}>
        {t('shape.discardAll')}
      </button>
    </>
  )
}

const TEXT_MAX = 3000

/** 說明項目：文字框（目前顯示的說明）、TOCC 原文、提交；右側面板是修改紀錄 */
function TextItemView({ item, data, onToast, onDirty }: ItemProps) {
  const { t } = useLang()
  const cloud = useCloud()
  const versions = useTextEdits()
  const target = item.id as TextTarget
  const route = target.startsWith('route:') ? data.routes.find((r) => textTarget.route(r.route.id) === target)?.route : undefined
  const original = route?.description ?? ''
  const shown = currentText(versions[target])?.text ?? original
  const [text, setText] = useState(shown)
  const [saving, setSaving] = useState(false)
  const dirty = text !== shown
  useEffect(() => onDirty(dirty), [dirty])
  const signedIn = cloud.status === 'signed-in'
  const canSubmit = dirty && !saving && signedIn

  const submit = async () => {
    setSaving(true)
    try {
      const { m, uid } = await withCloud()
      // 和原文相同時存空字串（表示改回原文）
      await m.addTextEdit(uid, target, text.trim() === original.trim() ? '' : text.trim())
      await loadTextEdits(true)
      onToast(t('shape.saved'))
    } catch (err) {
      onToast(t('shape.saveFailed', { error: (err as Error).message }))
    } finally {
      setSaving(false)
    }
  }
  const deleteVersion = async (version: string) => {
    try {
      const { m } = await withCloud()
      await m.deleteTextEdit(target, version)
      await loadTextEdits(true)
      onToast(t('shape.versionDeleted'))
    } catch (err) {
      onToast(t('shape.saveFailed', { error: (err as Error).message }))
    }
  }
  // 版本變了（提交、刪除）而且沒有修改中時，文字框跟著換
  useEffect(() => {
    if (!dirty) setText(shown)
  }, [shown])

  return (
    <>
      <section className="edit-center edit-text">
        <div className="edit-toolbar">
          <span className="edit-status">{dirty ? t('edit.unsaved') : `${text.length} / ${TEXT_MAX}`}</span>
          <span className="edit-spacer" />
          <button type="button" className="edit-btn primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('shape.save')}
          </button>
        </div>
        <div className="edit-text-body">
          <textarea
            className="edit-textarea"
            value={text}
            maxLength={TEXT_MAX}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 打字時沒有單一按鍵可用：Ctrl／⌘ + Enter 提交
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                if (canSubmit) void submit()
              }
            }}
            aria-label={item.label}
            placeholder={t('edit.textPlaceholder')}
          />
          {route && original && (
            <aside className="edit-original">
              <div className="edit-original-head">
                <span>{t('text.original')}</span>
                <button type="button" className="edit-btn" disabled={text === original} onClick={() => setText(original)}>
                  {t('text.useOriginal')}
                </button>
              </div>
              <p className="pre">{original}</p>
            </aside>
          )}
        </div>
      </section>
      <aside className="edit-panel">
        <DockHead part="panel" title={t('edit.panel')} />
        <h2>{item.label}</h2>
        {route && (
          <p className="small">
            <a href={href.route(route.id)}>{t('edit.viewRoute')}</a>
          </p>
        )}
        <NeedSignIn />
        <VersionList versions={versions[target] ?? []} empty={t('text.noVersions')} onDelete={(v) => void deleteVersion(v)} />
        <EditKeys rows={[{ keys: 'Ctrl / ⌘ Enter', label: t('shape.save') }]} />
      </aside>
    </>
  )
}

/** 分區還沒有 Topo 照片：新增頁。照片載入後發現已經有，就轉到第一張 */
function TopoAddView({ item, sectorId }: { item: EditItem; sectorId: string }) {
  const { t } = useLang()
  const signedIn = useCloud().status === 'signed-in'
  const { photos } = useTopoState()
  useEffect(() => {
    void loadPhotos()
  }, [])
  const first = Object.values(photos ?? {})
    .filter((p) => p.sector === sectorId)
    .sort((a, b) => a.createdAt - b.createdAt)[0]
  useEffect(() => {
    if (first) navigate(href.topo(first.id), { replace: true })
  }, [first?.id])
  return (
    <>
      <section className="edit-center edit-message">
        {photos && !first && (
          <>
            <h2>{item.label}</h2>
            <p className="muted">{t('edit.topoEmpty')}</p>
            {signedIn ? <UploadButton sector={sectorId} /> : <NeedSignIn />}
          </>
        )}
      </section>
      <aside className="edit-panel">
        <DockHead part="panel" title={t('edit.panel')} />
      </aside>
    </>
  )
}

/** Topo 項目：中間是 Topo 編輯器（照片、路線、線段與 bolt 工具都在裡面）；右側面板是使用說明 */
function TopoItemView({ item, data }: { item: EditItem; data: LoadedData }) {
  const { t } = useLang()
  // Topo 編輯器的路線清單、提交與修改記錄放在右側面板，讓照片佔滿中間
  const [side, setSide] = useState<HTMLElement | null>(null)
  return (
    <>
      <section className="edit-center edit-topo">
        <TopoEditor data={data} id={item.id} embedded side={side} />
      </section>
      <aside className="edit-panel">
        <DockHead part="panel" title={t('edit.panel')} />
        <div ref={setSide} />
      </aside>
    </>
  )
}
