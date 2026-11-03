import { readFileSync } from 'node:fs'
import type { Page, Route } from 'playwright-core'

/** 登入走 Firebase 模擬器；Drive 授權回應與檔案 API 以測試路由模擬，不寫入真人 Drive。 */
export async function testCollaboration(page: Page, check: (label: string, pass: boolean, detail?: string) => void): Promise<void> {
  const viewport = page.viewportSize()
  const original = readFileSync('public/icons/icon-192.png')
  const metadata: { name: string; parents: string[]; properties: Record<string, string> }[] = []
  const permissions: unknown[] = []
  const uploads: { name: string; bytes: Buffer }[] = []
  let denied = false
  let failSecond = true
  let folders = 0
  const oauthPattern = '**/accounts:signInWithIdp*'
  const drivePattern = 'https://www.googleapis.com/**'
  const oauth = async (route: Route) => {
    const response = await route.fetch()
    // 模擬器沒有 Google Drive 權杖；明確注入只供 mock Drive 使用的假權杖。
    await route.fulfill({ response, json: { ...await response.json(), oauthAccessToken: 'mock-drive-only' } })
  }
  const respond = (route: Route, body: unknown, status = 200, extra: Record<string, string> = {}) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Upload-Content-Type', 'Access-Control-Allow-Methods': 'POST,PUT,OPTIONS', 'Access-Control-Expose-Headers': 'Location', ...extra },
  })
  const drive = async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') { await respond(route, {}); return }
    check('Drive 使用另外取得的 OAuth 權杖', request.headers().authorization === 'Bearer mock-drive-only')
    if (path === '/drive/v3/files') {
      folders++
      check('只建立新的合作資料夾', request.postDataJSON().mimeType === 'application/vnd.google-apps.folder')
      await respond(route, { id: 'cooperation-folder' })
    } else if (path.endsWith('/permissions')) {
      permissions.push(request.postDataJSON())
      await respond(route, denied ? { error: { message: 'Sharing disabled' } } : { id: 'anyone' }, denied ? 403 : 200)
    } else if (path === '/upload/drive/v3/files') {
      metadata.push(request.postDataJSON())
      await respond(route, {}, 200, { Location: `https://www.googleapis.com/upload/session-${metadata.length}` })
    } else if (path.startsWith('/upload/session-')) {
      const photo = metadata[Number(path.split('-').pop()) - 1]
      uploads.push({ name: photo.name, bytes: request.postDataBuffer()! })
      if (photo.name === '岩壁二.png' && failSecond) {
        failSecond = false
        await respond(route, { error: { message: 'Temporary error' } }, 503)
      } else await respond(route, { id: `photo-${uploads.length}` })
    } else await respond(route, { error: 'Unexpected request' }, 404)
  }
  await page.route(oauthPattern, oauth)
  await page.route(drivePattern, drive)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(new URL('/me', page.url()).href)
    await page.locator('a[href="/collaboration"]').first().click()
    await page.waitForSelector('.collaboration-form')
    await page.locator('input[type=file]').setInputFiles([
      { name: '岩壁一.png', mimeType: 'image/png', buffer: original },
      { name: '岩壁二.png', mimeType: 'image/png', buffer: original },
    ])
    const submit = page.locator('.collaboration-submit button')
    check('尚未授權 Drive 不會開始上傳', await submit.isDisabled() && folders === 0)
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: '授權 Google Drive', exact: true }).click()])
    await popup.waitForLoadState()
    const driveScopes = (new URL(popup.url()).searchParams.get('scopes') ?? '').split(/[,\s]+/).filter(s => s.includes('/auth/drive'))
    check('僅額外要求 drive.file 權限', JSON.stringify(driveScopes) === JSON.stringify(['https://www.googleapis.com/auth/drive.file']))
    await popup.getByText('editor@example.com', { exact: true }).click()
    await page.getByRole('button', { name: '重新授權', exact: true }).waitFor()
    check('未同意公開分享時禁止上傳', await submit.isDisabled() && folders === 0)
    await page.locator('.collaboration-location select').first().selectOption('longdong/school-gate')
    const sector = await page.locator('.collaboration-location select').nth(1).locator('option').nth(1).getAttribute('value')
    await page.locator('.collaboration-location select').nth(1).selectOption(sector!)
    await page.locator('.collaboration-consent input').check()
    await submit.click()
    await page.getByRole('button', { name: '重試未完成的照片', exact: true }).waitFor()
    check('照片逐張回報，失敗不會誤報成功', (await page.getByRole('status').textContent()) === '已儲存 1／2 張')
    check('部分照片完成後固定這批的區域標籤', await page.locator('.collaboration-location select').first().isDisabled() && await page.locator('.collaboration-location select').nth(1).isDisabled())
    await submit.click()
    await page.getByText('已儲存 2／2 張', { exact: true }).waitFor()
    check('只重試未完成的照片，沿用原合作資料夾', folders === 1 && uploads.filter(p => p.name === '岩壁一.png').length === 1 && uploads.filter(p => p.name === '岩壁二.png').length === 2)
    check('合作資料夾只允許知道連結的人檢視', JSON.stringify(permissions) === JSON.stringify([{ type: 'anyone', role: 'reader', allowFileDiscovery: false }]))
    check('照片位於合作資料夾，保留區域與分區', metadata.every(p => p.parents[0] === 'cooperation-folder' && p.properties.area === 'longdong/school-gate' && p.properties.sector === sector))
    check('照片原始檔案內容不變', uploads.every(p => p.bytes.equals(original)))
    check('提供可交給紅點貓的 Drive 資料夾連結', await page.getByRole('link', { name: '開啟 Google Drive' }).getAttribute('href') === 'https://drive.google.com/drive/folders/cooperation-folder')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: '複製連結', exact: true }).click()
    await page.getByRole('button', { name: '已複製', exact: true }).waitFor()
    check('合作資料夾連結確實複製到剪貼簿', await page.evaluate(() => navigator.clipboard.readText()) === 'https://drive.google.com/drive/folders/cooperation-folder')
    denied = true
    const before = uploads.length
    await page.locator('input[type=file]').setInputFiles({ name: '新照片.png', mimeType: 'image/png', buffer: original })
    await submit.click()
    await page.getByRole('alert').waitFor()
    check('Drive 禁止公開分享時停止，沒有上傳照片', uploads.length === before && (await page.getByRole('alert').innerText()).includes('拒絕'))
    await page.locator('input[type=file]').setInputFiles({ name: 'file.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a photo') })
    check('選擇非照片會拒絕且不會誤傳先前的選取', (await page.getByRole('alert').innerText()).includes('JPG') && await submit.isDisabled())
  } finally {
    await page.unroute(oauthPattern, oauth)
    await page.unroute(drivePattern, drive)
    if (viewport) await page.setViewportSize(viewport)
  }
}
