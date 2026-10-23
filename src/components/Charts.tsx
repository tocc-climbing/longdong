import type { MonthCount, PyramidRow, SendStyle } from '../personal/stats'
import type { GradeBand } from '../format'
import { monthShort, useLang } from '../i18n'

/** 金字塔的完攀方式：顏色與簡寫和路線清單相同（.style-os 等） */
const PYRAMID_STYLES: { style: SendStyle; short: string }[] = [
  { style: 'onsight', short: 'OS' },
  { style: 'redpoint', short: 'RP' },
  { style: 'toprope', short: 'TR' },
]

/**
 * 難度金字塔：水平長條，每列一個難度，依完攀方式（OS／RP／TR）分色堆疊，總數標在長條尾端。
 * 中間沒完攀的難度也列出（長條為空），看得出缺口；滑鼠停留／點按時以 title 顯示各方式的數量。
 */
export function GradePyramid({ rows }: { rows: PyramidRow[] }) {
  const { t } = useLang()
  const sent = rows.filter((r) => r.routes > 0)
  if (sent.length === 0) return <p className="muted small">{t('chart.pyramidEmpty')}</p>
  const top = Math.max(...sent.map((r) => r.routes))
  const used = PYRAMID_STYLES.filter(({ style }) => sent.some((r) => r.styles[style] > 0))
  return (
    <div className="chart" role="table" aria-label={t('chart.pyramidAria')}>
      {used.length > 1 && (
        <p className="pyramid-legend small" aria-hidden>
          {used.map(({ style, short }) => (
            <span key={style}>
              <span className={`style-tag style-${short.toLowerCase()}`}>{short}</span> {sent.reduce((n, r) => n + r.styles[style], 0)}
            </span>
          ))}
        </p>
      )}
      {rows.map((r) => {
        const detail = PYRAMID_STYLES.filter(({ style }) => r.styles[style] > 0)
          .map(({ style, short }) => `${short} ${r.styles[style]}`)
          .join(' · ')
        return (
          <div key={r.value} className={`pyramid-row${r.routes === 0 ? ' empty' : ''}`} role="row" title={r.routes ? `${r.grade}：${detail}` : undefined}>
            <span className="pyramid-label" role="rowheader">
              {r.grade}
            </span>
            <span className="pyramid-track" role="cell" aria-label={r.routes ? t('chart.pyramidRow', { grade: r.grade, n: r.routes }) + `（${detail}）` : undefined}>
              <span className="pyramid-bar" style={{ width: `${(r.routes / top) * 100}%` }}>
                {PYRAMID_STYLES.filter(({ style }) => r.styles[style] > 0).map(({ style, short }) => (
                  <span key={style} className={`style-${short.toLowerCase()}`} style={{ flexGrow: r.styles[style] }} />
                ))}
              </span>
              {r.routes > 0 && <span className="pyramid-value">{r.routes}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 最近 12 個月每月攀登紀錄筆數：直條，只標月份；數值在滑鼠停留／點按時顯示 */
export function MonthlyChart({ months }: { months: MonthCount[] }) {
  const { lang, t } = useLang()
  const top = Math.max(1, ...months.map((m) => m.count))
  const W = 336
  const H = 96
  const gap = 6
  const barW = (W - gap * (months.length - 1)) / months.length
  const total = months.reduce((n, m) => n + m.count, 0)
  return (
    <figure className="chart monthly">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={t('chart.monthsAria', { n: total })}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} className="axis" />
        {months.map((m, i) => {
          const h = m.count === 0 ? 0 : Math.max(4, (m.count / top) * (H - 14))
          const x = i * (barW + gap)
          return (
            <g key={m.key}>
              <title>{t('chart.monthBar', { month: m.key.replace('-', '/'), n: m.count })}</title>
              {/* 加大的透明感應區，方便手機點按 */}
              <rect x={x} y={0} width={barW} height={H} fill="transparent" />
              {h > 0 && <path className="bar" d={roundedTop(x, H - h, barW, h, Math.min(4, barW / 2))} />}
              {m.count > 0 && m.count === top && (
                <text x={x + barW / 2} y={H - h - 4} className="value" textAnchor="middle">
                  {m.count}
                </text>
              )}
              {(i === 0 || i === months.length - 1 || m.key.endsWith('-01')) && (
                <text x={x + barW / 2} y={H + 14} className="tick" textAnchor="middle">
                  {monthShort(m.key, lang)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

/** 上方圓角、底部貼齊基線的長條（SVG path）；圓角不超過高度 */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

/**
 * 區域的難度分佈：五個區間的直條，數量標在柱子上方。
 * 單一數列、所有區域同一個顏色，方便互相比較；區域色只用在卡片左框。
 */
export function GradeDistribution({ bands }: { bands: { band: GradeBand; label: string; count: number }[] }) {
  const { t } = useLang()
  const top = Math.max(1, ...bands.map((b) => b.count))
  const W = 160
  const H = 30
  const gap = 6
  const barW = (W - gap * (bands.length - 1)) / bands.length
  const summary = bands.map((b) => t('chart.distBar', { band: b.label, n: b.count })).join(', ')
  return (
    <svg className="grade-dist" viewBox={`0 0 ${W} ${H + 26}`} role="img" aria-label={t('chart.distAria', { summary })}>
      <line x1="0" x2={W} y1={H + 12.5} y2={H + 12.5} className="axis" />
      {bands.map((b, i) => {
        const h = b.count === 0 ? 0 : Math.max(3, (b.count / top) * H)
        const x = i * (barW + gap)
        const y = H + 12 - h
        return (
          <g key={b.band}>
            <title>{t('chart.distBar', { band: b.label, n: b.count })}</title>
            <rect x={x} y={0} width={barW} height={H + 26} fill="transparent" />
            {h > 0 && <path className="bar" d={roundedTop(x, y, barW, h, 3)} />}
            <text x={x + barW / 2} y={y - 3} className="value" textAnchor="middle">
              {b.count || ''}
            </text>
            <text x={x + barW / 2} y={H + 24} className="tick" textAnchor="middle">
              {b.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
