import { withCloud } from '../personal/sync'
import { t } from '../i18n'
import { encodeMarks, isFullCrop, MAX_EDGE, type Crop, type Marks, type TopoPhoto } from './model'
import { loadEdits, loadPhotos } from './store'

/** 縮到長邊不超過 MAX_EDGE，輸出 WebP（瀏覽器不支援時為 JPEG）；照片的方向依 EXIF 轉正 */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error(t('topo.notImage'))
  })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
  // 不支援 WebP 的瀏覽器會改輸出 PNG，這時改用 JPEG
  const webp = await encode('image/webp')
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg')
  if (!blob) throw new Error(t('topo.notImage'))
  return { blob, width, height }
}

/** 上傳照片到分區，回傳照片 id */
export async function uploadTopo(sector: string, file: File): Promise<string> {
  const { m, uid } = await withCloud()
  const { blob, width, height } = await shrink(file)
  const id = await m.createTopo(uid, sector, blob, width, height)
  await loadPhotos(true)
  return id
}

export async function submitEdit(photo: string, marks: Marks, crop?: Crop): Promise<void> {
  const routes = encodeMarks(marks)
  if (Object.keys(routes).length === 0) throw new Error(t('topo.empty'))
  const { m, uid } = await withCloud()
  await m.addTopoEdit(uid, photo, routes, isFullCrop(crop) ? undefined : crop)
  await loadEdits(photo, true)
}

export async function removeEdit(photo: string, edit: string): Promise<void> {
  const { m } = await withCloud()
  await m.deleteTopoEdit(photo, edit)
  await loadEdits(photo, true)
}

export async function removeTopo(photo: TopoPhoto): Promise<void> {
  const { m } = await withCloud()
  try {
    await m.deleteTopo(photo)
  } finally {
    await loadPhotos(true)
  }
}
