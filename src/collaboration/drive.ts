/** 合作照片只寫入本次新建的資料夾；其他 Drive 檔案不會被公開或變更。 */
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id'

export interface Collection { id: string; url: string }
export interface PhotoLabels { area?: string; sector?: string }

export class DriveError extends Error {
  constructor(public status: number) { super(`Google Drive: ${status}`) }
}

async function check(response: Response): Promise<Response> {
  if (!response.ok) throw new DriveError(response.status)
  return response
}

export async function createCollection(token: string, signal?: AbortSignal): Promise<Collection> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const response = await check(await fetch(`${API}/files?fields=id`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ name: `龍洞 × 紅點貓 ${new Date().toISOString()}`, mimeType: 'application/vnd.google-apps.folder' }),
  }))
  const { id } = await response.json() as { id: string }
  await check(await fetch(`${API}/files/${id}/permissions`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
  }))
  return { id, url: `https://drive.google.com/drive/folders/${id}` }
}

/** Resumable 上傳保留原檔，不把手機原始照片轉成 base64 或壓縮。 */
export async function uploadPhoto(token: string, folder: string, file: File, labels: PhotoLabels, signal?: AbortSignal): Promise<void> {
  const response = await check(await fetch(UPLOAD, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': file.type },
    body: JSON.stringify({ name: file.name, parents: [folder], properties: labels }),
  }))
  const location = response.headers.get('Location')
  if (!location) throw new DriveError(502)
  await check(await fetch(location, {
    method: 'PUT', signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type },
    body: file,
  }))
}
