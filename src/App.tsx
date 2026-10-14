import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { BottomNav } from './components/BottomNav'
import { Sidebar } from './components/Sidebar'
import { useData, type LoadedData } from './data/dataset'
import { relativeTime } from './format'
import { localName, useLang, type Lang } from './i18n'
import { defaultLevel, keyNav, type Level } from './keyboard'
import { useWide } from './layout'
import { AboutPage } from './pages/AboutPage'
import { AreaPage, SectorPage } from './pages/AreaPage'
import { HomePage } from './pages/HomePage'
import { MePage } from './pages/MePage'
import { RescuePage } from './pages/RescuePage'
import { RoutePage } from './pages/RoutePage'
import { SearchPage } from './pages/SearchPage'
import { loadRatings, useSocial } from './social/store'
import { href, RouteLinkContext, usePage, withDetail, type Page, type RouteLink } from './router'
import { useListView } from './listView'
import { routeKey, summarize } from './social/model'
import { neighbors, useSwipe, type Dir, type Neighbor, type Neighbors } from './swipe'

export function App() {
  const page = usePage()
  const state = useData()
  const wide = useWide()
  const { lang, t } = useLang()
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  // 評分（路線清單顯示平均星等）在背景載入；離線時用 Service Worker 快取的上一份
  useEffect(() => {
    void loadRatings()
  }, [])

  const data = state.status === 'ready' ? state.data : undefined
  const view = useMemo(() => (data && wide ? desktopView(page, data) : undefined), [page, data, wide])
  const routeLink = useMemo<RouteLink>(
    () =>
      view
        ? { link: (id) => (page.name === 'route' ? href.route(id) : withDetail(location.hash || '#/', id)), selected: view.detail }
        : { link: href.route },
    [view, page],
  )
  const kbdLevel = useDesktopKeys(wide, view, page, data)

  // 手機版：區域頁、路線頁左右滑動切換；拖曳時畫面跟著手指，側邊提示放開後會去哪裡；
  // slide 讓新頁面從滑動的方向進來
  const listView = useListView()
  const ratings = useSocial().ratings
  const near =
    data && !wide && !page.detail
      ? neighbors(page, data, { view: listView, ratingOf: (id) => summarize(ratings[routeKey(id)])?.average })
      : undefined
  const [slide, setSlide] = useState<{ dir: Dir; n: number }>()
  const go = (dir: Dir) => setSlide((s) => ({ dir, n: (s?.n ?? 0) + 1 }))
  const swipeArea = useRef<HTMLElement>(null)
  const swipeMoving = useRef<HTMLDivElement>(null)
  const [dragDir, setDragDir] = useState<Dir | null>(null)
  const [armed, setArmed] = useState(false)
  useSwipe(!!near, swipeArea, swipeMoving, {
    can: (dir) => !!near?.[dir],
    onLock: setDragDir,
    onArmed: setArmed,
    onCommit: (dir) => {
      const target = near?.[dir]
      if (!target) return
      go(dir)
      location.hash = target.hash
    },
  })
  const dragTarget = dragDir ? near?.[dragDir] : undefined

  const banner = needRefresh && (
    <div className="banner">
      {t('app.updateAvailable')}
      <button onClick={() => updateServiceWorker(true)}>{t('app.update')}</button>
    </div>
  )

  const content: ReactNode =
    state.status === 'loading' ? (
      <p className="empty muted">{t('app.loading')}</p>
    ) : state.status === 'error' ? (
      <div className="empty">
        <p>{t('app.loadError', { error: state.error })}</p>
        <p className="muted small">{t('app.firstUseNeedsNetwork')}</p>
      </div>
    ) : view?.split ? (
      <>
        <div className="list-pane">
          <PageView page={view.list} data={state.data} />
        </div>
        <DetailPane data={state.data} id={view.detail} closeHref={view.closeHref} />
      </>
    ) : !wide && page.detail ? (
      // 電腦版分享的「清單＋路線」網址，在手機上直接顯示路線頁
      <RoutePage data={state.data} id={page.detail} />
    ) : (
      <PageView page={page} data={state.data} />
    )

  const footer = data && page.name === 'home' && (
    <footer className="footer muted small">
      {t('footer.updated', { time: relativeTime(data.dataset.updatedAt, t) })}
      {offlineReady || navigator.serviceWorker?.controller ? ` · ${t('footer.offlineReady')}` : ''}
      <br />
      {t('footer.source')}
      <a href={data.dataset.source.projectUrl} target="_blank" rel="noreferrer">
        {data.dataset.source.attribution}
      </a>
      <br />
      {t('footer.disclaimer')} · <a href={href.about()}>{t('footer.about')}</a>
    </footer>
  )

  if (wide) {
    return (
      <RouteLinkContext.Provider value={routeLink}>
        <div className="shell">
          <Sidebar page={page} data={data} kbdLevel={kbdLevel} />
          <div className={`shell-main${view?.split ? ' split' : ''}`}>
            {banner}
            <main className={view?.split ? 'split' : view?.roomy ? 'roomy' : undefined}>{content}</main>
            {footer}
          </div>
        </div>
      </RouteLinkContext.Provider>
    )
  }

  return (
    <RouteLinkContext.Provider value={routeLink}>
      <header className="topbar">
        <a className="brand" href={href.home()}>
          <span className="brand-mark" aria-hidden>
            LD
          </span>
          {t('app.title')}
        </a>
      </header>
      {banner}
      <main ref={swipeArea}>
        <div ref={swipeMoving} key={slide?.n} className={slide ? `slide-${slide.dir}` : undefined}>
          {content}
          {near && <Pager near={near} onGo={go} />}
        </div>
      </main>
      {dragDir && dragTarget && (
        <div className={`swipe-hint ${dragDir}${armed ? ' armed' : ''}`} aria-hidden>
          {dragDir === 'prev' ? `‹ ${neighborLabel(dragTarget, lang)}` : `${neighborLabel(dragTarget, lang)} ›`}
        </div>
      )}
      {footer}
      <BottomNav page={page} />
    </RouteLinkContext.Provider>
  )
}

