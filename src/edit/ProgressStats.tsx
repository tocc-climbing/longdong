import { useEffect } from 'react'
import type { LoadedData } from '../data/dataset'
import { useLang } from '../i18n'
import { loadAllEdits, loadPhotos, useTopoState } from '../topo/store'
import type { EditItem } from './Catalog'
import { itemProgress, topoProgress, type Progress } from './progress'

/** 編輯模式首頁的完成度：Topo（畫了線段的路線／全部路線）、地圖與說明（已有人修改的項目／全部項目） */
export function ProgressStats({ data, items }: { data: LoadedData; items: EditItem[] }) {
  const { t } = useLang()
  const topo = useTopoState()
  useEffect(() => {
    void loadPhotos()
    void loadAllEdits()
  }, [])
  const photos = Object.values(topo.photos ?? {})
  const loaded = !!topo.photos && photos.every((p) => topo.edits[p.id])
  const routeIds = data.routes.filter((r) => !r.route.isFixture).map((r) => r.route.id)
  const stats: { key: string; label: string; unit: string; progress?: Progress }[] = [
    {
      key: 'topo',
      label: 'Topo',
      unit: t('edit.unitRoutes'),
      progress: loaded
        ? topoProgress(
            routeIds,
            photos.map((p) => topo.edits[p.id]!.at(-1)?.marks ?? {}),
          )
        : undefined,
    },
    { key: 'map', label: t('edit.map'), unit: t('edit.unitItems'), progress: itemProgress(items, 'map') },
    { key: 'text', label: t('edit.text'), unit: t('edit.unitItems'), progress: itemProgress(items, 'text') },
  ]
  return (
    <section className="edit-stats">
      {stats.map(({ key, label, unit, progress }) => {
        const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
        return (
          <div key={key} className="edit-stat">
            <span className="edit-stat-label">{label}</span>
            <span className="edit-stat-value">
              <b>{progress ? progress.done : '–'}</b>
              <span className="muted"> / {progress ? progress.total : '–'}</span>
            </span>
            <span className="edit-stat-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{ width: `${percent}%` }} />
            </span>
            <span className="edit-stat-foot muted">
              {unit} · {percent}%
            </span>
          </div>
        )
      })}
    </section>
  )
}
