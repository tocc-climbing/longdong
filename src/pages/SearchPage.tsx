import { useEffect, useMemo, useRef } from 'react'
import type { LoadedData } from '../data/dataset'
import { RouteRow } from '../components/RouteRow'
import { useWide } from '../layout'
import { href, replaceHash } from '../router'
import { buildIndex, search } from '../search'
import { useLang } from '../i18n'

const MAX_RESULTS = 100
const EXAMPLES = { zh: ['5.10a', '黃金谷', 'Olive Branch', '523'], en: ['5.10a', 'Golden Valley', 'Olive Branch', '523'] }

/** 搜尋字串放在網址（#/search?q=），從路線頁按返回時結果還在；電腦版的搜尋框在左側欄 */
export function SearchPage({ data, query, detail }: { data: LoadedData; query: string; detail?: string }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const input = useRef<HTMLInputElement>(null)
  const index = useMemo(() => buildIndex(data.routes), [data])
  const results = useMemo(() => {
    const found = search(index, query).map((id) => data.routeById.get(id)!)
    // 查難度（例如 5.12）時，依難度排序比依相關度直覺
    if (/^5\.\d/.test(query.trim())) found.sort((a, b) => (a.route.gradeValue ?? 99) - (b.route.gradeValue ?? 99))
    return found
  }, [index, query, data])

  useEffect(() => {
    if (!query) (wide ? document.getElementById('sidebar-search') : input.current)?.focus()
  }, [query, wide])

  const onChange = (q: string) => replaceHash(href.search(q, detail))

  return (
    <>
      {!wide && (
        <div className="search">
          <input
            ref={input}
            type="search"
            inputMode="search"
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            value={query}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}

      {query.trim() ? (
        <section>
          <p className="muted small">
            {results.length === 0
              ? t('search.none')
              : t('search.results', { n: results.length }) + (results.length > MAX_RESULTS ? t('search.limited', { max: MAX_RESULTS }) : '')}
          </p>
          <ul className="route-list">
            {results.slice(0, MAX_RESULTS).map((item) => (
              <RouteRow key={item.route.id} item={item} showPlace />
            ))}
          </ul>
        </section>
      ) : (
        <div className="search-hints">
          <p className="muted small">{t('search.try')}</p>
          <div className="chips">
            {EXAMPLES[lang].map((q) => (
              <button key={q} className="chip" onClick={() => onChange(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
