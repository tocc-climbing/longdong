import { useEffect, useState, type ReactNode } from 'react'
import { useIsAdmin } from '../admin'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import { LOCALES, localName, useLang, type MessageKey } from '../i18n'
import { useWide } from '../layout'
import { useScaleMap } from '../map/mapData'
import { ScaleMap } from '../map/ScaleMap'
import { isLineTarget, loadMapShapes, sectorOf, useMapShapes, wallTarget, type EditTarget, type MapEditVersion } from '../map/shapes'
import { useWalls } from '../map/walls'
import { useReportPins } from './useReportPins'
import { useCloud, withCloud } from '../personal/sync'
import { href, navigate, type EditKind } from '../router'
import { displayName, useSocial } from '../social/store'
import { useTopoState } from '../topo/store'
import { TopoEditor } from '../topo/TopoEditor'
import { MERGE_RADIUS_M, type PinGroup } from '../map/reportPins'
import { UploadButton } from '../topo/TopoUpload'
import { Catalog, useCatalog, type EditItem } from './Catalog'
import { LatestEdits } from './LatestEdits'
import { currentText, loadTextEdits, textTarget, useTextEdits, type TextTarget, type TextVersion } from './textEdits'
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
 * 修改模式（/edit/<種類>/<項目>）：地圖（步道、大區域、分區範圍與岩壁）、Topo、區域與路線說明，所有登入者都能修改，每次提交是一個新版本。
 * 電腦版三欄：左側目錄、中間編輯、右側資訊（說明、修改紀錄、快捷鍵）；上方工具列。
 * 目錄與資訊面板可以收起，讓中間的編輯區最大（[、]、⌘\ 兩側一起）。
 * 手機版只能看目錄與修改說明；地圖與 Topo 提示用電腦開啟。每個項目有自己的網址，可以分享給岩友一起修改。
 */
