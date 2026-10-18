// 舊網址的 Service Worker 換成這個：清掉離線快取、取消註冊，再重新載入頁面，讓已安裝的 App 也轉到新網址。
// 舊版 App 檢查更新時會下載這個檔案；install 時直接 skipWaiting，不必等使用者按「更新」。
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key)
      await self.registration.unregister()
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
    })(),
  )
})
