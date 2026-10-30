import type { LoadedData } from '../data/dataset'
import { CragShape } from '../components/AreaShape'
import { GradeDistribution } from '../components/Charts'
import { PageHero } from '../components/PageHero'
import { FavMark } from '../components/FavMark'
import { InstallBanner } from '../components/InstallPrompt'
import { gradeDistribution, typeSummary } from '../format'
import { favoritesFirst } from '../personal/model'
import { usePersonal } from '../personal/store'
import { href } from '../router'
import { localName, useLang } from '../i18n'

/** 首頁：標題卡（整個龍洞的地圖），下面是各區域，一區一列（收藏的排在前面）；色點用 Sheet 上該區域的顏色 */
export function HomePage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const favorites = usePersonal().favorites
  const crag = localName(data.dataset.crag.name, lang)
  const routeCount = data.dataset.areas.flatMap((a) => a.sectors.flatMap((s) => s.routes)).filter((r) => !r.isFixture).length
  return (
    <>
      <PageHero
        crumbs={crag.sub ? [{ label: crag.sub }] : []}
        name={crag.main}
        sub={t('home.heroStats', { areas: data.dataset.areas.length, routes: routeCount })}
        shape={<CragShape data={data} className="area-hero-shape" />}
        strip
      />
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
