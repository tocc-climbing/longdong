import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HoldMark } from './components/HoldMark'
import { useAppUpdate } from './appUpdate'
import { DevBadge } from './components/DevBadge'
import { Pager, neighborLabel } from './components/Pager'
import { DetailPane, desktopView, useDesktopKeys } from './desktop'
import { BottomNav, activeTab } from './components/BottomNav'
import { Sidebar } from './components/Sidebar'
import { useData, type LoadedData } from './data/dataset'
import { relativeTime } from './format'
import { whenActive } from './freshness'
import { useLang } from './i18n'
import { useWide } from './layout'
import { AboutPage } from './pages/AboutPage'
import { AreaPage, NotFound, SectorPage } from './pages/AreaPage'
import { HomePage } from './pages/HomePage'
import { MePage } from './pages/MePage'
import { RescuePage } from './pages/RescuePage'
import { RoutePage } from './pages/RoutePage'
import { SearchPage } from './pages/SearchPage'
import { loadRatings, useSocial } from './social/store'
import { here, href, legacySectorHref, navigate, RouteLinkContext, usePage, withDetail, type Page, type RouteLink } from './router'
import { useListView } from './listView'
import { routeKey, summarize } from './social/model'
import { neighbors, useSwipe, type Dir } from './swipe'
import { SimulationBanner } from './components/SimulationBanner'

/** 地圖用到的程式與資料較多，分開打包，打開地圖時才載入 */
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })))
/** Bolt 統計：手機版沒有入口 */
const BoltsPage = lazy(() => import('./pages/BoltsPage').then((m) => ({ default: m.BoltsPage })))
/** 路線清單（我的 → 路線清單） */
const ChecklistPage = lazy(() => import('./pages/ChecklistPage').then((m) => ({ default: m.ChecklistPage })))
/** 管理員的回報紀錄，只有少數人用 */
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))
/** Topo 編輯（電腦版） */
const TopoEditor = lazy(() => import('./topo/TopoEditor').then((m) => ({ default: m.TopoEditor })))

export function App() {
  const page = usePage()
  const state = useData()
  const wide = useWide()
  const { lang, t } = useLang()
  const { offlineReady, banner } = useAppUpdate()

  // 評分（路線清單顯示平均星等）在背景載入；離線時用 Service Worker 快取的上一份。
  // 從背景回來時重新讀取，看得到別人新的評分
  useEffect(() => {
    void loadRatings()
    return whenActive(() => void loadRatings(true), { gapMs: 5 * 60_000, intervalMs: 30 * 60_000 })
  }, [])

  const data = state.status === 'ready' ? state.data : undefined
  // 舊的分區網址換成現在的 ID（不新增瀏覽紀錄）；畫面更新前就換，不會閃過「找不到」
  useLayoutEffect(() => {
    const to = data && legacySectorHref(page, data.sectorIdByLegacyId)
    if (to) navigate(to, { replace: true })
  }, [page, data])
  const view = useMemo(() => (data && wide ? desktopView(page, data) : undefined), [page, data, wide])
  const routeLink = useMemo<RouteLink>(
    () =>
      view
        ? { link: (id) => (page.name === 'route' ? href.route(id) : withDetail(here(), id)), selected: view.detail }
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
      navigate(target.hash)
    },
  })
  const dragTarget = dragDir ? near?.[dragDir] : undefined

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
      <RoutePage key={page.detail} data={state.data} id={page.detail} />
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
            <SimulationBanner />
            <main className={page.name === 'map' ? 'map' : view?.split ? 'split' : view?.roomy ? 'roomy' : undefined}>{content}</main>
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
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" />
          {t('app.title')}
          <HoldMark />
          <DevBadge />
        </a>
        {/* 搜尋放在岩場頁的右上（下方的分頁換成地圖） */}
        {activeTab(page) === 'crags' && (
          <a className={`icon-button topbar-search${page.name === 'search' ? ' on' : ''}`} href={href.search()} aria-label={t('nav.search')} title={t('nav.search')}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path
                d="M10.5 4a6.5 6.5 0 1 0 4.04 11.6l4.43 4.43 1.41-1.41-4.43-4.43A6.5 6.5 0 0 0 10.5 4zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"
                fill="currentColor"
              />
            </svg>
          </a>
        )}
      </header>
      {banner}
      <SimulationBanner />
      <main ref={swipeArea} className={page.name === 'map' ? 'map' : undefined}>
        <div ref={swipeMoving} key={slide?.n} className={slide ? `slide-${slide.dir}` : undefined}>
          {content}
          {near && <Pager near={near} onGo={go} />}
        </div>
      </main>
      {dragDir && dragTarget && (
        // 上一個／下一個的卡片跟著手指從畫面邊緣滑進來（位置由 useSwipe 寫在 --swipe-dx）；拖到放開就會切換時變色
        <div className={`swipe-hint ${dragDir}${armed ? ' armed' : ''}`} aria-hidden>
          <span className="swipe-hint-caption">
            {t(near?.kind === 'route' ? (dragDir === 'prev' ? 'swipe.prevRoute' : 'swipe.nextRoute') : dragDir === 'prev' ? 'swipe.prev' : 'swipe.next')}
          </span>
          <span className="swipe-hint-name">{neighborLabel(dragTarget, lang)}</span>
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
      return <RoutePage key={page.id} data={data} id={page.id} />
    case 'search':
      return <SearchPage data={data} query={page.q} detail={page.detail} />
    case 'me':
      return <MePage data={data} />
    case 'rescue':
      return <RescuePage data={data} areaKey={page.id} />
    case 'about':
      return <AboutPage data={data} />
    case 'map':
      return (
        <Suspense>
          <MapPage data={data} simulate={page.simulate} />
        </Suspense>
      )
    case 'bolts':
      return (
        <Suspense>
          <BoltsPage data={data} />
        </Suspense>
      )
    case 'checklist':
      return (
        <Suspense>
          <ChecklistPage data={data} />
        </Suspense>
      )
    case 'admin':
      return (
        <Suspense>
          <AdminPage data={data} />
        </Suspense>
      )
    case 'reports':
      return (
        <Suspense>
          <AdminPage data={data} initialTab="map" />
        </Suspense>
      )
    case 'topo':
      return (
        <Suspense>
          <TopoEditor key={page.id} data={data} id={page.id} />
        </Suspense>
      )
    case 'notFound':
      return <NotFound />
    default:
      return <HomePage data={data} />
  }
}

