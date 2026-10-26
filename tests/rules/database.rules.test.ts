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


describe('Topo（v2/topos、v2/topoEdits）', () => {
  const SECTOR = 'longdong/music-hall-vab61c'
  /** App 寫入的照片（src/personal/firebase.ts 的 createTopo） */
  const photo = (uid: string, id: string, ext = 'webp') => ({ uid, sector: SECTOR, image: `topos/${uid}/${id}.${ext}`, width: 2560, height: 1707, createdAt: serverTimestamp() })
  /** App 寫入的版本（addTopoEdit，routes 由 src/topo/model.ts 的 encodeMarks 產生） */
  const edit = (uid: string, routes: Record<string, unknown> = { [ROUTE]: { line: '5000,9500 4800,5000 5000,0', bolts: { B01: '5000,8000', A01: '5000,100' } } }) => ({
    uid,
    createdAt: serverTimestamp(),
    routes,
  })

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref('v2').update({
        topos: { p1: { uid: 'alice', sector: SECTOR, image: 'topos/alice/p1.webp', width: 100, height: 100, createdAt: 1 } },
        topoEdits: { p1: { e1: { uid: 'alice', createdAt: 1, routes: { [ROUTE]: { line: '1,1 2,2' } } }, e2: { uid: 'mallory', createdAt: 2, routes: { [ROUTE]: { line: '1,1 3,3' } } } } },
      })
    })
  })

  it('訪客可以讀照片與所有版本', async () => {
    await assertSucceeds(get(guest, 'v2/topos'))
    await assertSucceeds(get(guest, 'v2/topoEdits'))
  })

  it('照片：登入者可以新增自己的（WebP 或 JPEG）；不能替別人新增，訪客不能新增', async () => {
    await assertSucceeds(set(mallory, 'v2/topos/p2', photo('mallory', 'p2')))
    await assertSucceeds(set(mallory, 'v2/topos/p3', photo('mallory', 'p3', 'jpg')))
    await assertFails(set(mallory, 'v2/topos/p4', photo('alice', 'p4')))
    await assertFails(set(guest, 'v2/topos/p5', photo('alice', 'p5')))
  })

  it('照片：檔案路徑必須是自己的資料夾＋照片 id，分區要是分區 ID，尺寸有上限，不能有其他欄位', async () => {
    await assertFails(set(mallory, 'v2/topos/p2', { ...photo('mallory', 'p2'), image: 'topos/alice/p2.webp' }))
    await assertFails(set(mallory, 'v2/topos/p2', { ...photo('mallory', 'p2'), image: 'topos/mallory/other.webp' }))
    await assertFails(set(mallory, 'v2/topos/p2', { ...photo('mallory', 'p2'), image: 'topos/mallory/p2.png' }))
    await assertFails(set(mallory, 'v2/topos/p2', { ...photo('mallory', 'p2'), sector: 'x' }))
    await assertFails(set(mallory, 'v2/topos/p2', { ...photo('mallory', 'p2'), width: 9000 }))
    await assertFails(set(mallory, 'v2/topos/p2', { ...photo('mallory', 'p2'), createdAt: 1 }))
    await assertFails(set(mallory, 'v2/topos/p2', { ...photo('mallory', 'p2'), note: 'x' }))
  })

  it('照片：不能修改（原圖不動）；本人與管理員可以連同所有版本一起刪除，別人不能', async () => {
    await assertFails(set(alice, 'v2/topos/p1/width', 200))
    await assertFails(update(mallory, { 'v2/topos/p1': null, 'v2/topoEdits/p1': null }))
    await assertSucceeds(update(alice, { 'v2/topos/p1': null, 'v2/topoEdits/p1': null }))
  })

  it('照片：管理員（/role 與名單上的信箱）可以刪除別人的', async () => {
    await assertSucceeds(update(admin, { 'v2/topos/p1': null, 'v2/topoEdits/p1': null }))
  })

  it('照片：名單上的信箱可以刪除別人的；沒驗證過的同一個信箱不行', async () => {
    await assertFails(update(unverified, { 'v2/topos/p1': null, 'v2/topoEdits/p1': null }))
    await assertSucceeds(update(emailAdmin, { 'v2/topos/p1': null, 'v2/topoEdits/p1': null }))
  })

  it('版本：任何登入者都可以在別人的照片上提交；訪客不能，不能冒用別人的 uid，照片不存在時不能提交', async () => {
    await assertSucceeds(push(mallory, 'v2/topoEdits/p1', edit('mallory')))
    await assertFails(push(guest, 'v2/topoEdits/p1', edit('alice')))
    await assertFails(push(mallory, 'v2/topoEdits/p1', edit('alice')))
    await assertFails(push(mallory, 'v2/topoEdits/nope', edit('mallory')))
  })

  it('版本：路線 key 要是路線ID，線段至少兩點，bolt 位置是 B／A 加兩位數，要有伺服器時間，不能有其他欄位', async () => {
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', { 'longdong:x': { line: '1,1 2,2' } })))
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', { [ROUTE]: { line: '1,1' } })))
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', { [ROUTE]: { line: '1,1 2,x' } })))
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', { [ROUTE]: { line: Array(201).fill('9999,9999').join(' ') } })))
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', { [ROUTE]: { bolts: { X1: '1,1' } } })))
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', { [ROUTE]: { bolts: { B01: '1;1' } } })))
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', { [ROUTE]: { note: 'x' } })))
    await assertFails(push(alice, 'v2/topoEdits/p1', edit('alice', {})))
    await assertFails(push(alice, 'v2/topoEdits/p1', { ...edit('alice'), createdAt: 1 }))
    await assertFails(push(alice, 'v2/topoEdits/p1', { ...edit('alice'), note: 'x' }))
  })

  it('版本：裁切是整數的 x、y、w、h，在照片範圍內，寬高不小於 500', async () => {
    const crop = (c: Record<string, unknown>) => ({ ...edit('alice'), crop: c })
    await assertSucceeds(push(alice, 'v2/topoEdits/p1', crop({ x: 2000, y: 1000, w: 4000, h: 6000 })))
    await assertSucceeds(push(alice, 'v2/topoEdits/p1', crop({ x: 0, y: 0, w: 10000, h: 10000 })))
    await assertSucceeds(push(alice, 'v2/topoEdits/p1', crop({ x: 9500, y: 9500, w: 500, h: 500 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: 2000, y: 1000, w: 4000 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: 2000, y: 1000, w: 4000, h: 6000, z: 1 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: 6001, y: 0, w: 4000, h: 5000 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: 0, y: 5001, w: 4000, h: 5000 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: -1, y: 0, w: 4000, h: 5000 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: 0, y: 0, w: 499, h: 5000 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: 0, y: 0, w: 5000, h: 499 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: 0.5, y: 0, w: 5000, h: 5000 })))
    await assertFails(push(alice, 'v2/topoEdits/p1', crop({ x: '0', y: 0, w: 5000, h: 5000 })))
  })

  it('版本：不能修改；本人與管理員可以刪除，別人不能（照片的主人也不能只刪別人的一個版本）', async () => {
    await assertFails(set(mallory, 'v2/topoEdits/p1/e2/routes', { [ROUTE]: { line: '1,1 9,9' } }))
    await assertFails(remove(mallory, 'v2/topoEdits/p1/e1'))
    await assertFails(remove(alice, 'v2/topoEdits/p1/e2'))
    await assertSucceeds(remove(mallory, 'v2/topoEdits/p1/e2'))
    await assertSucceeds(remove(admin, 'v2/topoEdits/p1/e1'))
  })

  it('不能整個刪掉別人照片的所有版本', async () => {
    await assertFails(remove(mallory, 'v2/topoEdits/p1'))
    await assertFails(remove(mallory, 'v2/topoEdits'))
  })

  it('刪除帳號：一次刪除自己的照片（連同別人的版本）與自己在別人照片上的版本', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref('v2').update({
        'topos/p9': { uid: 'mallory', sector: SECTOR, image: 'topos/mallory/p9.webp', width: 100, height: 100, createdAt: 1 },
        'topoEdits/p9/e9': { uid: 'alice', createdAt: 1, routes: { [ROUTE]: { line: '1,1 2,2' } } },
      })
    })
    await assertSucceeds(update(alice, { 'v2/topos/p1': null, 'v2/topoEdits/p1': null, 'v2/topoEdits/p9/e9': null }))
  })
})

