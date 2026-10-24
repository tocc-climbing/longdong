import { deleteAccount, withCloud } from '../personal/sync'
import { COMMENT_MAX, NAME_MAX, nameKey, normalizeName, type Comment, type Feel, type Rating } from './model'
import { t } from '../i18n'
import { get, loadComments, loadRatings, setLocalProfile, setLocalRating } from './store'
import type { StoredEdit, TopoPhoto } from '../topo/model'

/** 評分；rating 為 null 時刪除自己的評分 */
export async function rate(routeId: string, input: { stars: number; feel?: Feel } | null): Promise<void> {
  const { m, uid } = await withCloud()
  const rating: Rating | null = input ? { ...input, updatedAt: new Date().toISOString() } : null
  await m.saveRating(uid, routeId, rating)
  setLocalRating(uid, routeId, rating)
}

export async function postComment(routeId: string, text: string): Promise<void> {
  const body = text.trim()
  if (!body) return
  if (body.length > COMMENT_MAX) throw new Error(t('comments.tooLong', { n: COMMENT_MAX }))
  const { m, uid } = await withCloud()
  await m.addComment(uid, routeId, body)
  await loadComments(routeId)
}

export async function removeComment(routeId: string, id: string): Promise<void> {
  const { m } = await withCloud()
  await m.deleteComment(routeId, id)
  await loadComments(routeId)
}

export async function report(routeId: string, id: string, reason: string): Promise<void> {
  const { m, uid } = await withCloud()
  await m.reportComment(uid, routeId, id, reason.trim())
}

/** 改暱稱：整理成標準寫法（去掉多餘空白、全形轉半形等），不能和別人的重複（不分大小寫）；回傳實際存下的暱稱 */
export async function rename(name: string): Promise<string> {
  const value = normalizeName(name)
  if (!value) throw new Error(t('name.empty'))
  if (value.length > NAME_MAX) throw new Error(t('name.tooLong', { n: NAME_MAX }))
  const { m, uid } = await withCloud()
  try {
    setLocalProfile(uid, await m.claimName(uid, value))
  } catch (err) {
    if (err instanceof m.NameTakenError) throw new Error(t('name.taken'))
    throw err
  }
  return value
}

/**
 * 刪除我的帳號：個人紀錄、暱稱、所有評分與留言、Topo（自己的版本；自己上傳的照片連同別人在上面的標記），最後刪除登入帳號。
 * 先重新驗證（太久沒登入時跳出登入視窗），再以最新的雲端資料找出屬於自己的評分與留言，一次刪除。
 */
export async function deleteMyAccount(): Promise<void> {
  const { m, uid } = await withCloud()
  // 必須在任何網路讀寫之前：Safari 只在按下按鈕的當下允許開登入視窗
  await m.reauthenticateIfStale()
  const [ratings, comments, profile, topos, topoEdits] = await Promise.all([
    get<Record<string, Record<string, Rating>>>('v2/ratings'),
    get<Record<string, Record<string, Omit<Comment, 'id'>>>>('v2/comments'),
    get<{ name: string }>(`v2/profiles/${uid}`),
    get<Record<string, Omit<TopoPhoto, 'id'>>>('v2/topos'),
    get<Record<string, Record<string, StoredEdit>>>('v2/topoEdits'),
  ])
  const paths: Record<string, null> = {
    [`v2/personal/${uid}`]: null,
    [`v2/profiles/${uid}`]: null,
    [`v2/calibration/${uid}`]: null,
  }
  // 釋放暱稱，讓別人可以使用
  if (profile) {
    const key = nameKey(profile.name)
    if ((await get<string>(`v2/names/${key}`)) === uid) paths[`v2/names/${key}`] = null
  }
  for (const [route, byUser] of Object.entries(ratings ?? {})) {
    if (byUser[uid]) paths[`v2/ratings/${route}/${uid}`] = null
  }
  for (const [route, list] of Object.entries(comments ?? {})) {
    for (const [id, c] of Object.entries(list)) if (c.uid === uid) paths[`v2/comments/${route}/${id}`] = null
  }
  const myPhotos = Object.entries(topos ?? {}).filter(([, p]) => p.uid === uid)
  for (const [id] of myPhotos) {
    paths[`v2/topos/${id}`] = null
    paths[`v2/topoEdits/${id}`] = null
  }
  for (const [photo, list] of Object.entries(topoEdits ?? {})) {
    if (paths[`v2/topoEdits/${photo}`] === null) continue
    for (const [id, e] of Object.entries(list)) if (e.uid === uid) paths[`v2/topoEdits/${photo}/${id}`] = null
  }
  // 照片檔在資料庫之前刪：資料庫刪了之後就找不到檔案的路徑
  await m.deleteTopoFiles(myPhotos.map(([, p]) => p.image))
  await deleteAccount(paths)
  await loadRatings(true)
}
