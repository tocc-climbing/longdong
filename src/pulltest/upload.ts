import { withCloud } from '../personal/sync'
import { photosToUpload, toRecord, type Outing } from './model'
import { outingPhotos, saveOuting } from './store'

/**
 * 上傳一次出勤：先傳照片（已經在 Storage 的略過），全部成功才寫入出勤紀錄（狀態待審核），
 * 紀錄裡不會有指向還沒傳成功的照片。中途失敗可以再按一次：照片與紀錄都用固定的 id，不會多一份。
 */
export async function uploadOuting(outing: Outing): Promise<void> {
  const { m, uid } = await withCloud()
  const photos = await outingPhotos(outing.id)
  const refs = photos.map((p) => ({ id: p.id, routeId: p.routeId, position: p.position, type: p.blob.type }))
  const record = toRecord(outing, uid, refs)
  for (const p of photosToUpload(record, uid, outing.id, refs)) await m.uploadPullTestPhoto(p.path, photos.find((x) => x.id === p.id)!.blob)
  await m.submitPullTest(outing.id, record)
  await saveOuting({ ...outing, uploadedAt: new Date().toISOString() })
}

/** 上傳過的出勤目前的審核狀態（要登入）；雲端沒有這筆時 undefined */
export async function outingStatus(id: string) {
  const { m } = await withCloud()
  return m.loadPullTest(id)
}
