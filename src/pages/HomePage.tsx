import type { LoadedData } from '../data/dataset'
import { GradeDistribution } from '../components/Charts'
import { InstallBanner } from '../components/InstallPrompt'
import { RescueEntry } from '../components/RescueButton'
import { gradeDistribution, typeSummary } from '../format'
import { href } from '../router'
import { localName, useLang } from '../i18n'

/** 首頁：龍洞的各區域，一區一列；左框用 Sheet 上該區域的顏色 */
export function HomePage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const crag = localName(data.dataset.crag.name, lang)
  const routeCount = data.dataset.areas.flatMap((a) => a.sectors.flatMap((s) => s.routes)).filter((r) => !r.isFixture).length
  return (
    <>
      {/* 標題區（TOCC 風格的漸層色塊）：岩場名稱（中英）與規模；App 名稱已在頂欄、側欄，這裡不重複 */}
      <section className="home-hero">
        <h1>
          {crag.main}
          {crag.sub && <span className="hero-en">{crag.sub}</span>}
        </h1>
        <p>{t('home.heroStats', { areas: data.dataset.areas.length, routes: routeCount })}</p>
        <a className="hero-search" href={href.search()}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path
              d="M10.5 4a6.5 6.5 0 1 0 4.04 11.6l4.43 4.43 1.41-1.41-4.43-4.43A6.5 6.5 0 0 0 10.5 4zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"
              fill="currentColor"
            />
          </svg>
          {t('search.placeholder')}
        </a>
      </section>
      <InstallBanner />
      <RescueEntry />
      <ul className="area-list">
        {data.dataset.areas.map((area) => {
          const routes = area.sectors.flatMap((s) => s.routes).filter((r) => !r.isFixture)
          const name = localName(area.name, lang)
          return (
            <li key={area.id}>
              <a className="area-row" href={href.area(area.id)} style={{ '--area-color': area.color } as React.CSSProperties}>
                <span className="area-info">
                  <span className="area-name">{name.main}</span>
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
