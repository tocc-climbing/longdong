/**
 * Firebase 登入與雲端同步。這個模組只在使用者登入（或曾經登入）時才以 dynamic import 載入，
 * 沒登入的人不需要下載 Firebase SDK，App 照樣離線可用。
 *
 * 使用舊站的 Firebase 專案（longdong），新資料放在 /v2/personal/<uid>，與舊站的路徑分開。
 */
import { initializeApp } from 'firebase/app'
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  connectAuthEmulator,
  deleteUser,
  getAuth,
  getRedirectResult,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type AuthCredential,
  type AuthProvider,
  type User,
} from 'firebase/auth'
import { connectDatabaseEmulator, get, getDatabase, onValue, push, ref, remove, serverTimestamp, set, update, type Unsubscribe } from 'firebase/database'
import { NAME_MAX, nameKey, normalizeName, routeKey, type Feel } from '../social/model'
import { STORAGE_BUCKET, type Crop, type StoredRoutes, type TopoPhoto } from '../topo/model'

const app = initializeApp({
  // 前端用的公開設定（不是密鑰）；存取權限由 Realtime Database 規則控管
  apiKey: 'AIzaSyC6UDLfbg6Ue3UQ2icFhhtKAEotoRux4Qc',
  // 登入在網站自己的網域完成（Firebase Hosting 的 /__/auth/handler）：iPhone、iPad 的 Safari 會擋跨網域的登入
  // （longdong.firebaseapp.com），造成第一次登入失敗或切換 App 後回不來。本機開發（localhost）照舊用 firebaseapp.com。
  // 新的網站網域要在 Google Cloud Console 的 OAuth 用戶端加上 https://<網域>/__/auth/handler
  authDomain: typeof location !== 'undefined' && location.hostname.endsWith('.web.app') ? location.hostname : 'longdong.firebaseapp.com',
  databaseURL: 'https://longdong.firebaseio.com',
  projectId: 'project-2803619783974357321',
  storageBucket: STORAGE_BUCKET,
})

const auth = getAuth(app)
const db = getDatabase(app)

// 端對端測試（npm run test:e2e，vite build --mode e2e）用 Firebase 模擬器
if (import.meta.env.MODE === 'e2e') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
}

export type { User }

export function watchUser(callback: (user: User | null) => void): Unsubscribe {
  // 從 redirect 登入回來時，讓錯誤能被看見（成功的話 onAuthStateChanged 會處理）
  getRedirectResult(auth).catch((err) => console.warn('redirect sign-in failed', err))
  return onAuthStateChanged(auth, callback)
}

export type ProviderName = 'google' | 'facebook'

export const PROVIDER_LABEL: Record<ProviderName, string> = { google: 'Google', facebook: 'Facebook' }

function makeProvider(name: ProviderName): AuthProvider {
  if (name === 'facebook') {
    const p = new FacebookAuthProvider()
    p.addScope('email')
    return p
  }
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}

function credentialFromError(name: ProviderName, err: unknown): AuthCredential | null {
  const e = err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]
  return name === 'facebook' ? FacebookAuthProvider.credentialFromError(e) : GoogleAuthProvider.credentialFromError(e)
}

/**
 * 登入。同一個 Email 已經用另一種方式登入過時（專案設定為「同 Email 自動連結」），
 * 先用原本的方式登入，再把這次的登入方式連結到同一個帳號。
 * confirmLink 回傳 false 表示使用者取消。
 */
export async function signInWith(
  name: ProviderName,
  confirmLink: (email: string, existing: ProviderName) => boolean,
): Promise<void> {
  try {
    await signInWithPopup(auth, makeProvider(name))
  } catch (err) {
    const code = (err as { code?: string }).code
    // 彈出視窗被擋、或環境不支援（例如部分 iOS 主畫面 App）時改用整頁跳轉
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-environment') {
      await signInWithRedirect(auth, makeProvider(name))
      return
    }
    if (code === 'auth/account-exists-with-different-credential') {
      const pending = credentialFromError(name, err)
      const email = (err as { customData?: { email?: string } }).customData?.email ?? ''
      const existing: ProviderName = name === 'google' ? 'facebook' : 'google'
      if (!pending || !confirmLink(email, existing)) return
      const result = await signInWithPopup(auth, makeProvider(existing))
      await linkWithCredential(result.user, pending)
      return
    }
    throw err
  }
}

