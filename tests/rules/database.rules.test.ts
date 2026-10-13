/**
 * Realtime Database 規則測試：在 Database 模擬器上跑 firebase/database.rules.json。
 *
 *   npm run test:rules   （需要 Java；會自動啟動模擬器，專案為不連線的 demo-longdong）
 *
 * 角色：alice、mallory 是一般登入者（任何 Google 帳號都能登入），admin 在 /role 裡（舊站的管理員），
 * guest 沒有登入。寫入的資料形狀與 App 實際送出的一致（src/personal/firebase.ts、src/social/actions.ts）。
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

/** context.database() 是相容版（compat）的 Database */
type Database = ReturnType<RulesTestContext['database']>
/** 等同 App 用的 serverTimestamp() */
const serverTimestamp = () => ({ '.sv': 'timestamp' })
const get = (db: Database, path: string) => db.ref(path).once('value')
const set = (db: Database, path: string, value: unknown) => db.ref(path).set(value)
const update = (db: Database, value: Record<string, unknown>) => db.ref().update(value)
const remove = (db: Database, path: string) => db.ref(path).remove()
/** push() 回傳的 ThenableReference 不是標準 Promise */
const push = (db: Database, path: string, value: unknown) => Promise.resolve(db.ref(path).push(value))

const ROUTE = 'longdong:jar2yu'
const iso = () => new Date().toISOString()
const tick = (id: string) => ({ id, routeId: 'longdong/jar2yu', date: '2026-10-12', style: 'redpoint', createdAt: iso(), updatedAt: iso() })

let env: RulesTestEnvironment
let alice: Database
let mallory: Database
let admin: Database
let guest: Database

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-longdong',
    database: { rules: readFileSync('firebase/database.rules.json', 'utf8') },
  })
  alice = env.authenticatedContext('alice').database()
  mallory = env.authenticatedContext('mallory').database()
  admin = env.authenticatedContext('admin').database()
  guest = env.unauthenticatedContext().database()
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearDatabase()
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().set({
      role: { admin: true },
      comments: { c1: { text: '舊站留言' } },
      tags: { t1: 'crack' },
      topos: { p1: { name: 'topo' } },
      tests: { x1: { date: '2019-01-01' } },
      tasks: { k1: { title: 'task' } },
      routes: { r1: { name: '舊路線', bolts: { b1: { material: '316' } } } },
      users: { alice: { name: 'Alice' } },
      devices: { alice: { d1: true } },
      v2: {
        personal: { alice: { ticks: { t1: tick('t1') } } },
        profiles: { alice: { name: 'Alice', updatedAt: iso() } },
        ratings: { [ROUTE]: { alice: { stars: 4, updatedAt: iso() } } },
        comments: { [ROUTE]: { m1: { uid: 'alice', text: '好爬', createdAt: 1 } } },
        reports: { rep1: { path: `v2/comments/${ROUTE}/m1`, uid: 'mallory', createdAt: 1 } },
      },
    })
  })
})

describe('舊站節點：一般登入者不能刪除或覆寫', () => {
  for (const node of ['comments', 'tags', 'topos', 'tests', 'tasks']) {
    it(`${node}：不能整棵刪除、不能新增`, async () => {
      await assertFails(remove(mallory, node))
      await assertFails(set(mallory, `${node}/new`, { x: 1 }))
    })
  }

  it('routes/*/bolts：不能修改', async () => {
    await assertFails(set(mallory, 'routes/r1/bolts', null))
    await assertFails(set(mallory, 'routes/r1/bolts/b2', { material: 'x' }))
  })

  it('仍然公開可讀', async () => {
    for (const node of ['comments', 'tags', 'topos', 'tests', 'tasks', 'routes', 'role']) await assertSucceeds(get(guest, node))
  })
})

