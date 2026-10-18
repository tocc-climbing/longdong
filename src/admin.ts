import { useEffect, useState } from 'react'
import { useCloud } from './personal/sync'
import { get } from './social/store'

/**
 * 目前登入的人是不是管理員（在 /role 名單裡，名單公開可讀）。
 * 還沒查到時是 undefined；只決定要不要顯示管理員的入口，實際權限由資料庫規則把關。
 */
export function useIsAdmin(): boolean | undefined {
  const cloud = useCloud()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
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
  return admin?.uid === uid ? admin.is : undefined
}
