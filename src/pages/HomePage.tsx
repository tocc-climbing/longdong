import type { CSSProperties } from 'react'
import type { LoadedData } from '../data/dataset'
import { RESCUE_POINTS } from '../data/rescue'
import { CragShape } from '../components/AreaShape'
import { GradeDistribution } from '../components/Charts'
import { GradePill } from '../components/GradePill'
import { PageHero } from '../components/PageHero'
import { FavMark } from '../components/FavMark'
import { InstallBanner } from '../components/InstallPrompt'
import { gradeDistribution, typeSummary } from '../format'
import { useWide } from '../layout'
import { favoritesFirst } from '../personal/model'
import { recentVisits } from '../personal/stats'
import { usePersonal } from '../personal/store'
import { href, useRouteLink } from '../router'
import { sunTimes } from '../sun'
import { useWeather } from '../weather'
import { LOCALES, localName, useLang } from '../i18n'

/** 首頁標題卡的顏色：岩石的灰藍，和各區域的顏色（音樂廳是藍色）都不同 */
const CRAG_COLOR = '#8fa3b0'

/** 天氣、日出日落、導航的位置：岩場入口（救援點 #2） */
const ENTRANCE = (() => {
  const coords = RESCUE_POINTS.find((p) => p.key === '2')?.coords
  if (!coords) throw new Error('救援資料缺少岩場入口（#2）的座標')
  return coords
})()

/** 最近去過列幾天 */
const RECENT_DAYS = 3

/**
 * 首頁：標題卡（整個龍洞的地圖），下面是各區域，一區一列（收藏的排在前面）；色點用 Sheet 上該區域的顏色。
 * 手機版是出發前看的那一頁：標題卡和天氣、日出日落、交通、最近去過連成一張卡片（和路線卡片同樣子）
 */
