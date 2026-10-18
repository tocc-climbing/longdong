import { useMemo, useState } from 'react'
import { BOLT_SERIES, boltStats, seriesOf, type BoltSeries, type SeriesCounts, type YearRow } from '../boltStats'
import type { LoadedData } from '../data/dataset'
import { localName, useLang, type Translate } from '../i18n'
import { href } from '../router'

/** 數列名稱、顏色（CSS 變數 --bolt-<i>，深色模式另有一組） */
const seriesName = (s: BoltSeries, t: Translate) => t(`bolts.series.${s}`)
const seriesColor = (s: BoltSeries) => `var(--bolt-${BOLT_SERIES.indexOf(s) + 1})`

/** 各數列依固定順序列出（只列有顆數的），供提示與表格使用 */
const breakdown = (counts: SeriesCounts, t: Translate) =>
  BOLT_SERIES.filter((s) => counts[s] > 0)
    .map((s) => `${seriesName(s, t)} ${counts[s]}`)
    .join(' · ')

/**
 * Bolt 統計（/bolts）：全部路線的 bolt 與 anchor 依安裝年份、材質、區域加總。
 * 對應舊站的「Bolt 統計」（依年份堆疊的長條圖＋材質表），資料來自 Sheet。
 */
export function BoltsPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const stats = useMemo(() => boltStats(data.dataset), [data.dataset])
  const pct = (n: number) => Math.round((n / stats.total) * 100)
  const sumOf = (prefix: string) => stats.materials.filter((m) => m.code.startsWith(prefix)).reduce((n, m) => n + m.count, 0)
  const tiAll = sumOf('Ti-')
  const steel316 = sumOf('316-')
  const areaMax = Math.max(...stats.areas.map((a) => a.total))

  return (
    <article className="bolt-stats">
      <h1>{t('bolts.title')}</h1>
      <p className="muted small">{t('bolts.intro')}</p>

      <section className="stat-row bolt-tiles">
        <div>
          <strong>{stats.total}</strong>
          <span>{t('bolts.total')}</span>
        </div>
        <div>
          <strong>{pct(tiAll)}%</strong>
          <span>{t('bolts.titanium', { n: tiAll })}</span>
        </div>
        <div>
          <strong>{pct(steel316)}%</strong>
          <span>{t('bolts.steel316', { n: steel316 })}</span>
        </div>
        <div>
          <strong>{stats.counts['304']}</strong>
          <span>{t('bolts.steel304')}</span>
        </div>
      </section>

      <section className="card">
        <h2>{t('bolts.byYear')}</h2>
        <Legend counts={stats.counts} t={t} />
        <YearChart years={stats.years} t={t} />
        <p className="muted small">{t('bolts.undated', { n: stats.total - stats.dated })}</p>
        <details className="bolt-table-toggle">
          <summary>{t('bolts.showTable')}</summary>
          <div className="table-wrap">
            <table className="bolt-table">
              <thead>
                <tr>
                  <th>{t('bolts.year')}</th>
                  {BOLT_SERIES.map((s) => (
                    <th key={s}>{seriesName(s, t)}</th>
                  ))}
                  <th>{t('bolts.sum')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.years
                  .filter((y) => y.total > 0)
                  .map((y) => (
                    <tr key={y.year}>
                      <th>{y.year}</th>
                      {BOLT_SERIES.map((s) => (
                        <td key={s}>{y.counts[s] || ''}</td>
                      ))}
                      <td>
                        <strong>{y.total}</strong>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="card">
        <h2>{t('bolts.byArea')}</h2>
        <ul className="bolt-areas">
          {stats.areas.map((a) => (
            <li key={a.id} title={breakdown(a.counts, t)}>
              <a href={href.area(a.id)}>{localName(a.name, lang).main}</a>
              <span className="bolt-area-bar" style={{ width: `${(a.total / areaMax) * 100}%` }} role="img" aria-label={breakdown(a.counts, t)}>
                {BOLT_SERIES.filter((s) => a.counts[s] > 0).map((s) => (
                  <span key={s} style={{ flexGrow: a.counts[s], background: seriesColor(s) }} />
                ))}
              </span>
              <span className="bolt-area-total">{a.total}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{t('bolts.byMaterial')}</h2>
        <div className="table-wrap">
          <table className="bolt-table materials">
            <thead>
              <tr>
                <th>{t('bolts.material')}</th>
                <th>{t('bolts.count')}</th>
                <th>{t('bolts.years')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.materials.map((m) => (
                <tr key={m.code}>
                  <th>
                    <span className="swatch" style={{ background: seriesColor(seriesOf(m.code)) }} aria-hidden />
                    <span className="mono">{m.code}</span>
                    <span className="muted small"> {m.description}</span>
                  </th>
                  <td>{m.count}</td>
                  <td className="nowrap">{m.firstYear ? (m.firstYear === m.lastYear ? m.firstYear : `${m.firstYear}–${m.lastYear}`) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t('bolts.note', { n: stats.unknown })}</p>
      </section>
    </article>
  )
}

function Legend({ counts, t }: { counts: SeriesCounts; t: Translate }) {
  return (
    <ul className="bolt-legend">
      {BOLT_SERIES.filter((s) => counts[s] > 0).map((s) => (
        <li key={s}>
          <span className="swatch" style={{ background: seriesColor(s) }} aria-hidden />
          {seriesName(s, t)}
        </li>
      ))}
    </ul>
  )
}

/** 依安裝年份的堆疊直條圖；點按（或滑鼠停留）某一年，下方顯示該年各材質顆數 */
function YearChart({ years, t }: { years: YearRow[]; t: Translate }) {
  const [picked, setPicked] = useState<number>()
  // 寬度接近手機上的實際寬度，文字大小才會接近 12px
  const W = 360
  const H = 150
  const top = Math.max(1, ...years.map((y) => y.total))
  const step = W / years.length
  const barW = Math.max(4, step - 4)
  const scale = (n: number) => (n / top) * (H - 16)
  const peak = years.reduce((a, b) => (b.total > a.total ? b : a), years[0])
  const shown = years.find((y) => y.year === picked)
  // 年份標籤：每 5 年；頭尾離最近的標籤至少 3 年才標，避免重疊
  const label = (y: number, i: number) => y % 5 === 0 || ((i === 0 || i === years.length - 1) && Math.abs(y - Math.round(y / 5) * 5) >= 3)

  return (
    <figure className="chart bolt-years">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={t('bolts.chartAria', { from: years[0]?.year ?? '', to: years.at(-1)?.year ?? '' })} onMouseLeave={() => setPicked(undefined)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} className="axis" />
        {years.map((y, i) => {
          const x = i * step + (step - barW) / 2
          let base = H
          const segments = BOLT_SERIES.filter((s) => y.counts[s] > 0)
          return (
            <g key={y.year} className={picked === y.year ? 'on' : undefined} onMouseEnter={() => setPicked(y.year)} onClick={() => setPicked(y.year)}>
              <title>{`${y.year}：${y.total}`}</title>
              {/* 加大的透明感應區，方便手機點按 */}
              <rect x={i * step} y={0} width={step} height={H + 18} fill="transparent" />
              {segments.map((s, j) => {
                const h = scale(y.counts[s])
                base -= h
                const last = j === segments.length - 1
                return last ? (
                  <path key={s} d={roundedTop(x, base, barW, h, Math.min(4, barW / 2, h))} fill={seriesColor(s)} className="seg" />
                ) : (
                  <rect key={s} x={x} y={base} width={barW} height={h} fill={seriesColor(s)} className="seg" />
                )
              })}
              {y === peak && (
                <text x={x + barW / 2} y={base - 5} className="value" textAnchor="middle">
                  {y.total}
                </text>
              )}
              {label(y.year, i) && (
                <text x={x + barW / 2} y={H + 14} className="tick" textAnchor="middle">
                  {y.year}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="small" aria-live="polite">
        {shown ? (
          <>
            <strong>{t('bolts.yearTotal', { year: shown.year, n: shown.total })}</strong>
            {shown.total > 0 && <span className="muted"> {breakdown(shown.counts, t)}</span>}
          </>
        ) : (
          <span className="muted">{t('bolts.tapHint')}</span>
        )}
      </figcaption>
    </figure>
  )
}

/** 上方兩角圓、底部貼齊基準線的長條 */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}
