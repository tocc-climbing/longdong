import { useEffect } from 'react'
import { relativeTime } from '../format'
import { useLang } from '../i18n'
import { href, type EditKind } from '../router'
import { useMapShapes } from '../map/shapes'
import { displayName, useSocial } from '../social/store'
import { loadAllEdits, loadPhotos, useTopoState } from '../topo/store'
import type { EditItem } from './Catalog'
import { useTextEdits } from './textEdits'

const LIMIT = 10

interface Update {
  item: EditItem
  uid: string
  createdAt: number
  /** Topo 照片的上傳（不是標記） */
  upload?: boolean
}

/** 修改模式首頁：最近有更新的項目（地圖、Topo、說明混排，新到舊，每個項目一筆），點一筆進那個項目 */
export function LatestEdits({ items }: { items: EditItem[] }) {
  const { t } = useLang()
  const maps = useMapShapes()
  const texts = useTextEdits()
  const topo = useTopoState()
  const { profiles } = useSocial()
  useEffect(() => {
    void loadPhotos()
    void loadAllEdits()
  }, [])

  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]))
  const updates: Update[] = []
  const add = (kind: EditKind, id: string, list: { uid: string; createdAt: number }[] | undefined, upload?: boolean) => {
    const item = byKey.get(`${kind}:${id}`)
    if (item) for (const v of list ?? []) updates.push({ item, uid: v.uid, createdAt: v.createdAt, upload })
  }
  for (const [target, versions] of Object.entries(maps.versions)) add('map', target, versions)
  for (const [target, versions] of Object.entries(texts)) add('text', target, versions)
  for (const photo of Object.values(topo.photos ?? {})) {
    add('topo', photo.id, topo.edits[photo.id])
    add('topo', photo.id, [photo], true)
  }
  // 同一個項目只列最新的一筆
  const seen = new Set<EditItem>()
  const latest = updates
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((u) => !seen.has(u.item) && seen.add(u.item))
    .slice(0, LIMIT)
  const kindLabel: Record<EditKind, string> = { map: t('edit.map'), topo: 'Topo', text: t('edit.text') }

  return (
    <section className="edit-latest">
      <h2>{t('edit.latest')}</h2>
      {latest.length === 0 ? (
        <p className="muted small">{t('edit.latestEmpty')}</p>
      ) : (
        <ol>
          {latest.map((u) => (
            <li key={`${u.item.kind}:${u.item.id}:${u.createdAt}:${u.upload ? 'up' : ''}`}>
              <a href={href.edit(u.item.kind, u.item.id)}>
                <span className={`tool-kind ${u.item.kind}`}>{kindLabel[u.item.kind]}</span>
                <span className="edit-latest-text">
                  <b>{[...u.item.path.slice(1), u.item.label].join(' › ')}</b>
                  <span className="muted small">
                    {[displayName(profiles, u.uid), relativeTime(new Date(u.createdAt).toISOString(), t), u.upload && t('tools.uploaded')].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
