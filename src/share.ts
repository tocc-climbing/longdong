import type { RouteRef } from './data/dataset'
import type { Area, Sector } from './data/schema'
import { localName, type Lang, type Translate } from './i18n'

/**
 * 路線頁在網站裡的路徑（不含開頭的 /），也是分享出去的網址；
 * scripts/gen-share-pages.ts 在這個路徑放一份帶有路線預覽資訊的 index.html（route/<路線ID>.html，firebase.json 的 cleanUrls）。
 */
export function sharePagePath(routeId: string): string {
  return `route/${routeId}`
}

/**
 * 分享路線：自訂的分享選單（LINE、Facebook、Messenger、複製連結），
 * 支援系統分享選單時另有「更多…」叫出系統選單。
 */

/**
 * 路線的分享網址：<網站>/route/<路線ID>，就是 App 的路線頁。
 * 這個路徑有一份帶路線預覽資訊的頁面（scripts/gen-share-pages.ts），Facebook、LINE 的預覽卡片才看得到路線。
 * site 是網站的根目錄（例如 https://longdong.web.app/）。
 */
export function routeUrl(site: string, routeId: string): string {
  // 路線ID 只含 [a-z0-9./-]，不需要編碼
  return site.replace(/\/?$/, '/') + sharePagePath(routeId)
}

/** 分享的文字：「#102 拉斯塔法里海鳥 5.9｜龍洞 黃金谷 · 貓屋」；只有一個區域的大區域不重複區域名 */
export function shareText({ route, sector, area }: RouteRef, lang: Lang, t: Translate): string {
  const name = [route.number && `#${route.number}`, localName(route.name, lang).main, route.grade].filter(Boolean).join(' ')
  const place = [localName(area.name, lang).main, area.sectors.length > 1 && localName(sector.name, lang).main].filter(Boolean).join(' · ')
  return `${name}｜${t('share.crag')} ${place}`
}

/** 區域、分區的分享文字：「黃金谷｜龍洞」「貓屋 · 黃金谷｜龍洞」 */
export function placeShareText(area: Area, sector: Sector | undefined, lang: Lang, t: Translate): string {
  const place = [sector && localName(sector.name, lang).main, localName(area.name, lang).main].filter(Boolean).join(' · ')
  return `${place}｜${t('share.crag')}`
}

/** 目前網站裡某一頁的完整網址（path 以 / 開頭，例如 /area/longdong/golden-valley） */
export function siteUrl(path: string): string {
  return location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + path
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
  return routeUrl(location.origin + import.meta.env.BASE_URL, routeId)
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
