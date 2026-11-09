import { useEffect, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { localName, useLang } from '../i18n'
import { withCloud } from '../personal/sync'
import { approvedSummary, counts, photoPath, type StoredPullTest } from './model'
import './pulltest.css'

/** 管理頁的「拉測回報」：所有上傳的出勤（待審核在前），看結果與照片，整筆通過或退回 */
export function PullTestReview({ data, userName }: { data: LoadedData; userName: (uid: string) => string }) {
  const { t } = useLang()
  const [all, setAll] = useState<Record<string, StoredPullTest>>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()

  const load = async () => {
    setError(undefined)
    try {
      setAll(await (await withCloud()).m.loadPullTests())
    } catch (err) {
      setError((err as Error).message)
    }
  }
  useEffect(() => void load(), [])

  const review = async (id: string, decision: Parameters<Awaited<ReturnType<typeof withCloud>>['m']['reviewPullTest']>[2]) => {
    setBusy(id)
    setError(undefined)
    try {
      const { m, uid } = await withCloud()
      await m.reviewPullTest(uid, id, decision)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  if (error && !all) return <p className="error">{error}</p>
  if (!all) return <p className="muted">{t('app.loading')}</p>
  const order = { pending: 0, rejected: 1, approved: 2 }
  const items = Object.entries(all).sort(([, a], [, b]) => order[a.status] - order[b.status] || b.createdAt - a.createdAt)
  if (items.length === 0) return <p className="muted">{t('pulltest.noOutings')}</p>

  return (
    <div className="pulltest pulltest-review">
      {error && <p className="error">{error}</p>}
      {items.map(([id, o]) => {
        const summary = approvedSummary(o, data)
        return (
          <section key={id} className="card">
            <header className="pulltest-review-head">
              <b>{o.date}</b>
              <span className={`pulltest-status ${o.status}`}>{t(`pulltest.status.${o.status}`)}</span>
              <span className="muted small">{[t('pulltest.uploadedBy', { name: userName(o.uid) }), ...(o.crew ?? [])].join('・')}</span>
            </header>
            <p className="small">{t('pulltest.counts', { ...counts(Object.values(o.routes).map((r) => ({ routeId: '', bolts: r.bolts }))) })}</p>
            {o.review?.note && <p className="small">{`${t('pulltest.rejectReason')}：${o.review.note}`}</p>}
            {Object.entries(o.routes).map(([key, r]) => {
              const ref = data.routeById.get(key.replace(':', '/'))
              return (
                <div key={key} className="pulltest-review-route">
                  <b>{ref ? `${ref.route.number ? `#${ref.route.number} ` : ''}${localName(ref.route.name, 'zh').main}` : key}</b>
                  {ref && <span className="muted small">{ref.area.name.zh}</span>}
                  <ul className="pulltest-review-bolts">
                    {Object.entries(r.bolts)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([pos, b]) => (
                        <li key={pos}>
                          <b>{pos}</b> <span className={`result-${b.result}`}>{t(`pulltest.result.${b.result}`)}</span>
                          {Object.entries(b.photos ?? {}).map(([photo, ext]) => (
                            <RemotePhoto key={photo} path={photoPath(o.uid, id, photo, ext === 'webp' ? 'image/webp' : 'image/jpeg')} />
                          ))}
                        </li>
                      ))}
                  </ul>
                  {r.note && <p className="small">{`${t('pulltest.note')}：${r.note}`}</p>}
                  {r.anchorHardware && <p className="small">{`${t('pulltest.anchorHardware')}：${r.anchorHardware}`}</p>}
                </div>
              )
            })}
            {o.status === 'pending' && (
              <div className="actions">
                <button type="button" className="action primary" disabled={!!busy || !summary} onClick={() => summary && void review(id, { approved: summary })}>
                  {t('pulltest.approve')}
                </button>
                <button
                  type="button"
                  className="action danger"
                  disabled={!!busy}
                  onClick={() => {
                    const reason = prompt(t('pulltest.rejectReason'))
                    if (reason !== null) void review(id, { rejected: reason.trim() })
                  }}
                >
                  {t('pulltest.reject')}
                </button>
                {!summary && <span className="error small">{t('pulltest.cantApprove')}</span>}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** 縮圖：照片只有上傳者與管理員讀得到，要用登入後的下載網址 */
function RemotePhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let alive = true
    void withCloud()
      .then(({ m }) => m.pullTestPhotoUrl(path))
      .then(
        (u) => alive && setUrl(u),
        (err: Error) => alive && setError(err.message),
      )
    return () => {
      alive = false
    }
  }, [path])
  if (error) return <span className="error small" title={error}>⚠</span>
  return url ? (
    <a className="pulltest-thumb" href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="" />
    </a>
  ) : null
}
