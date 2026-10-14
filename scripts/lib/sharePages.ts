import type { RouteRef } from '../../src/data/dataset'
import { typeText } from '../../src/format'
import { localName, translate } from '../../src/i18n'
import { href } from '../../src/router'
import { sharePagePath } from '../../src/share'

/**
 * 每條路線的分享頁：…/longdong/route/<路線ID>/。
 * App 用 # 區分頁面，Facebook、LINE 抓預覽時只看得到 index.html，所以替每條路線產生一個小頁面，
 * 裡面放這條路線的預覽資訊（Open Graph），開啟時立刻轉到 App 的路線頁。
 */

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('zh', key, vars)

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 預覽卡片的標題與說明：「#102 拉斯塔法里海鳥 Rastafarian Seabirds 5.9」「龍洞 黃金谷 · 貓屋｜傳攀 · 19 m｜安全評級：正常」 */
export function sharePreview({ route, sector, area }: RouteRef): { title: string; description: string } {
  const name = localName(route.name, 'zh')
  const title = [route.number && `#${route.number}`, name.main, name.sub, route.grade].filter(Boolean).join(' ')
  const place = [t('share.crag'), localName(area.name, 'zh').main, area.sectors.length > 1 && `· ${localName(sector.name, 'zh').main}`]
    .filter(Boolean)
    .join(' ')
  const facts = [typeText(route, t), route.heightM && `${route.heightM} m`].filter(Boolean).join(' · ')
  const safety = route.safety && t('safety.aria', { label: t(`safety.${route.safety}`) })
  const closed = (route.status === 'closed' || route.status === 'to-remove') && `⚠ ${route.statusLabel ?? t(`status.${route.status}`)}`
  return { title, description: [place, facts, safety, closed].filter(Boolean).join('｜') }
}

/** siteUrl：網站的正式網址，結尾有 /（例如 https://tocc-climbing.github.io/longdong/） */
export function sharePageHtml(ref: RouteRef, siteUrl: string): string {
  const { title, description } = sharePreview(ref)
  const url = siteUrl + sharePagePath(ref.route.id)
  // 分享頁在 route/<岩場>/<代碼>/ 底下，往上幾層回到 App
  const up = '../'.repeat(1 + ref.route.id.split('/').length)
  const target = up + href.route(ref.route.id)
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}｜${escape(t('app.title'))}</title>
<meta name="description" content="${escape(description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escape(t('app.title'))}" />
<meta property="og:title" content="${escape(title)}" />
<meta property="og:description" content="${escape(description)}" />
<meta property="og:url" content="${escape(url)}" />
<meta property="og:image" content="${escape(siteUrl)}icons/icon-512.png" />
<meta name="twitter:card" content="summary" />
<link rel="canonical" href="${escape(url)}" />
<meta http-equiv="refresh" content="0; url=${escape(target)}" />
<script>location.replace(${JSON.stringify(target)})</script>
</head>
<body>
<p><a href="${escape(target)}">${escape(title)}</a></p>
</body>
</html>
`
}
