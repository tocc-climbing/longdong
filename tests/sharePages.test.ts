import { describe, expect, it } from 'vitest'
import type { RouteRef } from '../src/data/dataset'
import { sharePageHtml, sharePreview } from '../scripts/lib/sharePages'

const SITE = 'https://tocc-climbing.github.io/longdong/'
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

  it('頁面：Open Graph 用完整網址，開啟時轉到 App 的路線頁', () => {
    const html = sharePageHtml(ref({ number: '102', grade: '5.9' }), SITE)
    expect(html).toContain('<meta property="og:url" content="https://tocc-climbing.github.io/longdong/route/longdong/jar2yu/" />')
    expect(html).toContain('<meta property="og:image" content="https://tocc-climbing.github.io/longdong/icons/icon-512.png" />')
    expect(html).toContain('<meta property="og:title" content="#102 拉斯塔法里海鳥 Rastafarian Seabirds 5.9" />')
    // route/longdong/jar2yu/ 往上三層回到 App
    expect(html).toContain('location.replace("../../../#/route/longdong/jar2yu")')
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=../../../#/route/longdong/jar2yu" />')
  })

  it('名稱裡的特殊字元會跳脫，不會破壞頁面', () => {
    const html = sharePageHtml(ref({ name: { zh: '"<b>&' } }), SITE)
    expect(html).toContain('content="&quot;&lt;b&gt;&amp;')
    expect(html).not.toContain('"<b>&')
  })
})
