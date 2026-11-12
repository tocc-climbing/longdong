import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import type { BrowserContext } from 'playwright-core'

/** 不連本機伺服器或外站，直接以 production 檔案回應瀏覽器；不代替 Service Worker 的離線測試。 */
export async function offlinePreview(context: BrowserContext) {
  const root = resolve('dist')
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'climbio.test') return route.fulfill({ json: null })
    let file = resolve(root, '.'+decodeURIComponent(url.pathname))
    if (!file.startsWith(root+sep) || !existsSync(file) || !statSync(file).isFile()) file = resolve(root, 'index.html')
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream'
    await route.fulfill({ body: readFileSync(file), contentType })
  })
  return 'https://climbio.test/'
}
