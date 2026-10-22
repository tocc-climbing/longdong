import { describe, expect, it } from 'vitest'
import type { RouteRef } from '../src/data/dataset'
import { sharePageHtml, sharePreview } from '../scripts/lib/sharePages'

const SITE = 'https://longdong.web.app/'
/** 和 index.html 一樣的開頭 */
const SHELL = `<html><head>
<meta name="description" content="網站說明" />
<meta property="og:title" content="龍洞攀岩資料庫" />
<meta property="og:description" content="網站說明" />
<meta property="og:image" content="https://longdong.web.app/icons/icon-512.png" />
<title>龍洞攀岩資料庫</title>
</head><body><div id="root"></div></body></html>`
const ref = (route: Record<string, unknown>, sectors = 10) => {
  const sector = { id: 'longdong/golden-valley-s1', name: { zh: '貓屋', en: 'The Cathouse' }, routes: [] }
  const area = { id: 'longdong/golden-valley', name: { zh: '黃金谷', en: 'Golden Valley' }, sectors: Array(sectors).fill(sector) }
  return {
    route: { id: 'longdong/jar2yu', name: { zh: '拉斯塔法里海鳥', en: 'Rastafarian Seabirds' }, bolts: [], anchors: [], ...route },
    sector,
    area,
  } as unknown as RouteRef
}

describe('路線分享頁', () => {
  it('預覽卡片：標題含編號、中英名稱、難度；說明含位置、類型、高度、安全評級', () => {
    expect(sharePreview(ref({ number: '102', grade: '5.9', type: 'trad', heightM: 19, safety: 'green' }))).toEqual({
      title: '#102 拉斯塔法里海鳥 Rastafarian Seabirds 5.9',
      description: '龍洞 黃金谷 · 貓屋｜傳攀 · 19 m｜安全評級：正常',
    })
  })

  it('封閉的路線在說明加上警告；只有一個區域的大區域不重複區域名', () => {
    const { description } = sharePreview(ref({ type: 'sport', status: 'closed', statusLabel: '路線封閉' }, 1))
    expect(description).toBe('龍洞 黃金谷｜運攀｜⚠ 路線封閉')
  })

  it('頁面：App 本身（index.html）換上路線的標題、說明與完整網址，不再轉址', () => {
    const html = sharePageHtml(ref({ number: '102', grade: '5.9' }), SITE, SHELL)
    expect(html).toContain('<meta property="og:url" content="https://longdong.web.app/route/longdong/jar2yu" />')
    expect(html).toContain('<meta property="og:image" content="https://longdong.web.app/icons/icon-512.png" />')
    expect(html).toContain('<meta property="og:title" content="#102 拉斯塔法里海鳥 Rastafarian Seabirds 5.9" />')
    expect(html).toContain('<link rel="canonical" href="https://longdong.web.app/route/longdong/jar2yu" />')
    expect(html).toContain('<title>#102 拉斯塔法里海鳥 Rastafarian Seabirds 5.9｜龍洞攀岩資料庫</title>')
    // 只換掉一份，沒有重複的 og:title；App 的內容保留
    expect(html.match(/og:title/g)).toHaveLength(1)
    expect(html).toContain('<div id="root"></div>')
    expect(html).not.toContain('http-equiv="refresh"')
  })

  it('有分享圖片時：og:image 換成這條路線的圖片、大圖預覽', () => {
    const html = sharePageHtml(ref({ number: '102', grade: '5.9' }), SITE, SHELL, true)
    expect(html).toContain('<meta property="og:image" content="https://longdong.web.app/og/longdong/jar2yu.png" />')
    expect(html).toContain('<meta property="og:image:width" content="1200" />')
    expect(html).toContain('<meta property="og:image:height" content="630" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html.match(/property="og:image"/g)).toHaveLength(1)
  })

  it('名稱裡的特殊字元會跳脫，不會破壞頁面', () => {
    const html = sharePageHtml(ref({ name: { zh: '"<b>&' } }), SITE, SHELL)
    expect(html).toContain('content="&quot;&lt;b&gt;&amp;')
    expect(html).not.toContain('"<b>&')
  })
})
