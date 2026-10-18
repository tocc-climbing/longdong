import { describe, expect, it } from 'vitest'
import type { RouteRef } from '../src/data/dataset'
import { translate } from '../src/i18n'
import { en } from '../src/i18n/en'
import { zh } from '../src/i18n/zh'
import { routeFromSearch } from '../src/router'
import { routeUrl, shareText, targetUrl } from '../src/share'

const ref = (sectors: number, number?: string, grade?: string) => {
  const sector = { id: 'longdong/golden-valley-s1', name: { zh: '貓屋', en: 'The Cathouse' }, routes: [] }
  const area = { id: 'longdong/golden-valley', name: { zh: '黃金谷', en: 'Golden Valley' }, sectors: Array(sectors).fill(sector) }
  const route = { id: 'longdong/jar2yu', number, grade, name: { zh: '拉斯塔法里海鳥', en: 'Rastafarian Seabirds' } }
  return { route, sector, area } as unknown as RouteRef
}

describe('分享路線', () => {
  it('分享網址就是路線頁的網址（不帶 #）；網站在子路徑時也正確', () => {
    expect(routeUrl('https://longdong.web.app/', 'longdong/jar2yu')).toBe('https://longdong.web.app/route/longdong/jar2yu')
    expect(routeUrl('https://longdong.web.app', 'longdong/jar2yu')).toBe('https://longdong.web.app/route/longdong/jar2yu')
    expect(routeUrl('https://example.org/longdong/', 'longdong/jar2yu')).toBe('https://example.org/longdong/route/longdong/jar2yu')
  })

  it('之前分享出去的 ?route= 網址：從查詢字串取出路線ID，忽略 fbclid 等其他參數', () => {
    expect(routeFromSearch('?route=longdong/jar2yu')).toBe('longdong/jar2yu')
    expect(routeFromSearch('?fbclid=abc&route=longdong/jar2yu')).toBe('longdong/jar2yu')
    expect(routeFromSearch('?route=longdong%2Fjar2yu')).toBe('longdong/jar2yu')
    expect(routeFromSearch('?fbclid=abc')).toBeUndefined()
    expect(routeFromSearch('')).toBeUndefined()
  })

  it('各 App 的分享網址：LINE 帶文字與網址，Facebook／Messenger 只帶網址', () => {
    const url = 'https://longdong.web.app/route/longdong/jar2yu'
    const line = new URL(targetUrl('line', url, '#102 拉斯塔法里海鳥'))
    expect(line.origin + line.pathname).toBe('https://line.me/R/share')
    expect(line.searchParams.get('text')).toBe(`#102 拉斯塔法里海鳥
${url}`)
    expect(new URL(targetUrl('facebook', url, 'x')).searchParams.get('u')).toBe(url)
    expect(targetUrl('messenger', url, 'x')).toBe(`fb-messenger://share/?link=${encodeURIComponent(url)}`)
  })

  it('分享文字：編號、名稱、難度、岩場與區域', () => {
    const tz = (k: Parameters<typeof translate>[1]) => translate(zh, k)
    const te = (k: Parameters<typeof translate>[1]) => translate(en, k)
    expect(shareText(ref(10, '102', '5.9'), 'zh', tz)).toBe('#102 拉斯塔法里海鳥 5.9｜龍洞 黃金谷 · 貓屋')
    expect(shareText(ref(10, '102', '5.9'), 'en', te)).toBe('#102 Rastafarian Seabirds 5.9｜Long Dong Golden Valley · The Cathouse')
  })

  it('沒有編號、難度時省略；只有一個區域的大區域不重複區域名', () => {
    const tz = (k: Parameters<typeof translate>[1]) => translate(zh, k)
    expect(shareText(ref(1), 'zh', tz)).toBe('拉斯塔法里海鳥｜龍洞 黃金谷')
  })
})