export function signOutUser(): Promise<void> {
  return signOut(auth)
}

export function watchRemote(uid: string, callback: (value: unknown) => void, onError: (err: Error) => void): Unsubscribe {
  return onValue(ref(db, `v2/personal/${uid}`), (snap) => callback(snap.val()), onError)
}

export function writeRemote(paths: Record<string, unknown>): Promise<void> {
  return update(ref(db), paths)
}

/** 連線狀態（Realtime Database 內建的 .info/connected） */
export function watchConnected(callback: (connected: boolean) => void): Unsubscribe {
  return onValue(ref(db, '.info/connected'), (snap) => callback(snap.val() === true))
}

/* ---------- 社群：評分、留言、暱稱（讀取走 REST，見 social/store.ts） ---------- */

/** 暱稱已經有人使用（比對方式見 social/model 的 nameKey） */
export class NameTakenError extends Error {
  constructor() {
    super('name taken')
  }
}

type Profile = { name: string; updatedAt: string }

async function nameOwner(key: string): Promise<string | null> {
  return (await get(ref(db, `v2/names/${key}`))).val()
}

/**
 * 登記暱稱並更新個人資料（v2/names 與 v2/profiles 一次寫入，資料庫規則保證不重複）；
 * 改名時同時釋放舊的暱稱。name 必須是 normalizeName 之後的寫法。
 */
export async function claimName(uid: string, name: string): Promise<Profile> {
  const key = nameKey(name)
  const owner = await nameOwner(key)
  if (owner && owner !== uid) throw new NameTakenError()
  const profile = { name, updatedAt: new Date().toISOString() }
  const paths: Record<string, unknown> = { [`v2/profiles/${uid}`]: profile }
  // 已經是自己的（例如只改大小寫）就不用再登記
  if (owner !== uid) paths[`v2/names/${key}`] = uid
  const current: Profile | null = (await get(ref(db, `v2/profiles/${uid}`))).val()
  if (current) {
    const oldKey = nameKey(current.name)
    if (oldKey !== key && (await nameOwner(oldKey)) === uid) paths[`v2/names/${oldKey}`] = null
  }
  try {
    await update(ref(db), paths)
  } catch (err) {
    // 預先檢查之後才被別人搶先登記：資料庫規則拒絕
    if (/permission_denied/i.test(String((err as Error).message))) throw new NameTakenError()
    throw err
  }
  return profile
}

/** 第一次登入時建立暱稱（預設 Google 名稱），已有就不動；名稱已有人使用時依序加上 2、3…。回傳目前的暱稱 */
export async function ensureProfile(uid: string, fallbackName: string): Promise<Profile> {
  const snap = await get(ref(db, `v2/profiles/${uid}`))
  if (snap.exists()) return snap.val()
  const base = normalizeName(fallbackName) || '岩友'
  for (let n = 1; n <= 50; n++) {
    const suffix = n === 1 ? '' : ` ${n}`
    const name = normalizeName(base.slice(0, NAME_MAX - suffix.length)) + suffix
    try {
      return await claimName(uid, name)
    } catch (err) {
      if (!(err instanceof NameTakenError)) throw err
    }
  }
  throw new NameTakenError()
}

export function saveRating(uid: string, routeId: string, rating: { stars: number; feel?: Feel; updatedAt: string } | null): Promise<void> {
  const r = ref(db, `v2/ratings/${routeKey(routeId)}/${uid}`)
  return rating ? set(r, JSON.parse(JSON.stringify(rating))) : remove(r)
}

export async function addComment(uid: string, routeId: string, text: string): Promise<void> {
  await push(ref(db, `v2/comments/${routeKey(routeId)}`), { uid, text, createdAt: serverTimestamp() })
}

export function deleteComment(routeId: string, id: string): Promise<void> {
  return remove(ref(db, `v2/comments/${routeKey(routeId)}/${id}`))
}

export async function reportComment(uid: string, routeId: string, id: string, reason: string): Promise<void> {
  await push(ref(db, 'v2/reports'), {
    path: `v2/comments/${routeKey(routeId)}/${id}`,
    uid,
    ...(reason ? { reason: reason.slice(0, 500) } : {}),
    createdAt: serverTimestamp(),
  })
}

