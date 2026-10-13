import type { RouteRef } from './data/dataset'
import { localName, type Lang, type Translate } from './i18n'
import { href } from './router'

/**
 * 分享路線：支援系統分享選單（手機、Windows／macOS 的瀏覽器）時叫出分享選單，
 * 否則把連結複製到剪貼簿。
 */

/** 路線的完整網址；base 是 App 所在的位址（例如 https://tocc-climbing.github.io/longdong/） */
export function routeUrl(base: string, routeId: string): string {
  return base.replace(/[?#].*$/, '') + href.route(routeId)
}

/** 分享的文字：「#102 拉斯塔法里海鳥 5.9｜龍洞 黃金谷 · 貓屋」；只有一個區域的大區域不重複區域名 */
export function shareText({ route, sector, area }: RouteRef, lang: Lang, t: Translate): string {
  const name = [route.number && `#${route.number}`, localName(route.name, lang).main, route.grade].filter(Boolean).join(' ')
  const place = [localName(area.name, lang).main, area.sectors.length > 1 && localName(sector.name, lang).main].filter(Boolean).join(' · ')
  return `${name}｜${t('share.crag')} ${place}`
}

export type ShareResult = 'shared' | 'copied' | 'cancelled'

export async function shareRoute(ref: RouteRef, lang: Lang, t: Translate): Promise<ShareResult> {
  const url = routeUrl(location.origin + location.pathname, ref.route.id)
  const text = shareText(ref, lang, t)
  if (navigator.share) {
    try {
      await navigator.share({ title: text, text, url })
      return 'shared'
    } catch (err) {
      // 使用者關掉分享選單；其他錯誤（例如不允許的情境）改用複製連結
      if ((err as Error).name === 'AbortError') return 'cancelled'
    }
  }
  await navigator.clipboard.writeText(`${text}\n${url}`)
  return 'copied'
}
