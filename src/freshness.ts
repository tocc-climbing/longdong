/**
 * App 回到前景時檢查更新。
 * 加到主畫面的 App 切到背景再回來時不會重新載入頁面，Service Worker 只在載入時檢查新版本，
 * 評分也只在開啟時讀一次；所以在「回到前景」「恢復網路」與「使用中每隔一段時間」主動檢查。
 */

/** 距離上次檢查超過 gapMs 才再檢查，避免頻繁切換 App 時重複請求 */
export function due(now: number, last: number | undefined, gapMs: number): boolean {
  return last === undefined || now - last >= gapMs
}

/**
 * 頁面可見且有網路時執行 task：回到前景、恢復網路時檢查一次，可見期間每 intervalMs 再檢查。
 * 回傳停止監聽的函式。
 */
export function whenActive(task: () => void, { gapMs, intervalMs }: { gapMs: number; intervalMs: number }): () => void {
  let last: number | undefined = Date.now() // 開啟時已經載入過最新的，不用馬上再查
  const run = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return
    if (!due(Date.now(), last, gapMs)) return
    last = Date.now()
    task()
  }
  document.addEventListener('visibilitychange', run)
  window.addEventListener('online', run)
  const timer = setInterval(run, intervalMs)
  return () => {
    document.removeEventListener('visibilitychange', run)
    window.removeEventListener('online', run)
    clearInterval(timer)
  }
}
