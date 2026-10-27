import { useEffect, useMemo, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { LOCALES, localName, useLang, type MessageKey } from '../i18n'
import { areaNames } from '../map/mapData'
import { withCloud } from '../personal/sync'
import { href } from '../router'
import { displayName } from '../social/store'
import { removeTopo } from '../topo/actions'
import { buildFeed, buildPending, countByType, effectiveTypes, filterFeed, summarizeUsers, type AdminRaw, type FeedContext, type FeedGroup, type FeedItem, type FeedType } from './feed'

/** 管理頁的區塊：全部、待處理（檢舉）、內容（留言與評分）、修改（Topo、地圖、說明、岩壁）、使用者、地圖回報 */
export type AdminSection = 'all' | 'pending' | 'content' | 'changes' | 'users' | 'map'
export const SECTIONS: AdminSection[] = ['all', 'pending', 'content', 'changes', 'users', 'map']

const DAY = 86_400_000
/** 時間範圍：往前幾天（0 = 不限） */
export const RANGES = [0, 1, 7, 30] as const
export type Range = (typeof RANGES)[number]

type Loaded = AdminRaw & { profiles: Record<string, { name: string }> }

/**
 * 管理頁的資料與狀態（電腦版、手機版共用）：讀回所有人輸入的資料、整理成清單、篩選條件、刪除與忽略檢舉。
 * 畫面只負責排版，兩種版面看到的是同一份資料與同樣的操作。
 */
export function useAdminModel(data: LoadedData, enabled: boolean, initialSection: AdminSection) {
  const { lang, t } = useLang()
  const [raw, setRaw] = useState<Loaded>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [section, setSection] = useState<AdminSection>(initialSection)
  const [types, setTypes] = useState<ReadonlySet<FeedType>>(new Set())
  const [uid, setUid] = useState<string>()
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<Range>(0)
  /** 選到的項目（電腦版右側顯示詳細、手機版展開）：輸入的 key、待處理的檢舉 id、使用者 uid */
  const [selected, setSelected] = useState<string>()

  const load = async () => {
    setError(undefined)
    try {
      const { m } = await withCloud()
      setRaw(await m.loadAdminData())
    } catch (err) {
      setError((err as Error).message)
    }
  }
  useEffect(() => {
    if (enabled) void load()
  }, [enabled])
  // 換區塊或篩選時，選到的項目可能不在清單裡了
  useEffect(() => setSelected(undefined), [section, types, uid, query, range])

  const profiles = useMemo(() => Object.fromEntries(Object.entries(raw?.profiles ?? {}).map(([id, p]) => [id, { name: p.name, updatedAt: '' }])), [raw])
  const userName = (id: string) => displayName(profiles, id)
  const time = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const feed = useMemo(() => {
    if (!raw) return []
    const areas = areaNames(data, lang)
    const sector = (id: string) => {
      const found = data.sectorById.get(id)
      return found ? `${localName(found.area.name, lang).main} · ${localName(found.sector.name, lang).main}` : id
    }
    const ctx: FeedContext = {
      t,
      who: (id) => displayName(profiles, id),
      route: (key) => {
        const ref = data.routeById.get(key.replace(':', '/'))
        return ref ? { name: `${ref.route.number ? `#${ref.route.number} ` : ''}${localName(ref.route.name, lang).main}`, href: href.route(ref.route.id) } : { name: key }
      },
      sector,
      area: (key) => areas[key] ?? key,
      mapTarget: (target) => {
        const [kind, ...rest] = target.split(':')
        if (kind === 'area') return `${t('shape.areas')} · ${areas[rest.join(':')] ?? rest.join(':')}`
        if (kind === 'sector') return `${t('edit.sectorShapes')} · ${sector(rest.join(':').replace(':', '/'))}`
        if (kind === 'wall') return `${t('admin.type.wall')} · ${sector(rest.join(':').replace(':', '/'))}`
        return target === 'trails' ? t('shape.trails') : target
      },
      editHref: href.edit,
    }
    return buildFeed(raw, ctx)
  }, [raw, data, lang, t, profiles])

  const pending = useMemo(() => (raw ? buildPending(raw, feed, userName) : []), [raw, feed, profiles])
  const users = useMemo(() => summarizeUsers(feed, raw?.profiles ?? {}), [feed, raw])
  const typeCounts = useMemo(() => countByType(feed), [feed])

  const group: FeedGroup | undefined = section === 'content' || section === 'changes' ? section : undefined
  const effective = useMemo(() => effectiveTypes(group, types), [group, types])
  const visible = useMemo(() => filterFeed(feed, { types: effective, uid, query, from: range ? Date.now() - range * DAY : undefined }), [feed, effective, uid, query, range])
  const q = query.trim().toLowerCase()
  const visibleUsers = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.uid.toLowerCase().startsWith(q))
  const visiblePending = pending.filter((p) => !q || `${p.who} ${p.reason ?? ''} ${p.comment?.summary ?? ''} ${p.comment?.target ?? ''} ${p.comment?.who ?? ''}`.toLowerCase().includes(q))

  const typeLabel = (type: FeedType) => t(`admin.type.${type}` as MessageKey)
  const toggleType = (type: FeedType) =>
    setTypes((prev) => {
      const next = new Set(prev)
      if (!next.delete(type)) next.add(type)
      return next
    })
  /** 只看某個人的輸入（到「全部」） */
  const showUser = (id: string) => {
    setUid(id)
    setTypes(new Set())
    setSection('all')
  }

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key)
    try {
      await task()
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(undefined)
    }
  }
  const adminDelete = (paths: string[]) => async () => (await withCloud()).m.adminDelete(paths)

  /** 刪除一筆輸入（確認後）；Topo 照片連 Storage 的檔案、所有人的標記一起刪 */
  const removeItem = (item: FeedItem) => {
    if (!confirm(t('admin.confirmDeleteItem', { type: typeLabel(item.type), text: item.summary.slice(0, 60) }))) return
    if (item.photo) void run(item.key, () => removeTopo(item.photo!))
    else void run(item.key, adminDelete(item.deletePaths))
  }
  const canDelete = (item: FeedItem) => item.deletePaths.length > 0 || !!item.photo
  /** 刪除被檢舉的留言，連同檢舉這則留言的紀錄 */
  const removeReported = (item: FeedItem) => {
    if (!confirm(t('admin.confirmDelete', { text: item.summary.slice(0, 40) }))) return
    void run(item.key, adminDelete([...item.deletePaths, ...pending.filter((r) => r.comment?.key === item.key).map((r) => `v2/reports/${r.id}`)]))
  }
  /** 忽略檢舉（留言保留） */
  const dismiss = (id: string) => void run(id, adminDelete([`v2/reports/${id}`]))

  return {
    raw, error, busy, load, section, setSection, types, toggleType, clearTypes: () => setTypes(new Set()), uid, setUid, query, setQuery, range, setRange, selected, setSelected,
    feed, pending, users, typeCounts, visible, visibleUsers, visiblePending, group, effective, profiles,
    userName, time, typeLabel, showUser, removeItem, canDelete, removeReported, dismiss,
  }
}

export type AdminModel = ReturnType<typeof useAdminModel>
