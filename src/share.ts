import type { RouteRef } from './data/dataset'
import { localName, type Lang, type Translate } from './i18n'

/** 分享頁在網站裡的路徑（不含開頭的 /）；scripts/lib/sharePages.ts 依此產生頁面 */
export function sharePagePath(routeId: string): string {
  return `route/${routeId}/`
}

/**
 * 分享路線：自訂的分享選單（LINE、Facebook、Messenger、複製連結），
 * 支援系統分享選單時另有「更多…」叫出系統選單。
 */

/**
 * 路線的分享網址：…/longdong/route/<路線ID>/，建置時產生的分享頁（scripts/gen-share-pages.ts）。
 * 分享頁帶有這條路線的預覽資訊，Facebook、LINE 的預覽卡片才看得到路線；開啟時轉到 App 的路線頁。
 * base 是 App 所在的位址（例如 https://tocc-climbing.github.io/longdong/）。
 */
export function routeUrl(base: string, routeId: string): string {
  // 路線ID 只含 [a-z0-9./-]，不需要編碼
  return base.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + sharePagePath(routeId)
}

/** 分享的文字：「#102 拉斯塔法里海鳥 5.9｜龍洞 黃金谷 · 貓屋」；只有一個區域的大區域不重複區域名 */
export function shareText({ route, sector, area }: RouteRef, lang: Lang, t: Translate): string {
  const name = [route.number && `#${route.number}`, localName(route.name, lang).main, route.grade].filter(Boolean).join(' ')
  const place = [localName(area.name, lang).main, area.sectors.length > 1 && localName(sector.name, lang).main].filter(Boolean).join(' · ')
  return `${name}｜${t('share.crag')} ${place}`
}

export type ShareTarget = 'line' | 'facebook' | 'messenger'

/** 各 App 的分享網址；Messenger 只有手機 App 的網址（fb-messenger://），電腦上不提供 */
export function targetUrl(target: ShareTarget, url: string, text: string): string {
  const u = encodeURIComponent(url)
  switch (target) {
    case 'line':
      return `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`
    case 'messenger':
      return `fb-messenger://share/?link=${u}`
  }
}

export function currentRouteUrl(routeId: string): string {
  return routeUrl(location.origin + location.pathname, routeId)
}

export function copy(text: string, url: string): Promise<void> {
  return navigator.clipboard.writeText(`${text}\n${url}`)
}

/** 系統分享選單；使用者關掉選單時不算失敗 */
export async function systemShare(text: string, url: string): Promise<void> {
  try {
    await navigator.share({ title: text, text, url })
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err
  }
}

export function canSystemShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}
