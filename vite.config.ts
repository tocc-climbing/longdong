/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base 用相對路徑，部署在 GitHub Pages 子路徑或自訂網域都能運作（路由用 hash）
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: '龍洞攀岩資料庫',
        short_name: '龍洞',
        description: '龍洞攀岩路線與 Bolt 資訊，離線可用',
        lang: 'zh-Hant-TW',
        start_url: './',
        scope: './',
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
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        // 路線分享頁（route/<路線ID>/）是建置後產生的靜態頁，交給網路，不要換成 App 本身
        navigateFallbackDenylist: [/\/route\//],
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
