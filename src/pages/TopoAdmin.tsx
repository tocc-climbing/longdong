import { useEffect, useMemo, useState } from 'react'
import { findSector, type LoadedData } from '../data/dataset'
import { localName, useLang } from '../i18n'
import { href } from '../router'
import { displayName } from '../social/store'
import { imageUrl } from '../topo/model'
import { removeTopo } from '../topo/actions'
import { loadEdits, loadPhotos, useTopoState } from '../topo/store'

/** 管理頁的「Topo」：所有分區的 Topo 照片（新到舊），可搜尋分區與上傳者、開啟編輯、刪除照片與所有人的標記 */
export function TopoAdmin({ data, profiles, time }: { data: LoadedData; profiles: Record<string, { name: string; updatedAt: string }>; time: (ms: number) => string }) {
  const { lang, t } = useLang()
  const { photos, edits, error } = useTopoState()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string>()
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
    void loadPhotos(true).then(() => undefined)
  }, [])
  const ids = photos && Object.keys(photos).join(' ')
  useEffect(() => {
    for (const id of ids ? ids.split(' ') : []) void loadEdits(id)
  }, [ids])

  const rows = useMemo(
    () =>
      Object.values(photos ?? {})
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((photo) => {
          const found = findSector(data, photo.sector)
          const place = found ? `${localName(found.area.name, lang).main} · ${localName(found.sector.name, lang).main}` : photo.sector
          return { photo, place, sectorId: found?.sector.id, who: displayName(profiles, photo.uid) }
        }),
    [photos, data, lang, profiles],
  )
  const q = query.trim().toLowerCase()
  const shown = rows.filter((r) => !q || r.place.toLowerCase().includes(q) || r.who.toLowerCase().includes(q))

  const remove = async (id: string) => {
    if (!confirm(t('topo.confirmDeletePhoto'))) return
    setBusy(id)
    setFailure(undefined)
    try {
      await removeTopo(photos![id])
    } catch (err) {
      setFailure(t('topo.deleteError', { error: (err as Error).message }))
    } finally {
      setBusy(undefined)
    }
  }

  if (error) {
    return (
      <p className="error" role="alert">
        {t('reports.loadFailed', { error })}
      </p>
    )
  }
  if (!photos) return <p className="muted">{t('app.loading')}</p>

  return (
    <>
      <div className="map-reports-tools">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.searchTopos')} aria-label={t('admin.searchTopos')} />
      </div>
      <p className="muted small">{t('admin.reportCount', { n: shown.length, total: rows.length })}</p>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      {rows.length === 0 && <p className="muted">{t('admin.noTopos')}</p>}
      <ul className="admin-list">
        {shown.map(({ photo, place, sectorId, who }) => {
          const list = edits[photo.id]
          const latest = list?.at(-1)
          return (
            <li key={photo.id} className="admin-topo">
              <img src={imageUrl(photo.image)} alt={t('topo.alt', { name: place })} loading="lazy" />
              <div className="admin-topo-body">
                <p className="admin-meta small">
                  {sectorId ? <a href={href.sector(sectorId)}>{place}</a> : place}
                  <span className="muted">
                    {' · '}
                    {t('admin.topoUploaded', { name: who, time: time(photo.createdAt) })}
                  </span>
                </p>
                <p className="muted small">
                  {list === undefined
                    ? t('app.loading')
                    : latest
                      ? t('admin.topoVersions', { n: list.length, name: displayName(profiles, latest.uid), time: time(latest.createdAt) })
                      : t('topo.noHistory')}
                </p>
                <div className="admin-actions">
                  <a className="action" href={href.topo(photo.id)}>
                    {t('topo.edit')}
                  </a>
                  <button type="button" className="action danger" disabled={busy === photo.id} onClick={() => void remove(photo.id)}>
                    {t('admin.deleteTopo')}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
