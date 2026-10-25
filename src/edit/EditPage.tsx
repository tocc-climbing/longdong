import { useEffect, useState, type ReactNode } from 'react'
import { useIsAdmin } from '../admin'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import { LOCALES, useLang } from '../i18n'
import { useWide } from '../layout'
import { useScaleMap } from '../map/mapData'
import { ScaleMap } from '../map/ScaleMap'
import { loadMapShapes, type EditTarget, type MapEditVersion } from '../map/shapes'
import { useCloud, withCloud } from '../personal/sync'
import { href, navigate, type EditKind } from '../router'
import { displayName, useSocial } from '../social/store'
import { TopoEditor } from '../topo/TopoEditor'
import { Catalog, useCatalog, type EditItem } from './Catalog'
import { currentText, loadTextEdits, textTarget, useTextEdits, type TextTarget, type TextVersion } from './textEdits'
import { useMapItem } from './useMapItem'
import './edit.css'

const TOAST_MS = 3500

/**
 * 修改模式（/edit/<種類>/<項目>）：地圖（步道、大區域、分區範圍）、Topo、區域與路線說明，所有登入者都能修改，每次提交是一個新版本。
 * 電腦版三欄：左側目錄、中間編輯、右側資訊（說明、修改紀錄、快捷鍵）；上方工具列。
 * 手機版只能看目錄與修改說明；地圖與 Topo 提示用電腦開啟。每個項目有自己的網址，可以分享給岩友一起修改。
 */
export function EditPage({ data, kind, id }: { data: LoadedData; kind?: EditKind; id?: string }) {
  const { t } = useLang()
  const wide = useWide()
  const { items } = useCatalog(data)
  const item = kind && id ? items.find((i) => i.kind === kind && i.id === id) : undefined
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState<string>()

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
      <MapItemView key={item.id} item={item} {...props} />
    ) : (
      <TopoItemView key={item.id} item={item} data={data} />
    )

  return (
    <div className={`edit-app${wide ? '' : ' narrow'}${item ? ' has-item' : ''}`}>
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
      {(wide || !item) && <Catalog data={data} current={item} onOpen={open} />}
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

/** 還沒選項目：怎麼開始、有多少項目已經有人修改 */
function Welcome({ items }: { items: EditItem[] }) {
  const { t } = useLang()
  return (
    <>
      <section className="edit-center edit-message">
        <h1>{t('edit.welcome')}</h1>
        <p>{t('edit.welcomeHint')}</p>
        <p className="muted">{t('edit.progress', { n: items.filter((i) => i.edited).length, total: items.length })}</p>
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
              <span>
                <b>{displayName(profiles, v.uid)}</b>
                <span className="muted"> · {time(v.createdAt)}</span>
                {i === 0 && <span className="edit-badge">{t('shape.current')}</span>}
              </span>
              {(v.uid === uid || admin) && (
                <button type="button" className="link-button" onClick={() => confirm(t('shape.confirmDeleteVersion')) && onDelete(v.id)}>
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

type ItemProps = { item: EditItem; data: LoadedData; onToast: (text: string) => void; onDirty: (dirty: boolean) => void }

/** 是不是在輸入框裡打字（快捷鍵不處理） */
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** 地圖項目：工具列（選取、新增、刪除、復原、重做、航照、提交）、地圖、右側面板（說明、修改紀錄、快捷鍵） */
function MapItemView({ item, data, onToast, onDirty }: ItemProps) {
  const { t } = useLang()
  const cloud = useCloud()
  const map = useScaleMap()
  const target = item.id as EditTarget
  const m = useMapItem({ target, map: map.status === 'ok' ? map.data : undefined, onToast })
  const [ortho, setOrtho] = useState(true)
  const signedIn = cloud.status === 'signed-in'
  useEffect(() => onDirty(m.dirty), [m.dirty])

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

  // 打開時放大到這個項目；分區還沒有範圍時放大到所在的大區域；步道看整個地圖
  const focusArea = target.startsWith('sector:') ? data.sectorById.get(target.slice('sector:'.length).replace(':', '/'))?.area.id.split('/').pop() : undefined
  const focus =
    m.ready && target !== 'trails'
      ? m.rings.length
        ? { key: target, coords: m.rings.flat() }
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
  const addLabel = t(m.closed ? 'shape.add' : 'shape.addLine')

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
              <span className="edit-status">{t(m.closed ? 'shape.drawHint' : 'shape.drawLineHint', { n: m.drawing.length })}</span>
              {tool(false, t('wall.undo'), '⌫', m.actions.undoPoint, m.drawing.length === 0)}
              {tool(false, t(m.closed ? 'shape.finish' : 'shape.finishLine'), 'Enter', m.actions.finishDrawing, !m.canFinish)}
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
            <ScaleMap map={map.data} areaNames={{}} marks={[]} ortho={ortho} edit={m.edit} pick={m.pick} lines={m.draftLine ? [m.draftLine] : []} focus={focus || undefined} />
          ) : (
            <p className="muted edit-message">{map.status === 'error' ? map.message : t('app.loading')}</p>
          )}
        </div>
      </section>
      <aside className="edit-panel">
        <h2>{item.label}</h2>
        <p className="muted small">{t(m.closed ? 'edit.mapTip' : 'edit.trailTip')}</p>
        <NeedSignIn />
        <VersionList versions={m.versions} empty={t('shape.noVersions')} onDelete={(v) => void deleteVersion(v).then(m.actions.reload)} />
        <h2>{t('edit.shortcuts')}</h2>
        <dl className="edit-keys">
          {(
            [
              ['V', t('edit.select')],
              ['N', addLabel],
              ['Enter', t(m.closed ? 'shape.finish' : 'shape.finishLine')],
              ['Esc', t('edit.cancel')],
              ['Del', t('shape.removeRing')],
              ['⌘Z / ⌘⇧Z', `${t('edit.undo')} / ${t('edit.redo')}`],
              ['⌘Enter', t('shape.save')],
              ['A', t('map.ortho')],
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
  return (
    <>
      <section className="edit-center edit-topo">
        <TopoEditor data={data} id={item.id} embedded />
      </section>
      <aside className="edit-panel">
        <h2>{item.path.slice(1).join(' › ')}</h2>
        <p className="muted small">{t('edit.topoTip')}</p>
      </aside>
    </>
  )
}
