import { useEffect, useMemo, useRef, useState } from 'react'
import { GradePill } from '../components/GradePill'
import type { LoadedData, RouteRef } from '../data/dataset'
import { localName, useLang } from '../i18n'
import { href, navigate } from '../router'
import { shrink } from '../topo/actions'
import { useCloud } from '../personal/sync'
import { counts, missingResults, newRouteEntry, RESULTS, restPass, blanks, testable, type Outing, type PullResult, type RouteEntry, type StoredPullTest } from './model'
import { outingStatus, uploadOuting } from './upload'
import {
  addPhoto,
  createOuting,
  deleteOuting,
  deletePhoto,
  deleteRoutePhotos,
  knownCrew,
  photoBlob,
  photosOf,
  saveOuting,
  usePullTests,
  type PullTestState,
} from './store'
import './pulltest.css'

/** 照片長邊（拉測照片只要看得清楚 bolt 與拉測機的讀數） */
const PHOTO_EDGE = 1600
/** 搜尋路線時最多列出幾條 */
const SEARCH_MAX = 8

/** 拉測回報：沒有 id 是出勤清單，有 id 是這次出勤的表單 */
export function PullTestPage({ data, id }: { data: LoadedData; id?: string }) {
  const { t } = useLang()
  const s = usePullTests()
  if (!s.ready) return <p className="muted">{t('app.loading')}</p>
  if (s.error) return <p className="error">{t('pulltest.storageError', { error: s.error })}</p>
  const outing = id ? s.outings.find((o) => o.id === id) : undefined
  return outing ? <OutingForm data={data} s={s} outing={outing} /> : <OutingList data={data} s={s} />
}

