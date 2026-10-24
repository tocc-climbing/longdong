import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
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
import { boltPositions, sameMarks, toPoint, type Marks, type Point, type RouteMarks, type TopoEdit, type TopoPhoto } from './model'
import { loadEdits, loadPhotos, useTopoState } from './store'
import { routeLabels } from './TopoSection'
import { px, TopoFrame, TopoLines } from './TopoView'

/**
 * Topo 編輯（電腦版）：左邊是照片，右邊選路線，在照片上標記線段（由起攀點往上）與 bolt。
 * 修改先存在這台裝置的草稿，按「提交」才上傳成新的版本；所有版本都保留，可以預覽、從舊版本繼續修改。
 */
export function TopoEditor({ data, id }: { data: LoadedData; id: string }) {
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
      <nav className="crumbs">
        <a href={href.area(area.id)}>{localName(area.name, lang).main}</a>
        {' › '}
        <a href={href.sector(sector.id)}>{localName(sector.name, lang).main}</a>
      </nav>
      <h1>{t('topo.editTitle')}</h1>
      {!wide ? (
        <p className="muted">{t('topo.desktopOnly')}</p>
      ) : cloud.status !== 'signed-in' ? (
        cloud.status !== 'loading' && <SignInPrompt message={t('topo.signIn')} />
      ) : (
        <Editor photo={photo} edits={edits} routes={sector.routes} labels={routeLabels(sector)} uid={cloud.user!.uid} />
      )}
    </div>
  )
}

type Mode = 'line' | 'bolt'

