import type { RouteRef } from '../../src/data/dataset'
import { typeText } from '../../src/format'
import { localName, translate } from '../../src/i18n'
import { zh } from '../../src/i18n/zh'
import { sharePagePath } from '../../src/share'
import { OG_SIZE } from './ogImage'

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

/** 有自己分享圖片的頁面：網址路徑、預覽卡片的標題與說明 */
export interface SharePage {
  path: string
  title: string
  description: string
}

/** 地圖、路線清單的分享頁（dist/<path>.html）與圖片（og/<path>.png） */
export function pageShareHtml(page: SharePage, siteUrl: string, shell: string): string {
  const url = siteUrl + page.path
  let html = shell.replace(/<title>[^<]*<\/title>/, () => `<title>${escape(page.title)}｜${escape(t('app.title'))}</title>`)
  html = setMeta(html, 'name', 'description', page.description)
  html = setMeta(html, 'property', 'og:title', page.title)
  html = setMeta(html, 'property', 'og:description', page.description)
  html = setMeta(html, 'property', 'og:url', url)
  html = withImageMeta(html, `${siteUrl}og/${page.path}.png`, page.title)
  return html.replace('</head>', () => `  <link rel="canonical" href="${escape(url)}" />\n  </head>`)
}

/** 大圖預覽：og:image（1200×630）與 summary_large_image */
function withImageMeta(html: string, image: string, alt: string): string {
  html = setMeta(html, 'property', 'og:image', image)
  html = setMeta(html, 'property', 'og:image:width', String(OG_SIZE.w))
  html = setMeta(html, 'property', 'og:image:height', String(OG_SIZE.h))
  html = setMeta(html, 'property', 'og:image:alt', alt)
  return setMeta(html, 'name', 'twitter:card', 'summary_large_image')
}

/** 路線的分享圖片（scripts/lib/ogImage.ts）放在網站的這個路徑 */
export function ogImagePath(routeId: string): string {
  return `og/${routeId}.png`
}

/**
 * shell：建置好的 index.html；siteUrl：網站的正式網址，結尾有 /（例如 https://longdong.web.app/）
 * withImage：有這條路線的分享圖片（大圖預覽）；沒有時用網站圖示
 */
export function sharePageHtml(ref: RouteRef, siteUrl: string, shell: string, withImage = false): string {
  const { title, description } = sharePreview(ref)
  const url = siteUrl + sharePagePath(ref.route.id)
  let html = shell.replace(/<title>[^<]*<\/title>/, () => `<title>${escape(title)}｜${escape(t('app.title'))}</title>`)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', url)
  if (withImage) {
    html = withImageMeta(html, siteUrl + ogImagePath(ref.route.id), title)
  } else {
    html = setMeta(html, 'property', 'og:image', `${siteUrl}icons/icon-512.png`)
    html = setMeta(html, 'name', 'twitter:card', 'summary')
  }
  return html.replace('</head>', () => `  <link rel="canonical" href="${escape(url)}" />\n  </head>`)
}
