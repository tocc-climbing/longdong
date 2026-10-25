import { useEffect, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { localName, useLang, type Lang, type Translate } from '../i18n'
import { areaNames } from '../map/mapData'
import { sectorTarget, useMapShapes } from '../map/shapes'
import { href, type EditKind } from '../router'
import { loadPhotos, useTopoState } from '../topo/store'
import { textTarget, useTextEdits } from './textEdits'

/** 修改模式的一個項目：地圖的對象、Topo 照片、說明的對象 */
export interface EditItem {
  kind: EditKind
  id: string
  label: string
  /** 所屬的分類（搜尋結果顯示用） */
  path: string[]
  /** 已經有人修改過（有版本） */
  edited: boolean
}

interface Group {
  key: string
  label: string
  items: EditItem[]
  groups: Group[]
}

const group = (key: string, label: string, items: EditItem[] = [], groups: Group[] = []): Group => ({ key, label, items, groups })
const allItems = (g: Group): EditItem[] => [...g.items, ...g.groups.flatMap(allItems)]

/** 目錄：地圖（步道、大區域、分區範圍）、Topo（各分區的照片）、說明（區域、路線） */
function buildCatalog(data: LoadedData, lang: Lang, t: Translate, edited: (kind: EditKind, id: string) => boolean, photos: { id: string; sector: string }[]): Group[] {
  const names = areaNames(data, lang)
  const areaKey = (id: string) => id.slice(id.indexOf('/') + 1)
  const item = (kind: EditKind, id: string, label: string, path: string[]): EditItem => ({ kind, id, label, path, edited: edited(kind, id) })
  const L = (n: Parameters<typeof localName>[0]) => localName(n, lang).main
  const mapLabel = t('edit.map')
  const textLabel = t('edit.text')
  return [
    group('map', mapLabel, [item('map', 'trails', t('shape.trails'), [mapLabel])], [
      group('map-areas', t('shape.areas'), Object.entries(names).map(([key, name]) => item('map', `area:${key}`, name, [mapLabel, t('shape.areas')]))),
      group(
        'map-sectors',
        t('edit.sectorShapes'),
        [],
        data.dataset.areas.map((a) => group(`map-sectors-${a.id}`, L(a.name), a.sectors.map((s) => item('map', sectorTarget(s.id), L(s.name), [mapLabel, L(a.name)])))),
      ),
    ]),
    group(
      'topo',
      'Topo',
      [],
      data.dataset.areas
        .map((a) =>
          group(
            `topo-${a.id}`,
            L(a.name),
            [],
            a.sectors
              .map((s) =>
                group(
                  `topo-${s.id}`,
                  L(s.name),
                  photos.filter((p) => p.sector === s.id).map((p, i) => item('topo', p.id, t('edit.photo', { n: i + 1 }), ['Topo', L(a.name), L(s.name)])),
                ),
              )
              .filter((g) => g.items.length),
          ),
        )
        .filter((g) => g.groups.length),
    ),
    group('text', textLabel, [], [
      group('text-areas', t('edit.areaText'), data.dataset.areas.map((a) => item('text', textTarget.area(areaKey(a.id)), L(a.name), [textLabel]))),
      group(
        'text-routes',
        t('edit.routeText'),
        [],
        data.dataset.areas.map((a) =>
          group(
            `text-${a.id}`,
            L(a.name),
            [],
            a.sectors.map((s) =>
              group(
                `text-${s.id}`,
                L(s.name),
                s.routes.filter((r) => !r.isFixture).map((r) => item('text', textTarget.route(r.id), `${r.number ? `#${r.number} ` : ''}${L(r.name)}`, [textLabel, L(a.name), L(s.name)])),
              ),
            ),
          ),
        ),
      ),
    ]),
  ]
}

/** 目錄的資料：所有項目與分組 */
export function useCatalog(data: LoadedData): { groups: Group[]; items: EditItem[] } {
  const { lang, t } = useLang()
  const shapes = useMapShapes()
  const texts = useTextEdits()
  const topo = useTopoState()
  useEffect(() => {
    void loadPhotos()
  }, [])
  const edited = (kind: EditKind, id: string) => (kind === 'map' ? !!shapes.versions[id]?.length : kind === 'text' ? !!texts[id]?.length : false)
  const groups = buildCatalog(data, lang, t, edited, Object.values(topo.photos ?? {}).sort((a, b) => a.createdAt - b.createdAt))
  return { groups, items: groups.flatMap(allItems) }
}

/**
 * 左側目錄：可搜尋（名稱、分類），分組可展開；目前的項目所在的分組自動展開；已經有人修改過的項目標一個點。
 * onOpen 回傳 false 時不換頁（有未提交的修改、使用者取消）。
 */
export function Catalog({ data, current, onOpen }: { data: LoadedData; current?: { kind: EditKind; id: string }; onOpen: () => boolean }) {
  const { t } = useLang()
  const { groups, items } = useCatalog(data)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const isCurrent = (i: EditItem) => i.kind === current?.kind && i.id === current?.id
  const link = (i: EditItem, withPath = false) => (
    <a
      key={`${i.kind}:${i.id}`}
      className={`edit-item${isCurrent(i) ? ' on' : ''}`}
      href={href.edit(i.kind, i.id)}
      aria-current={isCurrent(i) ? 'page' : undefined}
      onClick={(e) => {
        if (!onOpen()) e.preventDefault()
      }}
    >
      <span className="edit-item-label">
        {i.label}
        {withPath && <span className="edit-item-path">{i.path.join(' › ')}</span>}
      </span>
      {i.edited && <span className="edit-dot" title={t('edit.edited')} />}
    </a>
  )
  const tree = (g: Group, depth: number) => {
    const contains = allItems(g).some(isCurrent)
    return (
      <details key={g.key} className={`edit-group depth-${depth}`} open={depth === 0 || contains || undefined}>
        <summary>{g.label}</summary>
        {g.items.map((i) => link(i))}
        {g.groups.map((c) => tree(c, depth + 1))}
        {depth > 0 && g.items.length === 0 && g.groups.length === 0 && <p className="muted small">{t('edit.emptyGroup')}</p>}
      </details>
    )
  }
  const matches = q ? items.filter((i) => [i.label, ...i.path].join(' ').toLowerCase().includes(q)).slice(0, 100) : []
  return (
    <nav className="edit-catalog" aria-label={t('edit.catalog')}>
      <input type="search" className="edit-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('edit.search')} aria-label={t('edit.search')} />
      {q ? (
        <div className="edit-results">{matches.length ? matches.map((i) => link(i, true)) : <p className="muted small">{t('edit.noMatch')}</p>}</div>
      ) : (
        groups.map((g) => tree(g, 0))
      )}
    </nav>
  )
}
