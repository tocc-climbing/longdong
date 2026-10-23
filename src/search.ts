import MiniSearch from 'minisearch'
import type { LoadedData, RouteRef } from './data/dataset'

const CJK_RUN = /[㐀-鿿豈-﫿]+/g

/**
 * 中文沒有空白分詞，所以中文字串拆成單字加雙字（bigram），
 * 英文和數字照空白、標點切開。查詢字串用同一套規則。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const normalized = text.normalize('NFKC').toLowerCase()
  for (const run of normalized.match(CJK_RUN) ?? []) {
    const chars = [...run]
    tokens.push(...chars)
    for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1])
  }
  const latin = normalized.replace(CJK_RUN, ' ')
  for (const word of latin.split(/[^\p{L}\p{N}.]+/u)) {
    const w = word.replace(/^\.+|\.+$/g, '')
    if (w) tokens.push(w)
  }
  return tokens
}

interface Doc {
  id: string
  number: string
  name: string
  place: string
  people: string
  grade: string
}

export function buildIndex(routes: RouteRef[]): MiniSearch<Doc> {
  const index = new MiniSearch<Doc>({
    fields: ['number', 'name', 'place', 'people', 'grade'],
    storeFields: [],
    tokenize,
    searchOptions: {
      tokenize,
      boost: { number: 4, name: 3, grade: 2, place: 1, people: 1 },
      prefix: (term) => /^[a-z0-9]/.test(term) && term.length >= 2,
      combineWith: 'AND',
    },
  })
  index.addAll(
    routes.map(({ route, sector, area }) => ({
      id: route.id,
      number: route.number ?? '',
      name: [route.name.zh, route.name.en].filter(Boolean).join(' '),
      place: [area.name.zh, area.name.en, sector.name.zh, sector.name.en].filter(Boolean).join(' '),
      people: route.firstAscent ?? '',
      grade: route.grade ?? '',
    })),
  )
  return index
}

const indexes = new WeakMap<LoadedData, MiniSearch<Doc>>()

/** 每份資料只建一次搜尋索引（600 多條路線約 40ms），不在每次打開搜尋頁時重建 */
export function searchIndex(data: LoadedData): MiniSearch<Doc> {
  let index = indexes.get(data)
  if (!index) {
    index = buildIndex(data.routes)
    indexes.set(data, index)
  }
  return index
}

export function search(index: MiniSearch<Doc>, query: string): string[] {
  const q = query.replace(/#/g, ' ').trim()
  if (!q) return []
  return index.search(q).map((r) => r.id as string)
}
