import { localName, useLang, type Lang } from '../i18n'
import type { Dir, Neighbor, Neighbors } from '../swipe'

/** 上一個／下一個的名稱；路線加上編號 */
export function neighborLabel(n: Neighbor, lang: Lang): string {
  return `${n.number ? `#${n.number} ` : ''}${localName(n.name, lang).main}`
}

/** 手機版區域頁、路線頁底部的上一個／下一個；也提示可以左右滑動 */
export function Pager({ near, onGo }: { near: Neighbors; onGo: (dir: Dir) => void }) {
  const { lang, t } = useLang()
  const route = near.kind === 'route'
  const label = (n: Neighbor) => neighborLabel(n, lang)
  const caption = (dir: 'prev' | 'next', n: Neighbor) => {
    const text = t(route ? (dir === 'prev' ? 'swipe.prevRoute' : 'swipe.nextRoute') : dir === 'prev' ? 'swipe.prev' : 'swipe.next')
    const where = n.sector ? ` · ${localName(n.sector, lang).main}` : ''
    return dir === 'prev' ? `‹ ${text}${where}` : `${text}${where} ›`
  }
  return (
    <nav className="pager" aria-label={t(route ? 'swipe.ariaRoute' : 'swipe.aria')}>
      {near.prev ? (
        <a href={near.prev.hash} onClick={() => onGo('prev')}>
          <span className="pager-name muted small">{caption('prev', near.prev)}</span>
          <span className="pager-name">{label(near.prev)}</span>
        </a>
      ) : (
        <span />
      )}
      {near.next ? (
        <a href={near.next.hash} className="next" onClick={() => onGo('next')}>
          <span className="pager-name muted small">{caption('next', near.next)}</span>
          <span className="pager-name">{label(near.next)}</span>
        </a>
      ) : (
        <span />
      )}
      <p className="pager-hint muted small">{t(near.filtered ? 'swipe.hintFiltered' : 'swipe.hint')}</p>
    </nav>
  )
}
