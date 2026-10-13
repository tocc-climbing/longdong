import { describe, expect, it } from 'vitest'
import type { RouteRef } from '../src/data/dataset'
import { translate } from '../src/i18n'
import { routeUrl, shareText } from '../src/share'

const ref = (sectors: number, number?: string, grade?: string) => {
  const sector = { id: 'longdong/golden-valley-s1', name: { zh: '貓屋', en: 'The Cathouse' }, routes: [] }
  const area = { id: 'longdong/golden-valley', name: { zh: '黃金谷', en: 'Golden Valley' }, sectors: Array(sectors).fill(sector) }
  const route = { id: 'longdong/jar2yu', number, grade, name: { zh: '拉斯塔法里海鳥', en: 'Rastafarian Seabirds' } }
  return { route, sector, area } as unknown as RouteRef
}

describe('分享路線', () => {
  it('完整網址：App 位址加上路線的 hash，去掉目前的 hash 與查詢字串', () => {
    expect(routeUrl('https://tocc-climbing.github.io/longdong/', 'longdong/jar2yu')).toBe('https://tocc-climbing.github.io/longdong/#/route/longdong/jar2yu')
    expect(routeUrl('https://tocc-climbing.github.io/longdong/#/me', 'longdong/jar2yu')).toBe('https://tocc-climbing.github.io/longdong/#/route/longdong/jar2yu')
  })

  it('分享文字：編號、名稱、難度、岩場與區域', () => {
    const zh = (k: Parameters<typeof translate>[1]) => translate('zh', k)
    const en = (k: Parameters<typeof translate>[1]) => translate('en', k)
    expect(shareText(ref(10, '102', '5.9'), 'zh', zh)).toBe('#102 拉斯塔法里海鳥 5.9｜龍洞 黃金谷 · 貓屋')
    expect(shareText(ref(10, '102', '5.9'), 'en', en)).toBe('#102 Rastafarian Seabirds 5.9｜Long Dong Golden Valley · The Cathouse')
  })

  it('沒有編號、難度時省略；只有一個區域的大區域不重複區域名', () => {
    const zh = (k: Parameters<typeof translate>[1]) => translate('zh', k)
    expect(shareText(ref(1), 'zh', zh)).toBe('拉斯塔法里海鳥｜龍洞 黃金谷')
  })
})
