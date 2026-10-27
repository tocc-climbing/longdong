import { describe, expect, it } from 'vitest'
import { buildFeed, buildPending, countByType, effectiveTypes, FEED_GROUPS, FEED_TYPES, filterFeed, isAdminDeletable, summarizeUsers, type AdminRaw, type FeedContext, type FeedItem, type FeedType } from '../src/admin/feed'

const ctx: FeedContext = {
  t: ((key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${Object.values(vars).join(',')}` : key)) as FeedContext['t'],
  who: (uid) => ({ u1: 'KK', u2: 'Jin' })[uid] ?? uid,
  route: (key) => ({ name: `路線 ${key}`, href: `/route/${key}` }),
  sector: (id) => `分區 ${id}`,
  area: (key) => `區域 ${key}`,
  mapTarget: (target) => `地圖 ${target}`,
  editHref: (kind, id) => `/edit/${kind}/${id}`,
}

const raw: AdminRaw = {
  comments: { 'longdong:aaa': { c1: { uid: 'u1', text: '岩質很好', createdAt: 300 }, c2: { uid: 'u2', text: '小心落石', createdAt: 100, hidden: true } } },
  ratings: { 'longdong:aaa': { u1: { stars: 4, feel: 'hard', updatedAt: '1970-01-01T00:00:00.200Z' }, u2: { stars: 5, updatedAt: 'not a date' } } },
  topos: { p1: { uid: 'u2', sector: 'longdong/s1', image: 'topos/u2/p1.webp', width: 800, height: 600, createdAt: 50 } },
  topoEdits: { p1: { e1: { uid: 'u1', createdAt: 400, routes: { a: {}, b: {} } } } },
  mapEdits: { 'area:golden-valley': { m1: { uid: 'u1', createdAt: 500, rings: 'x|y|z' } }, trails: { m2: { uid: 'u2', createdAt: 150, lines: 'l1|l2' } } },
  textEdits: { 'route:longdong:aaa': { t1: { uid: 'u2', createdAt: 250, text: '  ' } }, 'area:golden-valley': { t2: { uid: 'u1', createdAt: 260, text: '停車方便' } } },
  walls: { u1: { w1: { sector: 'longdong/s1', createdAt: 10 } } },
  reports: { r1: { path: 'v2/comments/longdong:aaa/c2', uid: 'u1', reason: '廣告', createdAt: 600 }, r2: { path: 'v2/comments/longdong:aaa/gone', uid: 'u2', createdAt: 700 }, r3: { path: 'v2/comments/longdong:aaa/c2', uid: 'u2', createdAt: 650 } },
}
const feed = buildFeed(raw, ctx)
const only = (...types: FeedType[]) => new Set(types)
const keys = (items: FeedItem[]) => items.map((i) => i.key)

describe('buildFeed（把各處的輸入攤平）', () => {
  it('新到舊；每種輸入各一筆；日期不合法的評分略過', () => {
    expect(keys(feed)).toEqual([
      'mapEdit:area:golden-valley:m1',
      'topoEdit:p1:e1',
      'comment:longdong:aaa:c1',
      'textEdit:area:golden-valley:t2',
      'textEdit:route:longdong:aaa:t1',
      'rating:longdong:aaa:u1',
      'mapEdit:trails:m2',
      'comment:longdong:aaa:c2',
      'topo:p1',
      'wall:u1:w1',
    ])
  })

  it('刪除路徑：規則允許管理員刪的才有（評分、Topo 照片沒有）', () => {
    const paths = Object.fromEntries(feed.map((i) => [i.type, i.deletePaths]))
    expect(paths.comment).toEqual(['v2/comments/longdong:aaa/c2'])
    expect(paths.rating).toEqual([])
    expect(paths.topo).toEqual([])
    expect(feed.find((i) => i.key === 'topoEdit:p1:e1')!.deletePaths).toEqual(['v2/topoEdits/p1/e1'])
    expect(feed.find((i) => i.key === 'mapEdit:trails:m2')!.deletePaths).toEqual(['v2/mapEdits/trails/m2'])
    expect(feed.find((i) => i.key === 'wall:u1:w1')!.deletePaths).toEqual(['v2/walls/u1/w1'])
  })

  it('摘要與對象：說明的對象依種類換名稱、改回原文（空白）有說明、線段與範圍用不同文字', () => {
    const byKey = Object.fromEntries(feed.map((i) => [i.key, i]))
    expect(byKey['textEdit:route:longdong:aaa:t1']).toMatchObject({ target: '路線 longdong:aaa', summary: 'admin.feed.textReverted' })
    expect(byKey['textEdit:area:golden-valley:t2']).toMatchObject({ target: '區域 golden-valley', summary: '停車方便' })
    expect(byKey['mapEdit:trails:m2'].summary).toBe('admin.feed.mapLines:2')
    expect(byKey['mapEdit:area:golden-valley:m1'].summary).toBe('admin.feed.mapShapes:3')
    expect(byKey['comment:longdong:aaa:c2'].summary).toContain('admin.hidden')
    expect(byKey['rating:longdong:aaa:u1'].summary).toBe('★ 4 · feel.hard')
  })
})

describe('filterFeed', () => {
  const all = { types: only(), query: '' }
  it('類型：空集合是全部；多選取聯集', () => {
    expect(filterFeed(feed, all)).toHaveLength(feed.length)
    expect(keys(filterFeed(feed, { ...all, types: only('wall', 'topo') }))).toEqual(['topo:p1', 'wall:u1:w1'])
  })
  it('使用者：只留這個人的', () => {
    expect(new Set(filterFeed(feed, { ...all, uid: 'u2' }).map((i) => i.uid))).toEqual(new Set(['u2']))
  })
  it('搜尋：名稱、對象、內容都找得到；每個字都要符合（不分大小寫）', () => {
    expect(keys(filterFeed(feed, { ...all, query: 'jin 落石' }))).toEqual(['comment:longdong:aaa:c2'])
    expect(keys(filterFeed(feed, { ...all, query: '停車' }))).toEqual(['textEdit:area:golden-valley:t2'])
    expect(keys(filterFeed(feed, { ...all, query: 'GOLDEN-VALLEY kk' }))).toEqual(['mapEdit:area:golden-valley:m1', 'textEdit:area:golden-valley:t2'])
    expect(filterFeed(feed, { ...all, query: '不存在的字' })).toEqual([])
  })
  it('時間：含起不含迄', () => {
    expect(keys(filterFeed(feed, { ...all, from: 250, to: 400 }))).toEqual(['comment:longdong:aaa:c1', 'textEdit:area:golden-valley:t2', 'textEdit:route:longdong:aaa:t1'])
  })
})

describe('使用者目錄', () => {
  it('每類輸入數與最近一次；只有暱稱沒輸入的人也列（最後）；最近有動作的在前', () => {
    const users = summarizeUsers(feed, { u1: { name: 'KK' }, u2: { name: 'Jin' }, u3: { name: 'Lurker' } })
    expect(users.map((u) => u.uid)).toEqual(['u1', 'u2', 'u3'])
    expect(users[0]).toMatchObject({ total: 6, last: 500 })
    expect(users[0].counts).toMatchObject({ comment: 1, rating: 1, topoEdit: 1, mapEdit: 1, textEdit: 1, wall: 1, topo: 0 })
    expect(users[2]).toMatchObject({ total: 0, last: 0 })
    expect(countByType(feed).comment).toBe(2)
  })
})

describe('isAdminDeletable（管理員能刪的路徑，與資料庫規則一致）', () => {
  it('留言、檢舉、各種修改版本、岩壁可以；評分、暱稱、整個節點、Topo 照片不行', () => {
    for (const ok of ['v2/comments/longdong:a/c1', 'v2/reports/r1', 'v2/topoEdits/p1/e1', 'v2/mapEdits/trails/m1', 'v2/textEdits/area:x/t1', 'v2/walls/u1/w1']) expect(isAdminDeletable(ok), ok).toBe(true)
    for (const no of ['v2/ratings/longdong:a/u1', 'v2/profiles/u1', 'v2/comments', 'v2/comments/longdong:a', 'v2/topos/p1', 'v2/topoEdits/p1', 'v2/reports/r1/x', 'v2', '', 'v2/comments/a/b/c']) expect(isAdminDeletable(no), no).toBe(false)
  })
})

describe('分類：內容與修改互不重疊、合起來是全部', () => {
  it('每個類型恰好屬於一個群組', () => {
    const all = Object.values(FEED_GROUPS).flat()
    expect([...all].sort()).toEqual([...FEED_TYPES].sort())
  })
  it('effectiveTypes：群組內的類型；另外勾選時取交集，勾到群組外的不算', () => {
    expect([...effectiveTypes('content', new Set())].sort()).toEqual(['comment', 'rating'])
    expect([...effectiveTypes('content', new Set(['rating']))]).toEqual(['rating'])
    expect([...effectiveTypes('content', new Set(['wall']))].sort()).toEqual(['comment', 'rating'])
    expect(effectiveTypes(undefined, new Set()).size).toBe(0)
    expect([...effectiveTypes(undefined, new Set(['wall', 'topo']))].sort()).toEqual(['topo', 'wall'])
  })
})

describe('待處理（檢舉）', () => {
  const pending = buildPending(raw, feed, ctx.who)
  it('新到舊；對得到留言的附上留言，留言已刪除的沒有', () => {
    expect(pending.map((p) => p.id)).toEqual(['r2', 'r3', 'r1'])
    expect(pending[0].comment).toBeUndefined()
    expect(pending[2].comment?.key).toBe('comment:longdong:aaa:c2')
    expect(pending[2].who).toBe('KK')
  })
  it('被檢舉的留言記下被檢舉幾次', () => {
    expect(feed.find((i) => i.key === 'comment:longdong:aaa:c2')!.reportCount).toBe(2)
    expect(feed.find((i) => i.key === 'comment:longdong:aaa:c1')!.reportCount).toBeUndefined()
  })
})
