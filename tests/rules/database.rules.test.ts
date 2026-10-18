/**
 * Realtime Database 規則測試：在 Database 模擬器上跑 firebase/database.rules.json。
 *
 *   npm run test:rules   （需要 Java；會自動啟動模擬器，專案為不連線的 demo-longdong）
 *
 * 角色：alice、mallory 是一般登入者（任何 Google 帳號都能登入），admin 在 /role 裡（管理員），
 * guest 沒有登入。寫入的資料形狀與 App 實際送出的一致（src/personal/firebase.ts、src/social/actions.ts）。
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { nameKey } from '../../src/social/model'

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
      topos: { p1: { name: 'topo' } },
      v2: {
        personal: { alice: { ticks: { t1: tick('t1') } } },
        // carol 是暱稱不重複之前建立的，沒有登記在 names
        profiles: { alice: { name: 'Alice', updatedAt: iso() }, carol: { name: 'Carol', updatedAt: iso() } },
        names: { alice: 'alice' },
        ratings: { [ROUTE]: { alice: { stars: 4, updatedAt: iso() } } },
        comments: { [ROUTE]: { m1: { uid: 'alice', text: '好爬', createdAt: 1 } } },
        reports: { rep1: { path: `v2/comments/${ROUTE}/m1`, uid: 'mallory', createdAt: 1 } },
      },
    })
  })
})

describe('舊站節點', () => {
  it('topos（路線圖，之後做進 App）：公開可讀，不能刪除或新增', async () => {
    await assertSucceeds(get(guest, 'topos'))
    await assertFails(remove(mallory, 'topos'))
    await assertFails(set(mallory, 'topos/new', { x: 1 }))
  })

  it('role：公開可讀', async () => {
    await assertSucceeds(get(guest, 'role'))
  })

  it('已刪除的舊站節點（2026-10-18 備份後刪除）：任何人都不能讀寫', async () => {
    for (const node of ['routes', 'comments', 'tags', 'tests', 'tasks']) {
      await assertFails(get(guest, node))
      await assertFails(set(admin, `${node}/new`, { x: 1 }))
    }
    await assertFails(get(alice, 'users/alice'))
    await assertFails(set(alice, 'users/alice', { name: 'Alice' }))
    await assertFails(set(alice, 'devices/alice/d1', true))
  })
})

describe('管理員（/role）不能讀寫別人的私人資料', () => {
  it('不能讀 v2/personal', async () => {
    await assertFails(get(admin, 'v2/personal/alice'))
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
    await assertFails(set(admin, 'topos/p1', null))
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
    const profile = (updatedAt: string) => update(mallory, { 'v2/names/m': 'mallory', 'v2/profiles/mallory': { name: 'M', updatedAt } })
    await assertFails(profile(huge))
    await assertFails(profile('2026-10-12'))
    await assertSucceeds(profile(iso()))
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

  it('刪除帳號：一次刪除自己的紀錄、暱稱、評分、留言、校正記錄', async () => {
    await assertSucceeds(
      update(alice, {
        'v2/personal/alice': null,
        'v2/profiles/alice': null,
        'v2/calibration/alice': null,
        'v2/names/alice': null,
        [`v2/ratings/${ROUTE}/alice`]: null,
        [`v2/comments/${ROUTE}/m1`]: null,
      }),
    )
  })
})

describe('比例尺地圖的現場校正記錄', () => {
  const upload = (db: Database, uid: string, geojson = '{"type":"FeatureCollection","features":[]}') =>
    push(db, `v2/calibration/${uid}`, { geojson, createdAt: serverTimestamp() })

  it('登入者可以上傳到自己的路徑；不能上傳到別人的，訪客不能上傳', async () => {
    await assertSucceeds(upload(alice, 'alice'))
    await assertFails(upload(mallory, 'alice'))
    await assertFails(upload(guest, 'alice'))
  })

  it('格式：必須有 geojson 與伺服器時間，不能有其他欄位、不能是空字串或超過 1MB', async () => {
    await assertFails(push(alice, 'v2/calibration/alice', { geojson: '{}', createdAt: 1 }))
    await assertFails(push(alice, 'v2/calibration/alice', { geojson: '{}', createdAt: serverTimestamp(), name: 'x' }))
    await assertFails(upload(alice, 'alice', ''))
    await assertFails(upload(alice, 'alice', 'x'.repeat(1_000_001)))
  })

  it('上傳後不能修改；本人可以刪除', async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.database().ref('v2/calibration/alice/u1').set({ geojson: '{}', createdAt: 1 }))
    await assertFails(set(alice, 'v2/calibration/alice/u1', { geojson: '{"changed":1}', createdAt: serverTimestamp() }))
    await assertSucceeds(remove(alice, 'v2/calibration/alice/u1'))
  })

  it('只有本人與管理員讀得到', async () => {
    await assertSucceeds(get(alice, 'v2/calibration/alice'))
    await assertSucceeds(get(admin, 'v2/calibration'))
    await assertFails(get(mallory, 'v2/calibration/alice'))
    await assertFails(get(mallory, 'v2/calibration'))
    await assertFails(get(guest, 'v2/calibration/alice'))
  })

  it('不能整個刪掉別人的校正記錄', async () => {
    await assertFails(remove(mallory, 'v2/calibration/alice'))
  })
})

describe('暱稱不能重複（不分大小寫、看起來一樣的寫法視為相同）', () => {
  /** App 的寫法：同時登記 names 與更新 profile；release 為要釋放的舊暱稱 */
  const claim = (db: Database, uid: string, name: string, release?: string) =>
    update(db, {
      [`v2/names/${nameKey(name)}`]: uid,
      [`v2/profiles/${uid}`]: { name, updatedAt: iso() },
      ...(release ? { [`v2/names/${nameKey(release)}`]: null } : {}),
    })

  it('新暱稱可以登記；別人的暱稱不能用（大小寫不同也算重複）', async () => {
    await assertSucceeds(claim(mallory, 'mallory', 'Mallory'))
    await assertFails(claim(mallory, 'mallory', 'ALICE'))
  })

  it('個人資料的暱稱必須登記在 names；不能只佔用 names 而不使用', async () => {
    await assertFails(set(mallory, 'v2/profiles/mallory', { name: 'Mallory', updatedAt: iso() }))
    await assertFails(set(mallory, 'v2/names/somebody', 'mallory'))
  })

  it('不能存看起來一樣的寫法：頭尾空白、連續空白、零寬字元、全形英數字、全形空白', async () => {
    for (const name of ['Mallory ', ' Mallory', 'Mal  lory', 'Mal\u200blory', '\uff2dallory', 'Mal\u3000lory', 'Mal\u00a0lory']) {
      await assertFails(claim(mallory, 'mallory', name))
    }
  })

  it('改暱稱時必須釋放舊的；只改大小寫不用重新登記', async () => {
    await assertFails(claim(alice, 'alice', 'Alicia'))
    await assertSucceeds(claim(alice, 'alice', 'Alicia', 'Alice'))
    await assertSucceeds(update(alice, { 'v2/profiles/alice': { name: 'ALICIA', updatedAt: iso() } }))
  })

  it('不能刪除別人的登記；自己的可以', async () => {
    await assertFails(remove(mallory, 'v2/names/alice'))
    await assertSucceeds(update(alice, { 'v2/names/alice': null, 'v2/profiles/alice': null }))
  })

  it('舊帳號（沒有登記 names）改暱稱：登記新的即可', async () => {
    const carol = env.authenticatedContext('carol').database()
    await assertSucceeds(claim(carol, 'carol', 'Caroline'))
  })

  it('App 與資料庫規則算出的 key 相同（含資料庫 key 不能用的字元）', async () => {
    await assertSucceeds(claim(mallory, 'mallory', 'a.b$c#d[e]f/g%h'))
  })
})

