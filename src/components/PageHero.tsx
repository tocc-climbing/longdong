import { Fragment, type CSSProperties, type ReactNode } from 'react'

/** 標題卡上方的一層：有 href 的可以點（回到那一層） */
export interface Crumb {
  label: string
  href?: string
}

/**
 * 首頁、區域、分區、路線頁共用的標題卡：上方一行是所在的位置（龍洞 › 黃金谷 › 貓屋，可以點），中間是名稱，
 * 下面一行是數字；右邊是地圖，右上是這一頁的工具。顏色：首頁是品牌色，以下各層是區域（分區）的顏色。
 * wide：電腦版畫面寬時多放的資訊與圖表（只有區域頁）；compact：只佔清單那一欄（分區頁、路線頁在電腦版）；
 * strip：地圖是整張卡片的背景、可以和文字重疊（首頁的整個龍洞）；facts：名稱下面的重點（路線頁的難度、長度、快扣、種類）。
 */
export function PageHero({
  crumbs,
  color,
  name,
  en,
  sub,
  facts,
  tools,
  shape,
  wide,
  compact,
  strip,
}: {
  crumbs: Crumb[]
  color?: string
  name: string
  /** 英文名（電腦版、不是 compact 時放在名稱旁邊） */
  en?: ReactNode
  sub: ReactNode
  facts?: ReactNode
  tools?: ReactNode
  shape: ReactNode
  wide?: { facts: ReactNode; chart: ReactNode }
  compact?: boolean
  strip?: boolean
}) {
  return (
    <div className="area-hero-wrap">
      {tools}
      <div className={['area-hero', compact && 'compact', strip && 'strip'].filter(Boolean).join(' ')} style={{ '--area-color': color ?? 'var(--brand)' } as CSSProperties}>
        <div className="area-hero-text">
          <p className="area-hero-crag">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && ' › '}
                {c.href ? <a href={c.href}>{c.label}</a> : c.label}
              </Fragment>
            ))}
          </p>
          <h1>
            {name}
            {en && <span className="en">{en}</span>}
          </h1>
          {sub && <p className="muted small page-sub">{sub}</p>}
          {facts}
          {wide?.facts}
        </div>
        {wide?.chart}
        {shape}
      </div>
    </div>
  )
}
