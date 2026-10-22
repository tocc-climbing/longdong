/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { appVersion } from './scripts/lib/appVersion'

const version = appVersion()
/** 開發站（main 建置時 VITE_CHANNEL=dev）：安裝後的名稱不同，也不讓搜尋引擎收錄 */
const devSite = process.env.VITE_CHANNEL === 'dev'

// 網址不帶 #（/area/…、/route/…），資源一律從網站根目錄讀；伺服器把所有路徑交給 index.html（firebase.json 的 rewrites）
export default defineConfig({
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    // 最新版號，給「有新版本」的提示讀取（不放進離線快取，見 globIgnores）
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(version) + '\n' })
      },
    },
    {
      name: 'dev-site-noindex',
      transformIndexHtml: (html) => (devSite ? html.replace('</head>', '  <meta name="robots" content="noindex" />\n  </head>') : html),
    },
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: devSite ? '龍洞攀岩資料庫（開發版）' : '龍洞攀岩資料庫',
        short_name: devSite ? '龍洞開發版' : '龍洞',
        description: '龍洞攀岩路線與 Bolt 資訊，離線可用',
        lang: 'zh-Hant-TW',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f4ef',
        theme_color: '#1f4e5f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App 和完整路線資料一起預先快取，沒有訊號也能使用
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json,geojson}'],
        // 路線分享頁（route/）每條路線一頁、內容同 index.html，不必預先快取：離線時由 navigateFallback 回 index.html
        globIgnores: ['**/node_modules/**/*', 'version.json', 'route/**', 'og/**', 'map.html', 'checklist.html'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Firebase 的保留路徑（/__/auth/handler 等，登入用）交給網路
        navigateFallbackDenylist: [/^\/__\//],
        // 評分、留言、暱稱：有網路時讀最新，離線時用最後一次讀到的
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/longdong\.firebaseio\.com\/v2\/(ratings|comments|profiles)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'social',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    // 資料庫規則測試需要模擬器，另外以 npm run test:rules 執行（vitest.rules.config.ts）
    exclude: ['tests/rules/**'],
  },
})