describe('岩壁標記（v2/walls）', () => {
  const SECTOR = 'longdong/school-gate-a1151r'
  /** App 寫入的岩壁（src/personal/firebase.ts 的 addWall，line 由 src/map/walls.ts 的 encodeLine 產生） */
  const wall = (line = '25.112720,121.921450 25.112710,121.921600') => ({ sector: SECTOR, line, createdAt: serverTimestamp() })

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref('v2/walls').update({ alice: { w1: { sector: SECTOR, line: '25.112720,121.921450 25.112710,121.921600', createdAt: 1 } } })
    })
  })

  it('登入者可以讀所有人的岩壁；訪客不能讀', async () => {
    await assertSucceeds(get(mallory, 'v2/walls'))
    await assertFails(get(guest, 'v2/walls'))
  })

  it('登入者可以在自己的資料夾新增；不能替別人新增，訪客不能新增', async () => {
    await assertSucceeds(push(mallory, 'v2/walls/mallory', wall()))
    await assertFails(push(mallory, 'v2/walls/alice', wall()))
    await assertFails(push(guest, 'v2/walls/alice', wall()))
  })

  it('分區要是分區 ID，線段至少兩點、在龍洞一帶、小數 6 位，要有伺服器時間，不能有其他欄位', async () => {
    await assertFails(push(alice, 'v2/walls/alice', { ...wall(), sector: 'x' }))
    await assertFails(push(alice, 'v2/walls/alice', wall('25.112720,121.921450')))
    await assertFails(push(alice, 'v2/walls/alice', wall('35.112720,121.921450 25.112710,121.921600')))
    await assertFails(push(alice, 'v2/walls/alice', wall('25.11272,121.92145 25.11271,121.92160')))
    await assertFails(push(alice, 'v2/walls/alice', wall(Array(106).fill('25.112720,121.921450').join(' '))))
    await assertFails(push(alice, 'v2/walls/alice', { ...wall(), createdAt: 1 }))
    await assertFails(push(alice, 'v2/walls/alice', { ...wall(), note: 'x' }))
    await assertSucceeds(push(alice, 'v2/walls/alice', wall(Array(100).fill('25.112720,121.921450').join(' '))))
  })

  it('不能修改；本人與管理員可以刪除，別人不能', async () => {
    await assertFails(set(alice, 'v2/walls/alice/w1/sector', 'longdong/clocktower-tvxllu'))
    await assertFails(remove(mallory, 'v2/walls/alice/w1'))
    await assertSucceeds(remove(alice, 'v2/walls/alice/w1'))
  })

  it('管理員（/role 與名單上的信箱）可以刪除別人的', async () => {
    await assertSucceeds(remove(admin, 'v2/walls/alice/w1'))
  })

  it('刪除帳號：本人可以整個資料夾一起刪；別人不能', async () => {
    await assertFails(remove(mallory, 'v2/walls/alice'))
    await assertFails(remove(mallory, 'v2/walls'))
    await assertSucceeds(remove(alice, 'v2/walls/alice'))
  })
})

