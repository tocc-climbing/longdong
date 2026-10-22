import { useEffect, useState } from 'react'
import { useCloud } from './personal/sync'
import { get } from './social/store'

/**
 * 管理員的 Google 帳號信箱。資料庫規則（firebase/database.rules.json）裡有同一份名單，兩邊要一起改；
 * 規則另外要求信箱已驗證（Google 登入一定是）。
 */
export const ADMIN_EMAILS = ['jinlung.you@gmail.com', 'maurice.chen67@gmail.com', 'kant.kang@gmail.com']

/**
 * 目前登入的人是不是管理員（信箱在 ADMIN_EMAILS，或 uid 在 /role 名單裡，名單公開可讀）。
 * 還沒查到時是 undefined；只決定要不要顯示管理員的入口，實際權限由資料庫規則把關。
 */
export function useIsAdmin(): boolean | undefined {
  const cloud = useCloud()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const byEmail = !!cloud.user?.email && ADMIN_EMAILS.includes(cloud.user.email.toLowerCase())
  const [admin, setAdmin] = useState<{ uid: string; is: boolean }>()
  useEffect(() => {
    if (!uid) return
    let alive = true
    get<Record<string, unknown>>('role').then(
      (role) => alive && setAdmin({ uid, is: !!role?.[uid] }),
      () => alive && setAdmin({ uid, is: false }),
    )
    return () => {
      alive = false
    }
  }, [uid])
  if (!uid) return false
  if (byEmail) return true
  return admin?.uid === uid ? admin.is : undefined
}