/** 這台裝置上未提交的修改；base 是開始修改時的最新版本 */
interface Draft {
  base?: string
  marks: Marks
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

function Editor({ photo, edits, routes, labels, uid }: { photo: TopoPhoto; edits: TopoEdit[]; routes: Route[]; labels: Map<string, string>; uid: string }) {
  const { lang, t } = useLang()
  const isAdmin = useIsAdmin()
  const profiles = useSocial().profiles
  const latest = edits.at(-1)
  const [draft, setDraftState] = useState<Draft | undefined>(() => readDraft(photo.id))
  const [preview, setPreview] = useState<TopoEdit>()
  const [selected, setSelected] = useState<string | undefined>(routes.find((r) => r.number)?.id)
  const [mode, setMode] = useState<Mode>('line')
  const [boltPos, setBoltPos] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const undo = useRef<Marks[]>([])

  const marks = preview?.marks ?? draft?.marks ?? latest?.marks ?? {}
  const changed = !!draft && !sameMarks(draft.marks, latest?.marks ?? {})
  const route = routes.find((r) => r.id === selected)
  const positions = route ? boltPositions(route) : []
  const current: RouteMarks = (selected && marks[selected]) || {}
  const nextPos = positions.find((p) => !current.bolts?.[p])
  const placing = boltPos && positions.includes(boltPos) ? boltPos : nextPos

  const setDraft = (d: Draft | undefined) => {
    writeDraft(photo.id, d)
    setDraftState(d)
  }
  /** 修改選取的路線；第一次修改時以最新版本為基礎建立草稿 */
  const edit = (change: (m: RouteMarks) => RouteMarks) => {
    if (!selected) return
    const base = draft?.marks ?? latest?.marks ?? {}
    undo.current.push(base)
    const next = { ...base, [selected]: change(base[selected] ?? {}) }
    if (!next[selected].line?.length && !Object.keys(next[selected].bolts ?? {}).length) delete next[selected]
    setDraft({ base: draft?.base ?? latest?.id, marks: next })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !preview) {
        const prev = undo.current.pop()
        if (!prev) return
        e.preventDefault()
        setDraft({ base: draft?.base ?? latest?.id, marks: prev })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pointAt = (e: { clientX: number; clientY: number }, svg: SVGSVGElement): Point => {
    const r = svg.getBoundingClientRect()
    return toPoint((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  const onPhotoClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (preview || !selected || dragging.current) return
    const p = pointAt(e, e.currentTarget)
    if (mode === 'line') edit((m) => ({ ...m, line: [...(m.line ?? []), p] }))
    else if (placing) {
      edit((m) => ({ ...m, bolts: { ...m.bolts, [placing]: p } }))
      setBoltPos(undefined)
    }
  }

  // 拖曳線段的點或 bolt：按下時記一次復原點，移動時直接改草稿
  const dragging = useRef<{ kind: 'line'; index: number } | { kind: 'bolt'; pos: string } | null>(null)
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
    const base = draft?.marks ?? latest?.marks ?? {}
    const m = base[selected] ?? {}
    const next = d.kind === 'line' ? { ...m, line: m.line!.map((q, i) => (i === d.index ? p : q)) } : { ...m, bolts: { ...m.bolts, [d.pos]: p } }
    setDraft({ base: draft?.base ?? latest?.id, marks: { ...base, [selected]: next } })
  }
  const endDrag = () => {
    // click 事件在 pointerup 之後才觸發：等它過去再清除，拖曳結束時不會多加一點
    setTimeout(() => (dragging.current = null))
  }

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await submitEdit(photo.id, draft!.marks)
      setDraft(undefined)
      undo.current = []
    } catch (err) {
      setError(t('topo.submitError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const discard = () => {
    if (!confirm(t('topo.confirmDiscard'))) return
    setDraft(undefined)
    undo.current = []
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

  const handles = (k: number) =>
    !preview &&
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
              onPointerDown={(e) => startDrag(e, { kind: 'line', index: i })}
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
              x={x - 7 * k}
              y={y - 7 * k}
              width={14 * k}
              height={14 * k}
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

  return (
    <div className="topo-edit-layout">
      <div className="topo-edit-photo">
        <TopoFrame
          photo={photo}
          alt=""
          svgProps={{ className: preview ? undefined : `editing ${mode}`, onClick: onPhotoClick, onContextMenu: (e) => e.preventDefault() }}
        >
          {(k) => (
            <>
              <TopoLines photo={photo} marks={marks} labels={labels} k={k} highlight={selected} />
              {handles(k)}
            </>
          )}
        </TopoFrame>
        <p className="muted small">{t('topo.howTo')}</p>
      </div>

      <aside className="topo-edit-side">
        {preview ? (
          <div className="topo-edit-bar notice">
            <span>{t('topo.previewing', { time: relativeTime(new Date(preview.createdAt).toISOString(), t), name: displayName(profiles, preview.uid) })}</span>
            <button
              className="action"
              onClick={() => {
                undo.current.push(draft?.marks ?? latest?.marks ?? {})
                setDraft({ base: latest?.id, marks: preview.marks })
                setPreview(undefined)
              }}
            >
              {t('topo.restore')}
            </button>
            <button className="action" onClick={() => setPreview(undefined)}>
              {t('topo.backToEditing')}
            </button>
          </div>
        ) : (
          <div className="topo-edit-bar">
            <span className="muted small">{changed ? t('topo.draft') : t('topo.noChanges')}</span>
            <button className="action primary" disabled={!changed || busy} onClick={() => void submit()}>
              {busy ? t('topo.submitting') : t('topo.submit')}
            </button>
            <button className="action" disabled={!draft || busy} onClick={discard}>
              {t('topo.discard')}
            </button>
          </div>
        )}
        {changed && draft?.base !== latest?.id && <p className="small warn-text">{t('topo.newerVersion')}</p>}
        {error && <p className="small error">{error}</p>}

        {route && !preview && (
          <div className="topo-edit-tools">
            <div className="segmented" role="group">
              <button aria-selected={mode === 'line'} onClick={() => setMode('line')}>
                {t('topo.modeLine')}
              </button>
              <button aria-selected={mode === 'bolt'} onClick={() => setMode('bolt')} disabled={positions.length === 0}>
                Bolt
              </button>
            </div>
            {mode === 'bolt' && (
              <div className="topo-positions">
                {positions.map((p) => (
                  <button key={p} className={current.bolts?.[p] ? 'chip placed' : 'chip'} aria-pressed={p === placing} onClick={() => setBoltPos(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
            <button className="link-button" disabled={!marks[route.id]} onClick={() => edit(() => ({}))}>
              {t('topo.clearRoute')}
            </button>
          </div>
        )}

        <ul className="topo-route-list">
          {routes.map((r) => {
            const m = marks[r.id]
            const bolts = Object.keys(m?.bolts ?? {}).length
            const total = boltPositions(r).length
            return (
              <li key={r.id}>
                <button className={`topo-route-row${r.id === selected ? ' on' : ''}`} onClick={() => {
                    setSelected(r.id)
                    setBoltPos(undefined)
                  }}
                >
                  <span className="topo-route-no">{r.number ?? '·'}</span>
                  <span className="topo-route-name">{localName(r.name, lang).main}</span>
                  <GradePill grade={r.grade} value={r.gradeValue} size="sm" />
                  <span className="topo-route-state muted small">
                    {[m?.line && t('topo.modeLine'), total > 0 && bolts > 0 && `Bolt ${bolts}/${total}`].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <section className="topo-history">
          <h2>{t('topo.history')}</h2>
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
        </section>
      </aside>
    </div>
  )
}