export function HomePage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const favorites = usePersonal().favorites
  const crag = localName(data.dataset.crag.name, lang)
  const routeCount = data.dataset.areas.flatMap((a) => a.sectors.flatMap((s) => s.routes)).filter((r) => !r.isFixture).length
  const hero = (
    <PageHero
      crumbs={crag.sub ? [{ label: crag.sub }] : []}
      color={CRAG_COLOR}
      name={crag.main}
      sub={t('home.heroStats', { areas: data.dataset.areas.length, routes: routeCount })}
      shape={<CragShape data={data} className="area-hero-shape" />}
      strip
    />
  )
  return (
    <>
      {wide ? (
        hero
      ) : (
        <article className="route-m home-m" style={{ '--area-color': CRAG_COLOR } as CSSProperties}>
          {hero}
          <Today />
          <Transport />
          <RecentVisits data={data} />
        </article>
      )}
      <InstallBanner />
      <ul className="area-list">
        {favoritesFirst(data.dataset.areas, favorites).map((area) => {
          const routes = area.sectors.flatMap((s) => s.routes).filter((r) => !r.isFixture)
          const name = localName(area.name, lang)
          return (
            <li key={area.id}>
              <a className="area-row" href={href.area(area.id)} style={{ '--area-color': area.color } as React.CSSProperties}>
                <span className="area-info">
                  <span className="area-name">
                    {name.main}
                    {favorites.has(area.id) && <FavMark />}
                  </span>
                  {name.sub && <span className="en">{name.sub}</span>}
                  <span className="area-count">
                    <span className="nowrap">{t('count.routes', { n: routes.length })}</span>
                    {/* 空白放在 nowrap 外面：寬度不夠（例如 360px 寬的手機）時「· 6 個分區」換到下一行，不會壓到右邊的圖表 */}
                    {area.sectors.length > 1 && (
                      <>
                        {' '}
                        <span className="muted nowrap">· {t('count.sectors', { n: area.sectors.length })}</span>
                      </>
                    )}
                  </span>
                  <span className="area-types">{typeSummary(routes, t)}</span>
                </span>
                <GradeDistribution bands={gradeDistribution(routes)} />
              </a>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** 龍洞的時間（台北時間）：HH:mm */
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** 龍洞今天的日期 YYYY-MM-DD */
const todayInTaipei = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())

/** 天氣（目前與接下來 12 小時，每兩小時一格）與日出日落；日出日落在裝置上算，沒有網路也有 */
function Today() {
  const { t } = useLang()
  const weather = useWeather(ENTRANCE)
  const sun = sunTimes(todayInTaipei(), ENTRANCE)
  return (
    <section className="route-block home-today" aria-label={t('home.weather')}>
      {weather.status === 'ready' && (
        <>
          <div className="weather-now">
            <strong className="weather-temp">{Math.round(weather.weather.temp)}°</strong>
            <span className="weather-desc">
              <span className="weather-cond">{t(`weather.${weather.weather.condition}`)}</span>
              <span className="muted small">
                {t('home.wind', { wind: Math.round(weather.weather.wind), gust: Math.round(weather.weather.gust) })} ·{' '}
                {t('home.humidity', { n: weather.weather.humidity })}
              </span>
            </span>
          </div>
          <ol className="weather-hours">
            {weather.weather.hours
              .filter((_, i) => i % 2 === 0)
              .map((h) => (
                <li key={h.time} title={t(`weather.${h.condition}`)}>
                  <span className="muted small">{h.time.slice(11, 16)}</span>
                  <strong>{Math.round(h.temp)}°</strong>
                  <span className={`weather-rain${h.rain >= 30 ? ' wet' : ''}`}>{h.rain}%</span>
                </li>
              ))}
          </ol>
        </>
      )}
      {weather.status === 'error' && <p className="small error">{t('home.weatherError')}</p>}
      <p className="sun-times">
        <span>
          <span className="muted">{t('home.sunrise')}</span> <strong>{clock.format(sun.rise)}</strong>
        </span>
        <span>
          <span className="muted">{t('home.sunset')}</span> <strong>{clock.format(sun.set)}</strong>
        </span>
      </p>
      {weather.status === 'ready' && <p className="muted small weather-source">{t('home.weatherSource', { time: weather.weather.time.slice(11, 16) })}</p>}
    </section>
  )
}

/** 交通：Google 地圖的路線規劃（開車的有即時路況），目的地是岩場入口 */
function Transport() {
  const { t } = useLang()
  const directions = (mode: 'driving' | 'transit') =>
    `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: ENTRANCE.join(','), travelmode: mode })}`
  return (
    <section className="route-block home-transport">
      <h2>{t('home.transport')}</h2>
      <div className="home-links">
        <a className="action" href={directions('driving')} target="_blank" rel="noopener noreferrer">
          {t('home.drive')}
        </a>
        <a className="action" href={directions('transit')} target="_blank" rel="noopener noreferrer">
          {t('home.transit')}
        </a>
      </div>
    </section>
  )
}

/** 最近去過的幾天與那天爬的路線；沒有攀登紀錄時不顯示 */
function RecentVisits({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const { ticks } = usePersonal()
  const { link } = useRouteLink()
  if (ticks.length === 0) return null
  const day = new Intl.DateTimeFormat(LOCALES[lang], { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: 'short' })
  return (
    <section className="route-block home-recent">
      <h2 className="home-recent-head">
        {t('home.recent')}
        <a className="small" href={href.me()}>
          {t('home.recentAll')} ›
        </a>
      </h2>
      {recentVisits(ticks, RECENT_DAYS).map((visit) => (
        <section key={visit.key} className="timeline">
          <h3>{day.format(new Date(`${visit.key}T00:00Z`))}</h3>
          <ul className="list-card">
            {visit.ticks.map((tick) => {
              const r = data.routeById.get(tick.routeId)?.route
              return (
                <li key={tick.id} className="timeline-item">
                  <a className="timeline-body" href={link(tick.routeId)}>
                    <span className="timeline-title">
                      {r ? `${r.number ? `#${r.number} ` : ''}${localName(r.name, lang).main}` : t('me.routeMissing', { id: tick.routeId })}
                    </span>
                    <span className="timeline-meta">
                      <span className={`style-tag style-${tick.style}`}>{t(`style.${tick.style}`)}</span>
                    </span>
                  </a>
                  <GradePill grade={r?.grade} value={r?.gradeValue} size="sm" />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </section>
  )
}
