import { useState } from 'react'
import type { RouteRef } from '../data/dataset'
import type { Safety } from '../data/schema'
import { GRADE_BANDS } from '../format'
import { useLang, type MessageKey } from '../i18n'
import { useWide } from '../layout'
import {
  EMPTY_FILTER,
  applyView,
  filterCount,
  nextSort,
  setListView,
  toggle,
  useListView,
  type Kind,
  type ListView,
  type SortKey,
} from '../listView'
import { routeKey, summarize } from '../social/model'
import { useSocial } from '../social/store'
import { RouteRow } from './RouteRow'

const KINDS: { kind: Kind; key: MessageKey }[] = [
  { kind: 'sport', key: 'type.sport' },
  { kind: 'other', key: 'type.tradOther' },
]
const SAFETY: Safety[] = ['green', 'yellow', 'red']

/**
 * 可排序、篩選的路線清單。
 * 電腦版是表格（點欄位標題排序，篩選條件直接展開）；手機版是原本的清單，排序用下拉選單、篩選收合在按鈕裡。
 * defaultLabel：「預設順序」在這個清單代表什麼（區域內是編號，搜尋是相關度）；limit：篩選、排序後最多顯示幾條。
 */
export function RouteList({
  items,
  showPlace = false,
  defaultLabel,
  limit,
}: {
  items: RouteRef[]
  showPlace?: boolean
  defaultLabel: MessageKey
  limit?: number
}) {
  const { t } = useLang()
  const wide = useWide()
  const view = useListView()
  const ratings = useSocial().ratings
  const [open, setOpen] = useState(false)
  const shown = applyView(items, view, (id) => summarize(ratings[routeKey(id)])?.average)
  const visible = limit ? shown.slice(0, limit) : shown
  const count = filterCount(view.filter)

  return (
    <>
      <div className="list-tools">
        {!wide && <SortSelect view={view} defaultLabel={defaultLabel} />}
        {!wide && (
          <button className="chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {t('list.filter')}
            {count > 0 && <span className="count-badge">{count}</span>}
          </button>
        )}
        {count > 0 && (
          <>
            <span className="muted small">{t('list.shown', { n: shown.length, total: items.length })}</span>
            <button className="link-button small" onClick={() => setListView({ filter: EMPTY_FILTER })}>
              {t('list.clear')}
            </button>
          </>
        )}
      </div>
      {(wide || open) && <FilterPanel view={view} />}

      {wide ? (
        <div className="route-table">
          <div className="rt-head">
            <SortHeader view={view} sortKey="default" label={t('list.col.no')} />
            <span>{t('list.col.route')}</span>
            <SortHeader view={view} sortKey="grade" label={t('list.col.grade')} />
            <span>{t('list.col.type')}</span>
            <span>{t('list.col.safety')}</span>
            <SortHeader view={view} sortKey="rating" label={t('list.col.rating')} />
          </div>
          {visible.length > 0 && (
            <ul className="route-list">
              {visible.map((item) => (
                <RouteRow key={item.route.id} item={item} showPlace={showPlace} table />
              ))}
            </ul>
          )}
        </div>
      ) : (
        visible.length > 0 && (
          <ul className="route-list">
            {visible.map((item) => (
              <RouteRow key={item.route.id} item={item} showPlace={showPlace} />
            ))}
          </ul>
        )
      )}
      {shown.length === 0 && <p className="empty muted">{t('list.none')}</p>}
      {visible.length < shown.length && <p className="muted small center">{t('search.limited', { max: limit! })}</p>}
    </>
  )
}

function SortHeader({ view, sortKey, label }: { view: ListView; sortKey: SortKey; label: string }) {
  const active = view.sort === sortKey && !(sortKey === 'default' && !view.desc)
  return (
    <button
      className={`rt-sort${active ? ' on' : ''}`}
      aria-sort={view.sort === sortKey ? (view.desc ? 'descending' : 'ascending') : undefined}
      onClick={() => setListView(nextSort(view, sortKey))}
    >
      {label}
      <span aria-hidden>{view.sort === sortKey ? (view.desc ? ' ↓' : ' ↑') : ''}</span>
    </button>
  )
}

const SORT_OPTIONS = ['default', 'grade-asc', 'grade-desc', 'rating-desc'] as const

function SortSelect({ view, defaultLabel }: { view: ListView; defaultLabel: MessageKey }) {
  const { t } = useLang()
  const value = view.sort === 'default' ? 'default' : `${view.sort}-${view.desc ? 'desc' : 'asc'}`
  return (
    <label className="sort-select">
      <span className="visually-hidden">{t('list.sort')}</span>
      <select
        value={value}
        onChange={(e) => {
          const [sort, dir] = e.target.value.split('-') as [SortKey, string?]
          setListView({ sort, desc: dir === 'desc' })
        }}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o === 'default' ? t(defaultLabel) : t(`list.sort.${o}`)}
          </option>
        ))}
        {/* 電腦版切換過的其他排序，在手機寬度時也顯示得出來 */}
        {!(SORT_OPTIONS as readonly string[]).includes(value) && <option value={value}>{t('list.sort.custom')}</option>}
      </select>
    </label>
  )
}

function FilterPanel({ view }: { view: ListView }) {
  const { t } = useLang()
  const f = view.filter
  const set = (patch: Partial<typeof f>) => setListView({ filter: { ...f, ...patch } })
  return (
    <div className="filter-panel">
      <div className="chips" role="group" aria-label={t('list.col.grade')}>
        {GRADE_BANDS.map(({ band, label }) => (
          <button key={band} className="chip" aria-pressed={f.bands.includes(band)} onClick={() => set({ bands: toggle(f.bands, band) })}>
            {label}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label={t('type.filter')}>
        {KINDS.map(({ kind, key }) => (
          <button key={kind} className="chip" aria-pressed={f.kinds.includes(kind)} onClick={() => set({ kinds: toggle(f.kinds, kind) })}>
            {t(key)}
          </button>
        ))}
        <span className="chip-sep" aria-hidden />
        {SAFETY.map((s) => (
          <button key={s} className="chip" aria-pressed={f.safety.includes(s)} onClick={() => set({ safety: toggle(f.safety, s) })}>
            <span className={`light light-${s} on`} aria-hidden />
            {t(`safety.${s}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
