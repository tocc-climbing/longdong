import type { CSSProperties } from 'react'
import { localName, useLang, type Lang } from '../i18n'
import type { Dir, Neighbor, Neighbors } from '../swipe'

/** 上一個／下一個的名稱；路線加上編號 */
export function neighborLabel(n: Neighbor, lang: Lang): string {
  return `${n.number ? `#${n.number} ` : ''}${localName(n.name, lang).main}`
}

/** 上一區／下一區的卡片用那一區的顏色（路線沒有顏色） */
export const neighborStyle = (n: Neighbor) => (n.color ? ({ '--area-color': n.color } as CSSProperties) : undefined)

/**
 * 手機版區域、分區頁底部的上一區／下一區（用那一區的顏色）；也提示可以左右滑動。
 * 路線頁沒有：整頁是一張路線卡片，左右滑動換到上一張、下一張。
 */
export function Pager({ near, onGo }: { near: Neighbors; onGo: (dir: Dir) => void }) {
  const { lang, t } = useLang()
  const label = (n: Neighbor) => neighborLabel(n, lang)
  const caption = (dir: 'prev' | 'next') => (dir === 'prev' ? `‹ ${t('swipe.prev')}` : `${t('swipe.next')} ›`)
  return (
    <nav className="pager" aria-label={t('swipe.aria')}>
      {near.prev ? (
        <a href={near.prev.hash} className={near.prev.color ? 'colored' : undefined} style={neighborStyle(near.prev)} onClick={() => onGo('prev')}>
          <span className="pager-name muted small">{caption('prev')}</span>
          <span className="pager-name">{label(near.prev)}</span>
        </a>
      ) : (
        <span />
      )}
      {near.next ? (
        <a href={near.next.hash} className={near.next.color ? 'next colored' : 'next'} style={neighborStyle(near.next)} onClick={() => onGo('next')}>
          <span className="pager-name muted small">{caption('next')}</span>
          <span className="pager-name">{label(near.next)}</span>
        </a>
      ) : (
        <span />
      )}
      <p className="pager-hint muted small">{t('swipe.hint')}</p>
    </nav>
  )
}
