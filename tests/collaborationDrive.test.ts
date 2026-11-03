import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection, uploadPhoto } from '../src/collaboration/drive'

// 要抓的突變：把分享角色改成 writer、把照片存到 root，或未檢查失敗回應就顯示成功。
afterEach(() => vi.unstubAllGlobals())

describe('合作照片存入岩友的 Drive', () => {
  it('只公開新建的合作資料夾，知道連結的人有檢視權限', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'folder1' }))
      .mockResolvedValueOnce(Response.json({ id: 'anyone' }))
    vi.stubGlobal('fetch', fetch)
    const folder = await createCollection('token')
    expect(folder).toEqual({ id: 'folder1', url: 'https://drive.google.com/drive/folders/folder1' })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ mimeType: 'application/vnd.google-apps.folder' })
    expect(fetch.mock.calls[1][0]).toContain('/files/folder1/permissions')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ type: 'anyone', role: 'reader', allowFileDiscovery: false })
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token')
  })

  it('原始照片與區域標籤放進合作資料夾，檔名與內容保留', async () => {
    const file = new File(['original bytes'], '岩壁.jpg', { type: 'image/jpeg' })
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/session1' } }))
      .mockResolvedValueOnce(Response.json({ id: 'photo1' }))
    vi.stubGlobal('fetch', fetch)
    await uploadPhoto('token', 'folder1', file, { area: 'longdong/school-gate', sector: 'longdong/sector1' })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      name: '岩壁.jpg', parents: ['folder1'],
      properties: { area: 'longdong/school-gate', sector: 'longdong/sector1' },
    })
    expect(fetch.mock.calls[1][0]).toBe('https://www.googleapis.com/upload/session1')
    expect(fetch.mock.calls[1][1].body).toBe(file)
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer token')
  })

  it('Google 拒絕公開分享時停止，不把私人資料夾當成分享成功', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'folder1' }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'Sharing disabled' } }, { status: 403 })))
    await expect(createCollection('token')).rejects.toMatchObject({ status: 403 })
  })

  it('上傳失敗會回報狀態，授權失效不會誤報完成', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'Expired' } }, { status: 401 })))
    await expect(uploadPhoto('token', 'folder1', new File(['photo'], 'a.jpg'), {})).rejects.toMatchObject({ status: 401 })
  })
})
