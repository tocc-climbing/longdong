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
import { NOTE_MAX } from '../../src/personal/model'
import { nameKey, routeKey } from '../../src/social/model'

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
const ROUTE_ID = 'longdong/jar2yu'
const iso = () => new Date().toISOString()
const tick = (id: string) => ({ id, routeId: 'longdong/jar2yu', date: '2026-10-12', style: 'redpoint', createdAt: iso(), updatedAt: iso() })

let env: RulesTestEnvironment
let alice: Database
let mallory: Database
let admin: Database
let guest: Database
/** 名單上的信箱（src/admin.ts 的 ADMIN_EMAILS），不在 /role 裡 */
let emailAdmin: Database
/** 同一個信箱但沒有驗證過：不算管理員 */
let unverified: Database

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-longdong',
    database: { rules: readFileSync('firebase/database.rules.json', 'utf8') },
  })
  alice = env.authenticatedContext('alice').database()
  mallory = env.authenticatedContext('mallory').database()
  admin = env.authenticatedContext('admin').database()
  guest = env.unauthenticatedContext().database()
  emailAdmin = env.authenticatedContext('kant', { email: 'kant.kang@gmail.com', email_verified: true }).database()
  unverified = env.authenticatedContext('fake', { email: 'kant.kang@gmail.com', email_verified: false }).database()
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