function OutingList({ data, s }: { data: LoadedData; s: PullTestState }) {
  const { t } = useLang()
  return (
    <article className="pulltest">
      <h1>{t('pulltest.title')}</h1>
      <button type="button" className="action primary" onClick={() => void createOuting().then((o) => navigate(href.pulltest(o.id)))}>
        {t('pulltest.new')}
      </button>
      {s.outings.length === 0 ? (
        <p className="muted">{t('pulltest.empty')}</p>
      ) : (
        <ul className="list-card pulltest-outings">
          {s.outings.map((o) => (
            <li key={o.id}>
              <a href={href.pulltest(o.id)}>
                <b>{o.date}</b>
                <span className="muted small">
                  {[t('pulltest.routes', { n: o.routes.length }), ...o.crew].join('・')}
                </span>
                {o.routes.length > 0 && <span className="small">{countsText(t, o.routes)}</span>}
                <StatusLabel outing={o} />
                {o.routes.some((r) => !data.routeById.has(r.routeId)) && <span className="error small">{t('pulltest.routeGone')}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function countsText(t: ReturnType<typeof useLang>['t'], routes: RouteEntry[]): string {
  return t('pulltest.counts', { ...counts(routes) })
}

/** 上傳過的出勤的審核狀態（要登入才讀得到）；undefined：還沒讀到或讀不到 */
function useReview(outing: Outing): StoredPullTest | undefined {
  const cloud = useCloud()
  const [review, setReview] = useState<StoredPullTest>()
  useEffect(() => {
    if (!outing.uploadedAt || cloud.status !== 'signed-in') return
    let alive = true
    outingStatus(outing.id).then(
      (r) => alive && setReview(r),
      () => alive && setReview(undefined),
    )
    return () => {
      alive = false
    }
  }, [outing.id, outing.uploadedAt, cloud.status])
  return review
}

function StatusLabel({ outing }: { outing: Outing }) {
  const { t } = useLang()
  const review = useReview(outing)
  const status = !outing.uploadedAt ? 'local' : (review?.status ?? 'pending')
  return (
    <span className={`pulltest-status ${status}`}>
      {t(`pulltest.status.${status}`)}
      {status === 'rejected' && review?.review?.note && `：${review.review.note}`}
    </span>
  )
}

function UploadButton({ outing }: { outing: Outing }) {
  const { t } = useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const missing = missingResults(outing)
  return (
    <p className="pulltest-upload">
      <button
        type="button"
        className="action primary"
        disabled={busy || outing.routes.length === 0}
        onClick={async () => {
          if (missing.length) return setError(t('pulltest.missing', { n: missing.length }))
          setBusy(true)
          setError(undefined)
          try {
            await uploadOuting(outing)
          } catch (err) {
            setError(t('pulltest.uploadError', { error: (err as Error).message }))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? t('pulltest.uploading') : t('pulltest.upload')}
      </button>
      {error && <span className="error small">{error}</span>}
    </p>
  )
}

function OutingForm({ data, s, outing }: { data: LoadedData; s: PullTestState; outing: Outing }) {
  const { t } = useLang()
  const review = useReview(outing)
  // 上傳後只有被退回才能修改、重新上傳
  const editable = !outing.uploadedAt || review?.status === 'rejected'
  const save = (patch: Partial<Outing>) => void saveOuting({ ...outing, ...patch })
  const setRoute = (entry: RouteEntry) => save({ routes: outing.routes.map((r) => (r.routeId === entry.routeId ? entry : r)) })
  return (
    <article className="pulltest">
      <p>
        <a href={href.pulltest()}>{t('pulltest.all')}</a>
      </p>
      <h1>{t('pulltest.title')}</h1>
      <StatusLabel outing={outing} />
      <fieldset className="pulltest-form" disabled={!editable}>
        <section className="card pulltest-head">
          <label className="lang-picker">
            <span>{t('pulltest.date')}</span>
            <input type="date" value={outing.date} required onChange={(e) => e.target.value && save({ date: e.target.value })} />
          </label>
          <Crew crew={outing.crew} known={knownCrew(s)} onChange={(crew) => save({ crew })} />
          {outing.routes.length > 0 && <p className="small">{countsText(t, outing.routes)}</p>}
        </section>

        {outing.routes.map((entry) => {
          const ref = data.routeById.get(entry.routeId)
          return (
            <RouteCard
              key={entry.routeId}
              routeRef={ref}
              entry={entry}
              s={s}
              outingId={outing.id}
              onChange={setRoute}
              onRemove={() => {
                if (!confirm(t('pulltest.confirmRemoveRoute'))) return
                save({ routes: outing.routes.filter((r) => r.routeId !== entry.routeId) })
                void deleteRoutePhotos(outing.id, entry.routeId)
              }}
            />
          )
        })}

        {editable && <RoutePicker data={data} exclude={outing.routes.map((r) => r.routeId)} onPick={(ref) => save({ routes: [...outing.routes, newRouteEntry(ref.route)] })} />}
      </fieldset>

      {editable && <UploadButton outing={outing} />}

      <p className="pulltest-delete">
        <button
          type="button"
          className="action danger"
          onClick={() => confirm(t('pulltest.confirmDelete')) && void deleteOuting(outing.id).then(() => navigate(href.pulltest(), { replace: true }))}
        >
          {t('pulltest.delete')}
        </button>
      </p>
    </article>
  )
}

function Crew({ crew, known, onChange }: { crew: string[]; known: string[]; onChange: (crew: string[]) => void }) {
  const { t } = useLang()
  const [name, setName] = useState('')
  const add = (n: string) => {
    const v = n.trim().replace(/\s+/g, ' ')
    if (v && !crew.includes(v)) onChange([...crew, v])
    setName('')
  }
  const suggestions = known.filter((k) => !crew.includes(k))
  return (
    <div className="pulltest-crew">
      <span className="pulltest-label">{t('pulltest.crew')}</span>
      <div className="chips">
        {crew.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed="true" onClick={() => onChange(crew.filter((x) => x !== c))}>
            {c} ×
          </button>
        ))}
        {suggestions.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed="false" onClick={() => add(c)}>
            {c}
          </button>
        ))}
      </div>
      <form
        className="pulltest-row"
        onSubmit={(e) => {
          e.preventDefault()
          add(name)
        }}
      >
        <input value={name} placeholder={t('pulltest.crewPlaceholder')} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="action" disabled={!name.trim()}>
          {t('pulltest.add')}
        </button>
      </form>
    </div>
  )
}

function RouteTitle({ routeRef }: { routeRef: RouteRef }) {
  const { lang } = useLang()
  const { route, sector, area } = routeRef
  return (
    <div className="pulltest-route-title">
      <b>
        {route.number && `#${route.number} `}
        {localName(route.name, lang).main}
      </b>{' '}
      <GradePill grade={route.grade} value={route.gradeValue} size="sm" />
      <span className="muted small">
        {localName(area.name, lang).main}／{localName(sector.name, lang).main}
      </span>
    </div>
  )
}

function RouteCard({
  routeRef,
  entry,
  s,
  outingId,
  onChange,
  onRemove,
}: {
  routeRef?: RouteRef
  entry: RouteEntry
  s: PullTestState
  outingId: string
  onChange: (entry: RouteEntry) => void
  onRemove: () => void
}) {
  const { t } = useLang()
  const bolts = routeRef ? testable(routeRef.route) : []
  const setResult = (position: string, result: PullResult) => {
    const cur = entry.bolts[position]?.result
    onChange({ ...entry, bolts: { ...entry.bolts, [position]: cur === result ? {} : { result } } })
  }
  return (
    <section className="card pulltest-route">
      <header>
        {routeRef ? <RouteTitle routeRef={routeRef} /> : <b className="error">{t('pulltest.routeGone')}（{entry.routeId}）</b>}
        <button type="button" className="link-button danger" onClick={onRemove}>
          {t('pulltest.removeRoute')}
        </button>
      </header>
      <p className="small">{countsText(t, [entry])}</p>
      {bolts.length === 0 && <p className="muted small">{t('pulltest.noBolts')}</p>}
      <ul className="pulltest-bolts">
        {bolts.map((b) => (
          <li key={b.position}>
            <div className="pulltest-bolt-head">
              <b>{b.position}</b>
              <span className="muted small">
                {b.material}
                {b.tests[0] && `・${t('pulltest.lastTested', { date: b.tests[0] })}`}
              </span>
              <PhotoButton outingId={outingId} routeId={entry.routeId} position={b.position} />
            </div>
            <div className="pulltest-results" role="group" aria-label={b.position}>
              {RESULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip result-${r}`}
                  aria-pressed={entry.bolts[b.position]?.result === r}
                  onClick={() => setResult(b.position, r)}
                >
                  {t(`pulltest.result.${r}`)}
                </button>
              ))}
            </div>
            <Photos ids={photosOf(s, outingId, entry.routeId, b.position)} />
          </li>
        ))}
      </ul>
      {blanks(entry) > 0 && (
        <button type="button" className="action" onClick={() => onChange(restPass(entry))}>
          {t('pulltest.restPass')}
        </button>
      )}
      <label className="pulltest-field">
        <span className="pulltest-label">{t('pulltest.note')}</span>
        <textarea rows={2} value={entry.note ?? ''} onChange={(e) => onChange({ ...entry, note: e.target.value || undefined })} />
      </label>
      <label className="pulltest-field">
        <span className="pulltest-label">{t('pulltest.anchorHardware')}</span>
        <input value={entry.anchorHardware ?? ''} onChange={(e) => onChange({ ...entry, anchorHardware: e.target.value || undefined })} />
      </label>
    </section>
  )
}

function PhotoButton({ outingId, routeId, position }: { outingId: string; routeId: string; position: string }) {
  const { t } = useLang()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <>
      <button type="button" className="icon-button small pulltest-camera" aria-label={`${t('pulltest.photo')} ${position}`} title={t('pulltest.photo')} disabled={busy} onClick={() => input.current?.click()}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          setError(undefined)
          try {
            const { blob } = await shrink(file, undefined, PHOTO_EDGE)
            await addPhoto(outingId, routeId, position, blob)
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      />
      {error && <span className="error small">{error}</span>}
    </>
  )
}

function Photos({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null
  return (
    <div className="pulltest-photos">
      {ids.map((id) => (
        <Thumb key={id} id={id} />
      ))}
    </div>
  )
}

function Thumb({ id }: { id: string }) {
  const { t } = useLang()
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let u: string | undefined
    let alive = true
    void photoBlob(id).then((b) => {
      if (!b || !alive) return
      u = URL.createObjectURL(b)
      setUrl(u)
    })
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [id])
  return (
    <span className="pulltest-thumb">
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="" />
        </a>
      )}
      <button type="button" aria-label={t('topo.deletePhoto')} title={t('topo.deletePhoto')} onClick={() => confirm(`${t('topo.deletePhoto')}？`) && void deletePhoto(id)}>
        ×
      </button>
    </span>
  )
}

/** 路線編號開頭、或名稱包含搜尋字串的路線 */
function searchRoutes(data: LoadedData, q: string, exclude: string[]): RouteRef[] {
  const query = q.trim().replace(/^#/, '').toLowerCase()
  if (!query) return []
  const out: RouteRef[] = []
  for (const r of data.routes) {
    if (exclude.includes(r.route.id)) continue
    const hit = r.route.number?.startsWith(query) || r.route.name.zh.toLowerCase().includes(query) || r.route.name.en?.toLowerCase().includes(query)
    if (hit) out.push(r)
    if (out.length >= SEARCH_MAX) break
  }
  return out
}

function RoutePicker({ data, exclude, onPick }: { data: LoadedData; exclude: string[]; onPick: (ref: RouteRef) => void }) {
  const { t } = useLang()
  const [q, setQ] = useState('')
  const found = useMemo(() => searchRoutes(data, q, exclude), [data, q, exclude])
  return (
    <section className="card pulltest-picker">
      <h2>{t('pulltest.addRoute')}</h2>
      <input type="search" value={q} placeholder={t('pulltest.searchRoute')} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <ul className="list-card">
          {found.map((r) => (
            <li key={r.route.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(r)
                  setQ('')
                }}
              >
                <RouteTitle routeRef={r} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