describe('地圖編輯（v2/mapEdits，版本同 Topo）', () => {
  const RING = '25.112720,121.921450 25.112710,121.921600 25.112600,121.921500'
  const LINE = '25.112720,121.921450 25.112710,121.921600'
  const SECTOR = 'sector:longdong:school-gate-a1151r'
  const rings = (uid: string, value = RING) => ({ uid, rings: value, createdAt: serverTimestamp() })
  const lines = (uid: string, value = LINE) => ({ uid, lines: value, createdAt: serverTimestamp() })

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref('v2/mapEdits').update({ 'area:school-gate': { v1: { uid: 'alice', rings: RING, createdAt: 1 }, v2: { uid: 'mallory', rings: RING, createdAt: 2 } } })
    })
  })

  it('所有人（含訪客）都讀得到所有版本', async () => {
    await assertSucceeds(get(guest, 'v2/mapEdits'))
  })

  it('任何登入者都可以提交新版本；訪客不能，不能冒用別人的 uid', async () => {
    await assertSucceeds(push(mallory, 'v2/mapEdits/area:clocktower', rings('mallory')))
    await assertSucceeds(push(mallory, `v2/mapEdits/${SECTOR}`, rings('mallory', `${RING}|${RING}`)))
    await assertSucceeds(push(mallory, 'v2/mapEdits/trails', lines('mallory', `${LINE}|${LINE}`)))
    await assertSucceeds(push(mallory, 'v2/mapEdits/highway', lines('mallory')))
    await assertSucceeds(push(mallory, 'v2/mapEdits/tunnel', lines('mallory')))
    await assertSucceeds(push(mallory, 'v2/mapEdits/road', lines('mallory')))
    await assertFails(push(guest, 'v2/mapEdits/area:clocktower', rings('alice')))
    await assertFails(push(mallory, 'v2/mapEdits/area:clocktower', rings('alice')))
  })

  it('對象只能是 9 個大區域、分區 ID、步道與道路；多邊形至少三點、線段至少兩點；步道與道路用 lines、其他用 rings', async () => {
    await assertFails(push(alice, 'v2/mapEdits/area:somewhere', rings('alice')))
    await assertFails(push(alice, 'v2/mapEdits/sector:x', rings('alice')))
    await assertFails(push(alice, 'v2/mapEdits/area:clocktower', rings('alice', LINE)))
    await assertFails(push(alice, 'v2/mapEdits/area:clocktower', rings('alice', '')))
    await assertSucceeds(push(alice, `v2/mapEdits/${SECTOR}`, rings('alice', '')))
    await assertFails(push(alice, 'v2/mapEdits/trails', lines('alice', '25.112720,121.921450')))
    await assertFails(push(alice, 'v2/mapEdits/trails', rings('alice')))
    await assertFails(push(alice, 'v2/mapEdits/road', rings('alice')))
    await assertFails(push(alice, 'v2/mapEdits/railway', lines('alice')))
    await assertFails(push(alice, 'v2/mapEdits/area:clocktower', lines('alice')))
    await assertFails(push(alice, 'v2/mapEdits/area:clocktower', { ...rings('alice'), createdAt: 1 }))
    await assertFails(push(alice, 'v2/mapEdits/area:clocktower', { ...rings('alice'), note: 'x' }))
  })

  it('版本不能修改；本人與管理員可以刪除，別人不能', async () => {
    await assertFails(set(alice, 'v2/mapEdits/area:school-gate/v1/rings', RING))
    await assertFails(remove(mallory, 'v2/mapEdits/area:school-gate/v1'))
    await assertSucceeds(remove(alice, 'v2/mapEdits/area:school-gate/v1'))
    await assertSucceeds(remove(admin, 'v2/mapEdits/area:school-gate/v2'))
  })

  it('整個對象的所有版本只有管理員可以一次刪除', async () => {
    await assertFails(remove(alice, 'v2/mapEdits/area:school-gate'))
    await assertSucceeds(remove(emailAdmin, 'v2/mapEdits/area:school-gate'))
  })

  it('刪除帳號：一次刪除自己在各對象的版本', async () => {
    await assertSucceeds(update(alice, { 'v2/mapEdits/area:school-gate/v1': null }))
  })
})