/** 留言的檢舉（v2/reports）：id → 被檢舉的留言路徑、檢舉人、原因 */
export type CommentReports = Record<string, { path: string; uid: string; reason?: string; createdAt: number }>

/**
 * 管理員：所有留言、檢舉（只有管理員讀得到）與暱稱。用 SDK 讀，和刪除用的是同一個資料庫連線
 * （公開資料平常用 REST 讀，見 src/social/store.ts）。
 */
export async function loadAdminData(): Promise<{
  comments: Record<string, Record<string, { uid: string; text: string; createdAt: number; hidden?: boolean }>>
  reports: CommentReports
  profiles: Record<string, { name: string }>
}> {
  const [comments, reports, profiles] = await Promise.all(['v2/comments', 'v2/reports', 'v2/profiles'].map((p) => get(ref(db, p))))
  return { comments: comments.val() ?? {}, reports: reports.val() ?? {}, profiles: profiles.val() ?? {} }
}

/** 管理員：一次刪除幾個節點（留言與它的檢舉）；只接受 v2/comments、v2/reports 底下的路徑 */
export function adminDelete(paths: string[]): Promise<void> {
  if (paths.some((p) => !/^v2\/(comments\/[^/]+|reports)\/[^/]+$/.test(p))) throw new Error(`不能刪除：${paths.join(', ')}`)
  return update(ref(db), Object.fromEntries(paths.map((p) => [p, null])))
}

/** 所有人上傳的回報（v2/calibration）：只有管理員讀得到，其他人會被規則拒絕 */
export type CalibrationUploads = Record<string, Record<string, { geojson: string; createdAt: number }>>

/** 管理員：所有人上傳的回報；signedIn 依帳號（v2/calibration），anon 依沒登入的裝置代號（v2/anonReports） */
export async function loadCalibrationUploads(): Promise<{ signedIn: CalibrationUploads; anon: CalibrationUploads }> {
  const [signedIn, anon] = await Promise.all([get(ref(db, 'v2/calibration')), get(ref(db, 'v2/anonReports'))])
  return { signedIn: (signedIn.val() ?? {}) as CalibrationUploads, anon: (anon.val() ?? {}) as CalibrationUploads }
}

/** 上傳比例尺地圖的現場校正記錄（GeoJSON 文字）；只有本人與管理員讀得到 */
export async function uploadCalibration(uid: string, geojson: string): Promise<void> {
  await push(ref(db, `v2/calibration/${uid}`), { geojson, createdAt: serverTimestamp() })
}

/* ---------- 岩壁標記（見 map/walls.ts） ---------- */

/** 所有人畫的岩壁（只有登入者讀得到） */
export function watchWalls(callback: (value: unknown) => void, onError: (err: Error) => void): Unsubscribe {
  return onValue(ref(db, 'v2/walls'), (snap) => callback(snap.val()), onError)
}

export async function addWall(uid: string, sector: string, line: string): Promise<void> {
  await push(ref(db, `v2/walls/${uid}`), { sector, line, createdAt: serverTimestamp() })
}

export function deleteWall(uid: string, id: string): Promise<void> {
  return remove(ref(db, `v2/walls/${uid}/${id}`))
}

/* ---------- 地圖多邊形（管理員，見 map/shapes.ts；讀取走 REST） ---------- */

/** 調整一個大區域的形狀（rings 為多塊以「|」分隔） */
export async function saveAreaShape(uid: string, area: string, rings: string): Promise<void> {
  await set(ref(db, `v2/mapShapes/areas/${area}`), { rings, uid, updatedAt: serverTimestamp() })
}

/** 回到自動產生的形狀 */
export function deleteAreaShape(area: string): Promise<void> {
  return remove(ref(db, `v2/mapShapes/areas/${area}`))
}

/** 一個分區的範圍整批換掉：刪掉原本的幾塊、寫入新的幾塊（一次寫入） */
export async function saveSectorShapes(uid: string, sector: string, oldIds: string[], rings: string[]): Promise<void> {
  const paths: Record<string, unknown> = Object.fromEntries(oldIds.map((id) => [`v2/mapShapes/sectors/${id}`, null]))
  for (const ring of rings) paths[`v2/mapShapes/sectors/${push(ref(db, 'v2/mapShapes/sectors')).key}`] = { sector, ring, uid, updatedAt: serverTimestamp() }
  await update(ref(db), paths)
}