describe('管理員（/role）不能讀寫別人的私人資料', () => {
  it('不能讀 v2/personal、users、devices', async () => {
    await assertFails(get(admin, 'v2/personal/alice'))
    await assertFails(get(admin, 'users/alice'))
    await assertFails(get(admin, 'devices/alice'))
  })

  it('不能寫 v2/personal', async () => {
    await assertFails(set(admin, 'v2/personal/alice/ticks/t2', tick('t2')))
    await assertFails(remove(admin, 'v2/personal/alice'))
  })

  it('不能從網頁端新增管理員', async () => {
    await assertFails(set(admin, 'role/mallory', true))
    await assertFails(set(mallory, 'role/mallory', true))
  })

  it('不能從網頁端修改舊站節點（改由 Firebase 主控台操作）', async () => {
    await assertFails(set(admin, 'comments/c1', null))
  })

  it('可以讀檢舉；一般使用者與訪客不行', async () => {
    await assertSucceeds(get(admin, 'v2/reports'))
    await assertFails(get(mallory, 'v2/reports'))
    await assertFails(get(guest, 'v2/reports'))
  })
})

describe('公開欄位的 updatedAt 只接受 toISOString() 格式', () => {
  const huge = 'x'.repeat(100_000)

  it('暱稱：拒絕巨大字串與其他格式', async () => {
    await assertFails(set(mallory, 'v2/profiles/mallory', { name: 'M', updatedAt: huge }))
    await assertFails(set(mallory, 'v2/profiles/mallory', { name: 'M', updatedAt: '2026-10-12' }))
    await assertSucceeds(set(mallory, 'v2/profiles/mallory', { name: 'M', updatedAt: iso() }))
  })

  it('評分：拒絕巨大字串，接受 App 寫入的格式', async () => {
    await assertFails(set(mallory, `v2/ratings/${ROUTE}/mallory`, { stars: 5, updatedAt: huge }))
    await assertSucceeds(set(mallory, `v2/ratings/${ROUTE}/mallory`, { stars: 5, feel: 'hard', updatedAt: iso() }))
  })
})

describe('既有行為不變', () => {
  it('本人可以讀寫自己的紀錄；別人不能讀', async () => {
    await assertSucceeds(get(alice, 'v2/personal/alice'))
    await assertSucceeds(update(alice, { 'v2/personal/alice/ticks/t2': tick('t2') }))
    await assertFails(get(mallory, 'v2/personal/alice'))
    await assertFails(set(mallory, 'v2/personal/alice/ticks/t3', tick('t3')))
  })

  it('本人可以讀寫自己的舊站 users／devices', async () => {
    await assertSucceeds(get(alice, 'users/alice'))
    await assertSucceeds(set(alice, 'devices/alice/d2', true))
  })

  it('訪客可以讀評分、暱稱、留言', async () => {
    await assertSucceeds(get(guest, 'v2/ratings'))
    await assertSucceeds(get(guest, 'v2/profiles'))
    await assertSucceeds(get(guest, 'v2/comments'))
  })

  it('留言：可以新增；只能刪除自己的', async () => {
    await assertSucceeds(push(mallory, `v2/comments/${ROUTE}`, { uid: 'mallory', text: '+1', createdAt: serverTimestamp() }))
    await assertFails(remove(mallory, `v2/comments/${ROUTE}/m1`))
    await assertSucceeds(remove(alice, `v2/comments/${ROUTE}/m1`))
  })

  it('檢舉：登入者可以新增', async () => {
    await assertSucceeds(
      push(alice, 'v2/reports', { path: `v2/comments/${ROUTE}/m1`, uid: 'alice', reason: 'spam', createdAt: serverTimestamp() }),
    )
  })

  it('刪除帳號：一次刪除自己的紀錄、暱稱、評分、留言', async () => {
    await assertSucceeds(
      update(alice, {
        'v2/personal/alice': null,
        'v2/profiles/alice': null,
        [`v2/ratings/${ROUTE}/alice`]: null,
        [`v2/comments/${ROUTE}/m1`]: null,
      }),
    )
  })
})
