import { useEffect, useMemo, useRef } from 'react'
import type { LoadedData } from '../data/dataset'
import { RouteList } from '../components/RouteList'
import { useWide } from '../layout'
import { href, navigate } from '../router'
import { buildIndex, search } from '../search'
import { useLang, type Lang } from '../i18n'

const MAX_RESULTS = 100
const EXAMPLES: Record<Lang, string[]> = {
  zh: ['5.10a', '黃金谷', 'Olive Branch', '523'],
  en: ['5.10a', 'Golden Valley', 'Olive Branch', '523'],
  // 日文的「黄」與路線資料的「黃」是不同字，用英文名稱當例子
  ja: ['5.10a', 'Golden Valley', 'Olive Branch', '523'],
}

/** 搜尋字串放在網址（/search?q=），從路線頁按返回時結果還在；電腦版的搜尋框在左側欄 */
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

  const onChange = (q: string) => navigate(href.search(q, detail), { replace: true })

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
          <p className="muted small">{results.length === 0 ? t('search.none') : t('search.results', { n: results.length })}</p>
          {results.length > 0 && <RouteList items={results} showPlace defaultLabel="list.sort.relevance" limit={MAX_RESULTS} />}
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
