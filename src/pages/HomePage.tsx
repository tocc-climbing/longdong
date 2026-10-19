import type { LoadedData } from '../data/dataset'
import { GradeDistribution } from '../components/Charts'
import { InstallBanner } from '../components/InstallPrompt'
import { RescueEntry } from '../components/RescueButton'
import { gradeDistribution, typeSummary } from '../format'
import { href } from '../router'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'

/** 首頁：龍洞的各區域，一區一列；左框用 Sheet 上該區域的顏色 */
export function HomePage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const routeCount = data.dataset.areas.flatMap((a) => a.sectors.flatMap((s) => s.routes)).filter((r) => !r.isFixture).length
  return (
    <>
      {/* 手機版的標題區（TOCC 風格的色塊＋中英標題）；電腦版有側欄，不顯示 */}
      {!wide && (
        <section className="home-hero">
          <h1>
            {t('app.title')}
            <span className="hero-en">{t('home.heroSub')}</span>
          </h1>
          <p>{t('home.heroStats', { areas: data.dataset.areas.length, routes: routeCount })}</p>
        </section>
      )}
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
                    {area.sectors.length > 1 && <span className="muted nowrap"> · {t('count.sectors', { n: area.sectors.length })}</span>}
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
