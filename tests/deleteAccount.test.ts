import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 刪除帳號各步驟的呼叫順序 */
const calls: string[] = []

/* ---------- deleteMyAccount：重新驗證必須在任何網路讀寫之前 ---------- */

vi.mock('../src/personal/sync', () => ({
  withCloud: async () => ({
    m: {
      reauthenticateIfStale: async () => {
        calls.push('reauth')
      },
    },
    uid: 'alice',
  }),
  deleteAccount: async () => {
    calls.push('deleteAccount')
  },
}))

vi.mock('../src/social/store', () => ({
  get: async (path: string) => {
    calls.push(`get ${path}`)
    return null
  },
  loadRatings: async () => {},
  loadComments: async () => {},
  setLocalProfile: () => {},
  setLocalRating: () => {},
}))

/* ---------- firebase.ts：登入時間超過門檻才跳出登入視窗 ---------- */

const user = { metadata: { lastSignInTime: '' as string | undefined }, providerData: [{ providerId: 'google.com' }] }

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase/database', () => ({
  getDatabase: () => ({}),
  connectDatabaseEmulator: () => {},
  ref: () => ({}),
  update: async () => {
    calls.push('update')
  },
}))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: user }),
  connectAuthEmulator: () => {},
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  FacebookAuthProvider: class {
    addScope() {}
  },
  reauthenticateWithPopup: async () => {
    calls.push('popup')
  },
  deleteUser: async () => {
    calls.push('deleteUser')
  },
}))

beforeEach(() => {
  calls.length = 0
})

describe('刪除帳號', () => {
  it('先重新驗證，才讀取雲端資料與刪除', async () => {
    const { deleteMyAccount } = await import('../src/social/actions')
    await deleteMyAccount()
    expect(calls[0]).toBe('reauth')
    expect(calls.at(-1)).toBe('deleteAccount')
  })

  it('4 分鐘內登入過不跳出登入視窗；超過或不知道登入時間就重新驗證', async () => {
    const fb = await import('../src/personal/firebase')
    user.metadata.lastSignInTime = new Date(Date.now() - 3 * 60 * 1000).toUTCString()
    await fb.reauthenticateIfStale()
    expect(calls).toEqual([])

    user.metadata.lastSignInTime = new Date(Date.now() - 5 * 60 * 1000).toUTCString()
    await fb.reauthenticateIfStale()
    expect(calls).toEqual(['popup'])

    user.metadata.lastSignInTime = undefined
    await fb.reauthenticateIfStale()
    expect(calls).toEqual(['popup', 'popup'])
  })
})
