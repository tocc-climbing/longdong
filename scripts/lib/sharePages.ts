import type { RouteRef } from '../../src/data/dataset'
import { typeText } from '../../src/format'
import { localName, translate } from '../../src/i18n'
import { zh } from '../../src/i18n/zh'
import { sharePagePath } from '../../src/share'

/**
 * 每條路線的分享頁：<網站>/route/<路線ID>，也就是 App 的路線頁。
 * Facebook、LINE 抓預覽時不執行程式，只看 HTML 裡的 Open Graph，所以替每條路線放一份 index.html，
 * 把標題、說明換成這條路線的；開啟的人拿到的就是 App 本身，直接顯示路線頁，不必再轉址。
 */

// 預覽卡片用中文
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(zh, key, vars)

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

/** 把 HTML 裡某個 <meta> 的內容換掉；沒有的話加在 </head> 前面 */
function setMeta(html: string, key: 'name' | 'property', id: string, content: string): string {
  const tag = `<meta ${key}="${id}" content="${escape(content)}" />`
  // id 只有英數、冒號（description、og:title、twitter:card），不必跳脫
  const existing = new RegExp(`<meta ${key}="${id}" content="[^"]*"\\s*/?>`)
  return existing.test(html) ? html.replace(existing, () => tag) : html.replace('</head>', () => `  ${tag}\n  </head>`)
}

/**
 * shell：建置好的 index.html；siteUrl：網站的正式網址，結尾有 /（例如 https://longdong.web.app/）
 */
export function sharePageHtml(ref: RouteRef, siteUrl: string, shell: string): string {
  const { title, description } = sharePreview(ref)
  const url = siteUrl + sharePagePath(ref.route.id)
  let html = shell.replace(/<title>[^<]*<\/title>/, () => `<title>${escape(title)}｜${escape(t('app.title'))}</title>`)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', url)
  html = setMeta(html, 'property', 'og:image', `${siteUrl}icons/icon-512.png`)
  html = setMeta(html, 'name', 'twitter:card', 'summary')
  return html.replace('</head>', () => `  <link rel="canonical" href="${escape(url)}" />\n  </head>`)
}