function PageView({ page, data }: { page: Page; data: LoadedData }) {
  switch (page.name) {
    case 'area':
      return <AreaPage key={page.id} data={data} id={page.id} />
    case 'sector':
      return <SectorPage key={page.id} data={data} id={page.id} />
    case 'route':
      return <RoutePage data={data} id={page.id} />
    case 'search':
      return <SearchPage data={data} query={page.q} detail={page.detail} />
    case 'me':
      return <MePage data={data} />
    case 'rescue':
      return <RescuePage data={data} areaKey={page.id} />
    case 'about':
      return <AboutPage data={data} />
    default:
      return <HomePage data={data} />
  }
}

/** 上一個／下一個的名稱；路線加上編號 */
function neighborLabel(n: Neighbor, lang: Lang): string {
  return `${n.number ? `#${n.number} ` : ''}${localName(n.name, lang).main}`
}

/** 手機版區域頁、路線頁底部的上一個／下一個；也提示可以左右滑動 */
function Pager({ near, onGo }: { near: Neighbors; onGo: (dir: Dir) => void }) {
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

interface DesktopView {
  /** 清單與路線並排 */
  split: boolean
  /** 左邊的清單 */
  list: Page
  /** 右邊的路線；沒有時顯示提示 */
  detail?: string
  /** 關閉右邊路線的連結 */
  closeHref: string
  /** 不並排時用較寬的版面（首頁、分區卡片、我的） */
  roomy: boolean
}

/**
 * 電腦版的版面：
 * - 分區、只有一個分區的區域：路線清單＋右邊的路線（沒選時顯示提示）
 * - 路線頁：該路線所在的分區清單＋右邊的路線
 * - 搜尋、我的：選了路線（?r=）才並排
 */
function desktopView(page: Page, data: LoadedData): DesktopView {
  const plain = (roomy: boolean): DesktopView => ({ split: false, list: page, closeHref: '', roomy })
  if (page.name === 'route') {
    const ref = data.routeById.get(page.id)
    if (!ref) return plain(false)
    return { split: true, list: { name: 'sector', id: ref.sector.id }, detail: page.id, closeHref: href.sector(ref.sector.id), roomy: false }
  }
  const closeHref = withDetail(location.hash || '#/', undefined)
  const routeList = page.name === 'sector' || (page.name === 'area' && data.areaById.get(page.id)?.sectors.length === 1)
  if (routeList || page.detail) return { split: true, list: page, detail: page.detail, closeHref, roomy: false }
  return plain(page.name === 'home' || page.name === 'area' || page.name === 'me')
}

function DetailPane({ data, id, closeHref }: { data: LoadedData; id?: string; closeHref: string }) {
  const { t } = useLang()
  const pane = useRef<HTMLElement>(null)
  useEffect(() => {
    pane.current?.scrollTo(0, 0)
  }, [id])

  if (!id) {
    return (
      <aside className="detail-pane detail-empty">
        <p className="muted">{t('layout.pickRoute')}</p>
        <p className="muted small">{t('layout.keys')}</p>
      </aside>
    )
  }
  return (
    <aside className="detail-pane" ref={pane} aria-label={t('layout.detail')}>
      <a className="icon-button detail-close" href={closeHref} aria-label={t('layout.close')} title={t('layout.close')}>
        ×
      </a>
      <RoutePage data={data} id={id} />
    </aside>
  )
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * 電腦版快捷鍵：/ 搜尋、Esc 關閉右邊的路線、↑↓ 在目前層級內移動、←→ 切換層級（大區域／區域／路線）。
 * 回傳用鍵盤選定的層級（用滑鼠點選或換頁後清除），側欄依此標示目前的位置。
 */
function useDesktopKeys(wide: boolean, view: DesktopView | undefined, page: Page, data: LoadedData | undefined): Level | null {
  const [level, setLevel] = useState<Level | null>(null)
  const current = useRef({ view, page, data, level })
  current.current = { view, page, data, level }
  // 方向鍵造成的換頁不清除層級；其他換頁（點選、Esc、返回）清除
  const fromKeys = useRef(false)
  useEffect(() => {
    if (fromKeys.current) fromKeys.current = false
    else setLevel(null)
  }, [page])

  useEffect(() => {
    if (!wide) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const { view: v, page: p, data: d, level: l } = current.current
      if (e.key === 'Escape') {
        if (typing(e.target)) (e.target as HTMLElement).blur()
        else if (v?.detail) location.hash = v.closeHref
        return
      }
      if (typing(e.target)) return
      if (e.key === '/') {
        e.preventDefault()
        document.getElementById('sidebar-search')?.focus()
        return
      }
      if (!d || !e.key.startsWith('Arrow')) return
      const rows = [...document.querySelectorAll<HTMLAnchorElement>('main a.route-row')]
      const result = keyNav(e.key, {
        page: p,
        level: l ?? defaultLevel(p, d),
        data: d,
        rows: rows.map((r) => r.getAttribute('href')!),
        selected: rows.findIndex((r) => r.getAttribute('aria-current') === 'true'),
      })
      if (!result) return
      e.preventDefault()
      setLevel(result.level)
      if (result.row !== undefined) rows[result.row].scrollIntoView({ block: 'nearest' })
      if (result.hash && result.hash !== location.hash) {
        fromKeys.current = true
        location.replace(result.hash)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wide])

  return wide ? level : null
}