describe('說明修改（v2/textEdits，版本同 Topo）', () => {
  const text = (uid: string, value = '從校門口小徑下切，沿岩壁往左') => ({ uid, text: value, createdAt: serverTimestamp() })

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref('v2/textEdits').update({ [`route:${ROUTE}`]: { t1: { uid: 'alice', text: 'x', createdAt: 1 } } })
    })
  })

  it('所有人（含訪客）都讀得到', async () => {
    await assertSucceeds(get(guest, 'v2/textEdits'))
  })

  it('任何登入者都可以替大區域、路線提交新版本；訪客不能，不能冒用別人的 uid', async () => {
    await assertSucceeds(push(mallory, 'v2/textEdits/area:school-gate', text('mallory')))
    await assertSucceeds(push(mallory, `v2/textEdits/route:${ROUTE}`, text('mallory')))
    await assertSucceeds(push(mallory, `v2/textEdits/route:${ROUTE}`, text('mallory', '')))
    await assertFails(push(guest, 'v2/textEdits/area:school-gate', text('alice')))
    await assertFails(push(mallory, 'v2/textEdits/area:school-gate', text('alice')))
  })

  it('對象只能是 9 個大區域與路線 ID；最多 3000 字；要有伺服器時間，不能有其他欄位', async () => {
    await assertFails(push(alice, 'v2/textEdits/area:somewhere', text('alice')))
    await assertFails(push(alice, 'v2/textEdits/route:longdong:x', text('alice')))
    await assertFails(push(alice, 'v2/textEdits/area:school-gate', text('alice', 'x'.repeat(3001))))
    await assertFails(push(alice, 'v2/textEdits/area:school-gate', { ...text('alice'), createdAt: 1 }))
    await assertFails(push(alice, 'v2/textEdits/area:school-gate', { ...text('alice'), grade: '5.10a' }))
  })

  it('版本不能修改；本人與管理員可以刪除，別人不能；整個對象只有管理員能刪', async () => {
    await assertFails(set(alice, `v2/textEdits/route:${ROUTE}/t1/text`, 'y'))
    await assertFails(remove(mallory, `v2/textEdits/route:${ROUTE}/t1`))
    await assertFails(remove(alice, `v2/textEdits/route:${ROUTE}`))
    await assertSucceeds(remove(alice, `v2/textEdits/route:${ROUTE}/t1`))
  })
})