/* ---------- Topo（讀取走 REST，見 topo/store.ts） ---------- */

/** Cloud Storage 只在上傳、刪除照片時才載入 */
async function storage() {
  const s = await import('firebase/storage')
  const instance = s.getStorage(app)
  if (import.meta.env.MODE === 'e2e') s.connectStorageEmulator(instance, '127.0.0.1', 9199)
  return { s, instance }
}

/** 上傳照片（不能覆蓋）並建立 Topo；資料庫寫入失敗時刪掉剛上傳的檔案。回傳照片 id */
export async function createTopo(uid: string, sector: string, image: Blob, width: number, height: number): Promise<string> {
  const id = push(ref(db, 'v2/topos')).key!
  const path = `topos/${uid}/${id}.${image.type === 'image/webp' ? 'webp' : 'jpg'}`
  const { s, instance } = await storage()
  const file = s.ref(instance, path)
  await s.uploadBytes(file, image, { contentType: image.type })
  try {
    await set(ref(db, `v2/topos/${id}`), { uid, sector, image: path, width, height, createdAt: serverTimestamp() })
  } catch (err) {
    await s.deleteObject(file).catch(() => {})
    throw err
  }
  return id
}

/** 提交一個版本（完整的標記與裁切；沒有裁切時不存） */
export async function addTopoEdit(uid: string, photo: string, routes: StoredRoutes, crop?: Crop): Promise<void> {
  await push(ref(db, `v2/topoEdits/${photo}`), { uid, createdAt: serverTimestamp(), routes, ...(crop ? { crop } : {}) })
}

export function deleteTopoEdit(photo: string, edit: string): Promise<void> {
  return remove(ref(db, `v2/topoEdits/${photo}/${edit}`))
}

/** 刪除照片：先刪資料庫的照片與所有版本（畫面上消失），再刪檔案 */
export async function deleteTopo(photo: TopoPhoto): Promise<void> {
  await update(ref(db), { [`v2/topos/${photo.id}`]: null, [`v2/topoEdits/${photo.id}`]: null })
  await deleteTopoFiles([photo.image])
}

export async function deleteTopoFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { s, instance } = await storage()
  await Promise.all(paths.map((p) => s.deleteObject(s.ref(instance, p))))
}

/**
 * Firebase 只讓最近登入過（約 5 分鐘內）的人刪除帳號，否則 deleteUser 回 auth/requires-recent-login。
 * 預留 1 分鐘給刪除資料的時間：超過 4 分鐘沒登入就先跳出登入視窗重新驗證。
 */
const RECENT_SIGN_IN_MS = 4 * 60 * 1000

/**
 * 刪除帳號前呼叫，而且必須是按下按鈕後第一個等待的動作：iPhone、iPad 的 Safari 只在按下按鈕的當下
 * 允許開新視窗（見 sync.ts 的 preloadSignIn）；放在刪除資料之後，視窗會被擋，資料刪了一半帳號卻還在。
 */
export async function reauthenticateIfStale(): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('not signed in')
  // 沒有登入時間時 Date.parse 為 NaN，比較結果為 false，一律重新驗證
  if (Date.now() - Date.parse(user.metadata.lastSignInTime ?? '') < RECENT_SIGN_IN_MS) return
  const providerId = user.providerData[0]?.providerId
  await reauthenticateWithPopup(user, makeProvider(providerId === 'facebook.com' ? 'facebook' : 'google'))
}

/**
 * 刪除帳號：先刪除資料庫中屬於這個使用者的資料（paths 由呼叫端整理，值為 null），再刪除登入帳號。
 * 呼叫前先以 reauthenticateIfStale 重新驗證；手機時間不準等情況仍被要求重新驗證時，再跳出登入視窗。
 */
export async function deleteAccount(paths: Record<string, null>): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('not signed in')
  await update(ref(db), paths)
  try {
    await deleteUser(user)
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/requires-recent-login') throw err
    const providerId = user.providerData[0]?.providerId
    await reauthenticateWithPopup(user, makeProvider(providerId === 'facebook.com' ? 'facebook' : 'google'))
    await deleteUser(user)
  }
}