describe('管理頁：名單上的信箱（ADMIN_EMAILS）也是管理員', () => {
  it('可以讀檢舉、地圖回報；沒驗證過的同一個信箱不行', async () => {
    await assertSucceeds(get(emailAdmin, 'v2/reports'))
    await assertSucceeds(get(emailAdmin, 'v2/calibration'))
    await assertSucceeds(get(emailAdmin, 'v2/anonReports'))
    await assertFails(get(unverified, 'v2/reports'))
  })

  it('可以刪除任何人的留言；一般使用者不能刪別人的，管理員也不能改內容', async () => {
    await assertFails(remove(mallory, `v2/comments/${ROUTE}/m1`))
    await assertFails(remove(unverified, `v2/comments/${ROUTE}/m1`))
    await assertFails(set(emailAdmin, `v2/comments/${ROUTE}/m1/text`, '改掉'))
    await assertSucceeds(remove(emailAdmin, `v2/comments/${ROUTE}/m1`))
  })

  it('可以刪除檢舉（處理完）；一般使用者與檢舉人不能', async () => {
    await assertFails(remove(mallory, 'v2/reports/rep1'))
    await assertFails(remove(alice, 'v2/reports/rep1'))
    await assertSucceeds(remove(admin, 'v2/reports/rep1'))
  })

  it('還是不能讀寫別人的私人資料、不能新增管理員', async () => {
    await assertFails(get(emailAdmin, 'v2/personal/alice'))
    await assertFails(set(emailAdmin, 'role/kant', 'admin'))
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

describe('路線清單的最佳攀登方式（v2/personal/<uid>/best）', () => {
  const best = (style: string, extra: object = {}) => ({ routeId: ROUTE_ID, style, createdAt: iso(), updatedAt: iso(), ...extra })

  it('本人可以寫，別人和訪客不能', async () => {
    await assertSucceeds(set(alice, `v2/personal/alice/best/${ROUTE}`, best('onsight')))
    await assertSucceeds(set(alice, `v2/personal/alice/best/${ROUTE}`, best('toprope', { deleted: true })))
    await assertFails(set(mallory, `v2/personal/alice/best/${ROUTE}`, best('onsight')))
    await assertFails(set(guest, `v2/personal/alice/best/${ROUTE}`, best('onsight')))
  })

  it('只接受 OS、FL、RP、TR，欄位要齊全', async () => {
    await assertFails(set(alice, `v2/personal/alice/best/${ROUTE}`, best('attempt')))
    await assertFails(set(alice, `v2/personal/alice/best/${ROUTE}`, { routeId: ROUTE_ID, style: 'onsight' }))
    await assertFails(set(alice, `v2/personal/alice/best/${ROUTE}`, best('onsight', { deleted: 'yes' })))
  })
})

describe('評分、留言的路線 key 必須是路線ID 的格式（每位訪客都會下載整個評分節點）', () => {
  const data = JSON.parse(readFileSync('public/data/longdong.json', 'utf8')) as { areas: { sectors: { routes: { id: string }[] }[] }[] }
  const routeIds = data.areas.flatMap((a) => a.sectors.flatMap((s) => s.routes.map((r) => r.id)))

  it('資料檔裡每一條路線都可以評分、留言', async () => {
    await assertSucceeds(update(mallory, Object.fromEntries(routeIds.map((id) => [`v2/ratings/${routeKey(id)}/mallory`, { stars: 3, updatedAt: iso() }]))))
    await assertSucceeds(
      update(mallory, Object.fromEntries(routeIds.map((id) => [`v2/comments/${routeKey(id)}/c1`, { uid: 'mallory', text: '+1', createdAt: serverTimestamp() }]))),
    )
  })

  it('不是路線ID 格式的 key 不能新增', async () => {
    for (const key of ['junk', 'longdong:jar2yu0', 'longdong:jar2y', 'longdong:JAR2YU', 'longdong:jar2y0', 'other:jar2yu', `longdong:${'x'.repeat(90)}`]) {
      await assertFails(set(mallory, `v2/ratings/${key}/mallory`, { stars: 5, updatedAt: iso() }))
      await assertFails(push(mallory, `v2/comments/${key}`, { uid: 'mallory', text: 'spam', createdAt: serverTimestamp() }))
    }
  })

  it('舊格式 key 底下已有的評分、留言仍可刪除（刪除帳號時一併刪）', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      ctx.database().ref('v2').update({ 'ratings/longdong:523/alice': { stars: 4, updatedAt: iso() }, 'comments/longdong:523/m2': { uid: 'alice', text: '舊', createdAt: 1 } }),
    )
    await assertSucceeds(update(alice, { 'v2/ratings/longdong:523/alice': null, 'v2/comments/longdong:523/m2': null }))
  })
})

describe('攀登紀錄的備註（v2/personal/<uid>/ticks）', () => {
  it('上限與 App 的 NOTE_MAX 相同（中文字也以一個字計）', async () => {
    await assertSucceeds(set(alice, 'v2/personal/alice/ticks/t1', { ...tick('t1'), note: '龍'.repeat(NOTE_MAX) }))
    await assertFails(set(alice, 'v2/personal/alice/ticks/t1', { ...tick('t1'), note: 'x'.repeat(NOTE_MAX + 1) }))
  })

  it('刪除標記（沒有備註）可以寫入', async () => {
    await assertSucceeds(set(alice, 'v2/personal/alice/ticks/t1', { ...tick('t1'), deleted: true }))
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

describe('沒登入的回報（每台手機一個隨機裝置代號）', () => {
  const DEVICE = '0f8e2c1a-1234-4abc-8def-0123456789ab'
  const upload = (db: Database, device = DEVICE, geojson = '{"type":"FeatureCollection","features":[]}') =>
    push(db, `v2/anonReports/${device}`, { geojson, createdAt: serverTimestamp() })

  it('訪客和登入者都可以上傳；裝置代號必須是 UUID', async () => {
    await assertSucceeds(upload(guest))
    await assertSucceeds(upload(alice))
    await assertFails(upload(guest, 'not-a-uuid'))
  })

  it('格式：必須有 geojson 與伺服器時間，不能有其他欄位、不能是空字串或超過 200KB', async () => {
    await assertFails(push(guest, `v2/anonReports/${DEVICE}`, { geojson: '{}', createdAt: 1 }))
    await assertFails(push(guest, `v2/anonReports/${DEVICE}`, { geojson: '{}', createdAt: serverTimestamp(), name: 'x' }))
    await assertFails(upload(guest, DEVICE, ''))
    await assertFails(upload(guest, DEVICE, 'x'.repeat(200_001)))
  })

  it('上傳後不能修改或刪除，也不能整個刪掉', async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.database().ref(`v2/anonReports/${DEVICE}/u1`).set({ geojson: '{}', createdAt: 1 }))
    await assertFails(set(guest, `v2/anonReports/${DEVICE}/u1`, { geojson: '{"changed":1}', createdAt: serverTimestamp() }))
    await assertFails(remove(guest, `v2/anonReports/${DEVICE}/u1`))
    await assertFails(remove(mallory, `v2/anonReports/${DEVICE}`))
    await assertFails(remove(guest, 'v2/anonReports'))
  })

  it('只有管理員讀得到', async () => {
    await assertSucceeds(get(admin, 'v2/anonReports'))
    await assertFails(get(guest, 'v2/anonReports'))
    await assertFails(get(guest, `v2/anonReports/${DEVICE}`))
    await assertFails(get(mallory, 'v2/anonReports'))
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

  it('刪除個人資料時必須同時釋放暱稱，不能用刪除再改名的方式佔用多個暱稱', async () => {
    await assertSucceeds(claim(mallory, 'mallory', 'Bob'))
    await assertFails(remove(mallory, 'v2/profiles/mallory'))
    await assertSucceeds(update(mallory, { 'v2/profiles/mallory': null, 'v2/names/bob': null }))
    // 舊帳號（沒有登記 names）、沒有個人資料的帳號：刪除帳號照常
    const carol = env.authenticatedContext('carol').database()
    await assertSucceeds(remove(carol, 'v2/profiles/carol'))
    await assertSucceeds(update(mallory, { 'v2/profiles/mallory': null, 'v2/personal/mallory': null }))
  })

  it('舊帳號（沒有登記 names）改暱稱：登記新的即可', async () => {
    const carol = env.authenticatedContext('carol').database()
    await assertSucceeds(claim(carol, 'carol', 'Caroline'))
  })

  it('App 與資料庫規則算出的 key 相同（含資料庫 key 不能用的字元）', async () => {
    await assertSucceeds(claim(mallory, 'mallory', 'a.b$c#d[e]f/g%h'))
  })
})

