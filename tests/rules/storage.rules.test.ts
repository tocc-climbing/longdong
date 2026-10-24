/**
 * Cloud Storage 規則測試：在 Storage 模擬器上跑 firebase/storage.rules（npm run test:rules）。
 * 上傳的形狀與 App 一致（src/personal/firebase.ts 的 createTopo）。
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

type Storage = ReturnType<RulesTestContext['storage']>

let env: RulesTestEnvironment
let alice: Storage
let mallory: Storage
let guest: Storage
let emailAdmin: Storage
let unverified: Storage

const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46])
/** put() 回傳的 UploadTask 不是標準 Promise */
const upload = (s: Storage, path: string, contentType = 'image/webp', data: Uint8Array = webp) => Promise.resolve(s.ref(path).put(data, { contentType }))

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-longdong',
    storage: { rules: readFileSync('firebase/storage.rules', 'utf8') },
  })
  alice = env.authenticatedContext('alice').storage()
  mallory = env.authenticatedContext('mallory').storage()
  guest = env.unauthenticatedContext().storage()
  emailAdmin = env.authenticatedContext('kant', { email: 'kant.kang@gmail.com', email_verified: true }).storage()
  unverified = env.authenticatedContext('fake', { email: 'kant.kang@gmail.com', email_verified: false }).storage()
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearStorage()
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref('topos/alice/p1.webp').put(webp, { contentType: 'image/webp' })
  })
})

describe('Topo 照片（topos/<uid>/<照片>）', () => {
  it('訪客可以讀', async () => {
    await assertSucceeds(guest.ref('topos/alice/p1.webp').getMetadata())
  })

  it('登入者只能上傳到自己的資料夾；訪客不能上傳', async () => {
    await assertSucceeds(upload(mallory, 'topos/mallory/p2.webp'))
    await assertSucceeds(upload(mallory, 'topos/mallory/p3.jpg', 'image/jpeg'))
    await assertFails(upload(mallory, 'topos/alice/p2.webp'))
    await assertFails(upload(guest, 'topos/alice/p2.webp'))
  })

  it('只接受 WebP、JPEG，副檔名要相符，不超過 3MB', async () => {
    await assertFails(upload(mallory, 'topos/mallory/p2.webp', 'image/jpeg'))
    await assertFails(upload(mallory, 'topos/mallory/p2.png', 'image/png'))
    await assertFails(upload(mallory, 'topos/mallory/p2.webp', 'text/html'))
    await assertFails(upload(mallory, 'topos/mallory/p2.webp', 'image/webp', new Uint8Array(3 * 1024 * 1024 + 1)))
  })

  it('不能覆蓋已上傳的照片（原圖不動）', async () => {
    await assertFails(upload(alice, 'topos/alice/p1.webp'))
  })

  it('本人與名單上的信箱可以刪除；別人、沒驗證過的同一個信箱不行', async () => {
    await assertFails(mallory.ref('topos/alice/p1.webp').delete())
    await assertFails(unverified.ref('topos/alice/p1.webp').delete())
    await assertSucceeds(emailAdmin.ref('topos/alice/p1.webp').delete())
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.storage().ref('topos/alice/p1.webp').put(webp, { contentType: 'image/webp' })
    })
    await assertSucceeds(alice.ref('topos/alice/p1.webp').delete())
  })

  it('其他路徑一律拒絕', async () => {
    await assertFails(upload(alice, 'other/alice/p1.webp'))
    await assertFails(upload(alice, 'topos/p1.webp'))
    await assertFails(guest.ref('topo').getMetadata())
  })
})