export function EditPage({ data, kind, id }: { data: LoadedData; kind?: EditKind; id?: string }) {
  const { t } = useLang()
  const wide = useWide()
  const { items } = useCatalog(data)
  // 分區的岩壁（/edit/map/wall:…）是分區項目的一部分：打開分區、切到岩壁
  const wallPart = kind === 'map' && !!id?.startsWith('wall:')
  const itemId = wallPart ? `sector:${id!.slice('wall:'.length)}` : id
  const item = kind && itemId ? items.find((i) => i.kind === kind && i.id === itemId) : undefined
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState<string>()
  const [layout, setLayout] = useState(readLayout)
  const toggle = (part: 'catalog' | 'panel' | 'both') =>
    setLayout((l) => {
      const next = part === 'both' ? { catalog: !(l.catalog || l.panel), panel: !(l.catalog || l.panel) } : { ...l, [part]: !l[part] }
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next))
      } catch {
        /* 存不了就只在這次有效 */
      }
      return next
    })
  // 收起、展開兩側：[ 目錄、] 資訊面板、⌘\ 兩側一起（同 Figma 隱藏介面）
  useEffect(() => {
    if (!wide) return
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        toggle('both')
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '[' || e.key === ']')) {
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
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const leaveOk = () => !dirty || confirm(t('shape.confirmDiscard'))
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
  const body: ReactNode =
    !item ? (
      <Welcome items={items} />
    ) : item.kind === 'text' ? (
      <TextItemView key={item.id} item={item} {...props} />
    ) : !wide ? (
      <section className="edit-center edit-message">
        <p>{t('edit.desktopOnly')}</p>
      </section>
    ) : item.kind === 'map' ? (
      <MapItemView key={item.id} item={item} {...props} initialPart={wallPart ? 'walls' : 'range'} />
    ) : (
      <TopoItemView key={item.id} item={item} data={data} />
    )

  return (
    <div className={`edit-app${wide ? '' : ' narrow'}${item ? ' has-item' : ''}${wide && !layout.catalog ? ' no-catalog' : ''}${wide && !layout.panel ? ' no-panel' : ''}`}>
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
        {wide && (
          <>
            <button type="button" className="edit-tool" aria-pressed={layout.catalog} onClick={() => toggle('catalog')} title={t('edit.toggleCatalog')}>
              {t('edit.catalog')}
              <kbd>[</kbd>
            </button>
            <button type="button" className="edit-tool" aria-pressed={layout.panel} onClick={() => toggle('panel')} title={t('edit.togglePanel')}>
              {t('edit.panel')}
              <kbd>]</kbd>
            </button>
          </>
        )}
        <button type="button" className="edit-btn" onClick={() => void share()}>
          {t('edit.share')}
        </button>
      </header>
      {wide ? layout.catalog && <Catalog data={data} current={item} onOpen={open} /> : !item && <Catalog data={data} current={item} onOpen={open} />}
      {!wide && item && (
        <button type="button" className="edit-btn edit-back-to-list" onClick={() => leaveOk() && navigate(href.edit())}>
          ← {t('edit.catalog')}
        </button>
      )}
      {body}
      {toast && (
        <p className="edit-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  )
}

/** 這一年（含）以前上傳的 Topo 照片太舊，編輯前提示改上傳新照片 */
const OLD_TOPO_YEAR = 2016

/** 還沒選項目：標題與重點（與分享小卡相同）、最新的更新、怎麼修改 */
function Welcome({ items }: { items: EditItem[] }) {
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
        <p className="muted">{t('edit.welcomeHint')}</p>
        <p className="muted small">{t('edit.progress', { n: items.filter((i) => i.edited).length, total: items.length })}</p>
        <LatestEdits items={items} />
      </section>
      <aside className="edit-panel">
        <h2>{t('edit.howTitle')}</h2>
        <ul className="edit-how">
          <li>{t('edit.how1')}</li>
          <li>{t('edit.how2')}</li>
          <li>{t('edit.how3')}</li>
        </ul>
      </aside>
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
  return (
    <>
      <h2>{t('shape.history', { n: versions.length })}</h2>
      {versions.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ol className="edit-versions">
          {[...versions].reverse().map((v, i) => (
            <li key={v.id}>
              <span className="edit-version-who">
                <b>{displayName(profiles, v.uid)}</b>
                {i === 0 && <span className="edit-badge">{t('shape.current')}</span>}
              </span>
              <span className="edit-version-time muted">{time(v.createdAt)}</span>
              {(v.uid === uid || admin) && (
                <button type="button" className="link-button danger edit-version-delete" onClick={() => confirm(t('shape.confirmDeleteVersion')) && onDelete(v.id)}>
                  {t('shape.deleteVersion')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
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
        return [t(`place.kind.${target.kind}` as MessageKey), route ? localName(route.name, lang).main : sector ? localName(sector.name, lang).main : undefined].filter(Boolean).join(' · ')
      })
      .join('、')
  return (
    <>
      <h2>{t('edit.pins', { n: pins.reduce((sum, p) => sum + p.count, 0), places: pins.length })}</h2>
      <p className="muted small">{t('edit.pinsTip', { m: MERGE_RADIUS_M })}</p>
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
                <span className="muted small">
                  {t('edit.pinCount', { n: p.count })} · {p.manual ? t('edit.pinManual') : p.accuracy !== undefined ? t('edit.pinGps', { m: p.accuracy }) : ''}
                </span>
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

/**
 * 地圖項目。分區有兩部分：範圍（多邊形）與岩壁（沿著牆底的折線），工具列左邊切換，各自有修改紀錄；
 * 改範圍時岩壁畫在地圖上當參考，改岩壁時範圍照常顯示。
 */
function MapItemView({ initialPart, ...props }: ItemProps & { initialPart: 'range' | 'walls' }) {
  const { t } = useLang()
  const target = props.item.id as EditTarget
  const [part, setPart] = useState(initialPart)
  const [dirty, setDirty] = useState(false)
  if (!target.startsWith('sector:')) return <MapEditor {...props} target={target} />
  const switchTo = (next: 'range' | 'walls') => {
    if (next === part || (dirty && !confirm(t('shape.confirmDiscard')))) return
    setDirty(false)
    props.onDirty(false)
    setPart(next)
  }
  const parts = (
    <div className="edit-segment">
      {(['range', 'walls'] as const).map((p) => (
        <button key={p} type="button" className={`edit-tool${part === p ? ' on' : ''}`} aria-pressed={part === p} onClick={() => switchTo(p)}>
          {t(p === 'range' ? 'edit.partRange' : 'edit.partWalls')}
        </button>
      ))}
    </div>
  )
  const onDirty = (d: boolean) => {
    setDirty(d)
    props.onDirty(d)
  }
  return <MapEditor key={part} {...props} onDirty={onDirty} target={part === 'range' ? target : wallTarget(sectorOf(target))} parts={parts} />
}

/** 地圖的編輯畫面：工具列（選取、新增、刪除、復原、重做、航照、提交）、地圖、右側面板（說明、修改紀錄、快捷鍵） */
function MapEditor({ item, data, onToast, onDirty, target, parts }: ItemProps & { target: EditTarget; parts?: ReactNode }) {
  const { t } = useLang()
  const cloud = useCloud()
  const map = useScaleMap()
  const shapes = useMapShapes()
  const { walls: legacyWalls } = useWalls()
  const m = useMapItem({ target, map: map.status === 'ok' ? map.data : undefined, onToast })
  const [ortho, setOrtho] = useState(true)
  const signedIn = cloud.status === 'signed-in'
  useEffect(() => onDirty(m.dirty), [m.dirty])
  const isWall = target.startsWith('wall:')
  const sector = target.startsWith('sector:') || isWall ? sectorOf(target) : undefined
  // 範圍、岩壁（不含步道）：這個區域的回報位置與說明畫在地圖上當參考（不顯示是誰、什麼時候）
  const pins = useReportPins(m.closed || isWall ? { target, data, map: map.status === 'ok' ? map.data : undefined } : undefined)
  const [pinOn, setPinOn] = useState<string>()
  /** 改分區範圍時，這個分區的岩壁畫在地圖上當參考 */
  const referenceWalls =
    sector && !isWall ? (shapes.walls[sector] ?? legacyWalls.filter((w) => w.sector === sector).map((w) => w.points)).map((points, i) => ({ key: `wall-${i}`, points })) : []

  // 快捷鍵（參考 iD、Figma）：V 選取、N 新增、Enter 完成、Esc 取消、Delete 刪除選中的、⌘Z／⌘⇧Z 復原／重做、⌘Enter 提交、A 航照
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const run = (f: () => void) => {
        e.preventDefault()
        f()
      }
      if (mod && key === 'z') return run(e.shiftKey ? m.actions.redo : m.actions.undo)
      if (mod && key === 'y') return run(m.actions.redo)
      if (mod && key === 'enter') return m.canSubmit && signedIn ? run(() => void m.actions.submit()) : undefined
      if (mod || e.altKey) return
      if (key === 'v') return run(m.actions.cancel)
      if (key === 'n' && !m.drawing) return run(m.actions.draw)
      if (key === 'enter' && m.drawing) return run(m.actions.finishDrawing)
      if (key === 'escape') return run(m.actions.cancel)
      if ((key === 'delete' || key === 'backspace') && !m.drawing) return run(m.actions.removeSelected)
      if (key === 'a') return run(() => setOrtho((o) => !o))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 打開時放大到這個項目；分區還沒有範圍（岩壁）時放大到分區範圍或所在的大區域；步道看整個地圖
  const focusArea = sector ? data.sectorById.get(sector)?.area.id.split('/').pop() : undefined
  const sectorRings = sector ? shapes.sectors.filter((s) => s.sector === sector).flatMap((s) => s.ring) : []
  const focus =
    m.ready && !isLineTarget(target)
      ? m.rings.length
        ? { key: target, coords: m.rings.flat() }
        : sectorRings.length
          ? { key: target, coords: sectorRings }
          : focusArea && { key: target, area: focusArea }
      : undefined

  const deleteVersion = async (version: string) => {
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
    <button type="button" className={`edit-tool${on ? ' on' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {label}
      <kbd>{key}</kbd>
    </button>
  )
  const addLabel = t(m.closed ? 'shape.add' : isWall ? 'shape.addWall' : 'shape.addLine')
  const finishLabel = t(m.closed ? 'shape.finish' : isWall ? 'shape.finishWall' : 'shape.finishLine')

  return (
    <>
      <section className="edit-center">
        <div className="edit-toolbar">
          {parts}
          <div className="edit-segment">
            {tool(!m.drawing, t('edit.select'), 'V', m.actions.cancel)}
            {tool(!!m.drawing, addLabel, 'N', m.actions.draw)}
          </div>
          {m.drawing ? (
            <>
              <span className="edit-status">{t(m.closed ? 'shape.drawHint' : isWall ? 'shape.drawWallHint' : 'shape.drawLineHint', { n: m.drawing.length })}</span>
              {tool(false, t('wall.undo'), '⌫', m.actions.undoPoint, m.drawing.length === 0)}
              {tool(false, finishLabel, 'Enter', m.actions.finishDrawing, !m.canFinish)}
            </>
          ) : (
            <>
              {tool(false, t('shape.removeRing'), 'Del', m.actions.removeSelected, m.selected === undefined)}
              <span className="edit-divider" />
              {tool(false, t('edit.undo'), '⌘Z', m.actions.undo, !m.canUndo)}
              {tool(false, t('edit.redo'), '⌘⇧Z', m.actions.redo, !m.canRedo)}
            </>
          )}
          <span className="edit-spacer" />
          {tool(ortho, t('map.ortho'), 'A', () => setOrtho(!ortho))}
          <button type="button" className="edit-btn primary" disabled={!m.canSubmit || !signedIn} onClick={() => void m.actions.submit()} title="⌘Enter">
            {t('shape.save')}
          </button>
        </div>
        <div className="edit-canvas">
          {map.status === 'ok' ? (
            <ScaleMap
              map={map.data}
              areaNames={{}}
              marks={pins.map((p) => ({ at: p.at, picked: p.picked, label: String(Number(p.id) + 1), selected: p.id === pinOn }))}
              ortho={ortho}
              hideAreas={isLineTarget(target)}
              edit={m.edit}
              pick={m.pick}
              lines={[...referenceWalls, ...(m.draftLine ? [m.draftLine] : [])]}
              focus={focus || undefined}
            />
          ) : (
            <p className="muted edit-message">{map.status === 'error' ? map.message : t('app.loading')}</p>
          )}
        </div>
      </section>
      <aside className="edit-panel">
        <h2>{item.label}</h2>
        <p className="muted small">{t(m.closed ? 'edit.mapTip' : isWall ? 'edit.wallTip' : 'edit.trailTip')}</p>
        <NeedSignIn />
        <ReportPins pins={pins} data={data} on={pinOn} onPick={setPinOn} />
        <VersionList versions={m.versions} empty={t(isWall ? 'edit.wallNoVersions' : 'shape.noVersions')} onDelete={(v) => void deleteVersion(v)} />
        <h2>{t('edit.shortcuts')}</h2>
        <dl className="edit-keys">
          {(
            [
              ['V', t('edit.select')],
              ['N', addLabel],
              ['Enter', finishLabel],
              ['Esc', t('edit.cancel')],
              ['Del', t('shape.removeRing')],
              ['⌘Z / ⌘⇧Z', `${t('edit.undo')} / ${t('edit.redo')}`],
              ['⌘Enter', t('shape.save')],
              ['A', t('map.ortho')],
              ['[ / ]', `${t('edit.catalog')} / ${t('edit.panel')}`],
              ['⌘\\', t('edit.maximize')],
              [t('edit.rightClick'), t('edit.deletePoint')],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </>
  )
}

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
          <span className="edit-status">{t(route ? 'edit.routeTextHint' : 'edit.areaTextHint')}</span>
          <span className="edit-spacer" />
          <button type="button" className="edit-btn primary" disabled={!dirty || saving || !signedIn} onClick={() => void submit()} title="⌘Enter">
            {t('shape.save')}
          </button>
        </div>
        <textarea
          className="edit-textarea"
          value={text}
          maxLength={3000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && dirty && signedIn) {
              e.preventDefault()
              void submit()
            }
          }}
          aria-label={item.label}
          placeholder={t('edit.textPlaceholder')}
        />
        {route && original && (
          <details className="edit-original">
            <summary>{t('text.original')}</summary>
            <p className="pre">{original}</p>
          </details>
        )}
      </section>
      <aside className="edit-panel">
        <h2>{item.label}</h2>
        <p className="muted small">{t('edit.textTip')}</p>
        {route && (
          <p className="small">
            <a href={href.route(route.id)}>{t('edit.viewRoute')}</a>
          </p>
        )}
        <NeedSignIn />
        <VersionList versions={versions[target] ?? []} empty={t('text.noVersions')} onDelete={(v) => void deleteVersion(v)} />
      </aside>
    </>
  )
}

/** Topo 項目：中間是 Topo 編輯器（照片、路線、線段與 bolt 工具都在裡面）；右側面板是使用說明 */
function TopoItemView({ item, data }: { item: EditItem; data: LoadedData }) {
  const { t } = useLang()
  const signedIn = useCloud().status === 'signed-in'
  const photo = useTopoState().photos?.[item.id]
  const old = photo && new Date(photo.createdAt).getFullYear() <= OLD_TOPO_YEAR
  return (
    <>
      <section className="edit-center edit-topo">
        <TopoEditor data={data} id={item.id} embedded />
      </section>
      <aside className="edit-panel">
        <h2>{item.path.slice(1).join(' › ')}</h2>
        {old && photo && (
          <div className="edit-warn">
            <p>{t('edit.oldTopo', { year: OLD_TOPO_YEAR })}</p>
            {signedIn && <UploadButton sector={photo.sector} />}
          </div>
        )}
        <p className="muted small">{t('edit.topoTip')}</p>
        {/* 新增這個分區的另一張 Topo 照片（舊照片的提示裡已經有按鈕；目錄裡每個分區底下也有同樣的按鈕） */}
        {!old && photo && signedIn && (
          <>
            <p className="muted small">{t('edit.topoAddHint')}</p>
            <UploadButton sector={photo.sector} />
          </>
        )}
      </aside>
    </>
  )
}
