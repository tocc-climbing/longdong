import { useState } from 'react'
import { AreaStrip } from '../components/AreaShape'
import { GradePill } from '../components/GradePill'
import { ROUTE_TYPES, TypeFilter } from '../components/TypeFilter'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import type { Route, RouteType } from '../data/schema'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { BEST_STYLES, bestStyle, checklistStyle, isSent, sentRouteIds } from '../personal/model'
import { setBest, usePersonal } from '../personal/store'
import { useCloud } from '../personal/sync'
import { href } from '../router'
import { useHorizontalSwipe } from '../swipeGesture'
import { rate } from '../social/actions'
import { routeKey } from '../social/model'
import { setLocalRating, useSocial } from '../social/store'

const AREA_KEY = 'longdong.checklist.area'
/** 存在 AREA_KEY 的「全區」（手機的總覽） */
const ALL = 'all'
const TYPES_KEY = 'longdong.checklist.types'

type Style = (typeof BEST_STYLES)[number]

/** 清單上的簡寫與顏色（CSS 的 .style-os 等） */
const SHORT: Record<Style, string> = { onsight: 'OS', redpoint: 'RP', toprope: 'TR' }

function load(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 存不了就下次用預設值 */
  }
}

/** 上次選的路線種類（都不選為全部） */
function loadTypes(): RouteType[] {
  const saved = load(TYPES_KEY)?.split(',') ?? []
  return ROUTE_TYPES.filter((type) => saved.includes(type))
}

/**
 * 路線清單（/checklist，像攀岩指南書最後的路線表）：依區域、分區列出全部路線，
 * 每條路線直接點選最佳攀登方式（OS／RP／TR，不記日期）與星等評分。
 * 手機：用龍洞的地圖形狀選區域（AreaStrip），篩選放一行（可左右滑），每條路線一行，點星號才展開評分；
 * 清單也可以左右滑換區域。再點一次地圖上選到的區域是全區：不列路線，只列各區域的完攀統計。
 * 最佳攀登方式存在手機上並同步到雲端（v2/personal/<uid>/best）；評分與路線頁的評分相同（公開平均）。
 */
export function ChecklistPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const wide = useWide()
  const cloud = useCloud()
  const personal = usePersonal()
  const areas = data.dataset.areas
  // undefined：全區（只有手機有）
  const [areaId, setAreaId] = useState<string | undefined>(() => {
    const saved = load(AREA_KEY)
    return saved === ALL ? undefined : areas.some((a) => a.id === saved) ? saved! : areas[0].id
  })
  const [types, setTypes] = useState(loadTypes)
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [slide, setSlide] = useState<'next' | 'prev'>()
  const swipe = useHorizontalSwipe((by) => {
    const next = areas[index + by] ?? (index < 0 && by > 0 ? areas[0] : undefined)
    if (next) pick(next.id)
  })

  if (cloud.status !== 'signed-in') {
    return (
      <article className="checklist">
        <h1>{t('checklist.title')}</h1>
        <SignInPrompt message={t('checklist.signIn')} />
      </article>
    )
  }

  // 統計與清單都只算選取的路線種類
  const included = (r: Route) => !r.isFixture && (types.length === 0 || (!!r.type && types.includes(r.type)))
  const routesOf = (area: (typeof areas)[number]) => area.sectors.flatMap((s) => s.routes).filter(included)
  const sent = sentRouteIds(personal.ticks, personal.best)
  const total = areas.reduce((n, a) => n + routesOf(a).length, 0)
  const done = areas.reduce((n, a) => n + routesOf(a).filter((r) => sent.has(r.id)).length, 0)
  const area = areas.find((a) => a.id === areaId) ?? (wide ? areas[0] : undefined)
  const index = area ? areas.indexOf(area) : -1
  const pick = (id: string | undefined) => {
    // 換區域時清單從旁邊滑進來（方向與手指相同）
    setSlide(id === undefined || index < 0 ? undefined : areas.findIndex((a) => a.id === id) > index ? 'next' : 'prev')
    setAreaId(id)
    save(AREA_KEY, id ?? ALL)
  }
  const pickTypes = (next: RouteType[]) => {
    setTypes(next)
    save(TYPES_KEY, next.join(','))
  }

  const progressOf = (a: (typeof areas)[number]) => {
    const rs = routesOf(a)
    return { done: rs.filter((r) => sent.has(r.id)).length, total: rs.length }
  }
  const progress = (a: (typeof areas)[number]) => `${progressOf(a).done}/${progressOf(a).total}`
  const styleOf = (id: string) => routeStyle(personal, id)

  return (
    <article className="checklist">
      <div className="checklist-head">
        <h1>{t('checklist.title')}</h1>
        <p className="checklist-total">{t('checklist.total', { done, total })}</p>
      </div>
      <p className="checklist-legend small">
        {BEST_STYLES.map((s) => (
          <span key={s}>
            <span className={`style-tag style-${SHORT[s].toLowerCase()}`}>{SHORT[s]}</span>
            {t(`checklist.legend.${s}`)}
          </span>
        ))}
      </p>

      {wide ? (
        <div className="chips checklist-areas" role="tablist" aria-label={t('checklist.areas')}>
          {areas.map((a) => (
            <button key={a.id} type="button" role="tab" className="chip" aria-selected={a.id === areaId} aria-pressed={a.id === areaId} onClick={() => pick(a.id)}>
              {localName(a.name, lang).main}
              <span className="chip-meta">{progress(a)}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <AreaStrip data={data} value={area?.id} onChange={pick} />
          <p className="checklist-picked">
            {area ? (
              // 名稱標在地圖上了，這裡只留完攀數
              <span className="muted">{t('checklist.total', { done: progressOf(area).done, total: progressOf(area).total })}</span>
            ) : (
              <>
                <strong>{t('checklist.allAreas')}</strong>
                <span className="muted">
                  {done}/{total}
                </span>
              </>
            )}
          </p>
        </>
      )}

      <div className="chips checklist-filter" role="group" aria-label={t('type.filter')}>
        <TypeFilter value={types} onChange={pickTypes} />
        {area && (
          <>
            <span className="chip-sep" aria-hidden />
            <button type="button" className="chip" aria-pressed={onlyOpen} onClick={() => setOnlyOpen((o) => !o)}>
              {t('checklist.onlyOpen')}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}

      {area ? (
        // 手機：清單也可以左右滑換區域；換區域時從旁邊滑進來
        <div key={area.id} className={`checklist-sectors${slide ? ` slide-${slide}` : ''}`} {...(wide ? {} : swipe)}>
          {area.sectors.map((sector) => {
            const routes = sector.routes.filter((r) => included(r) && !(onlyOpen && sent.has(r.id)))
            if (routes.length === 0) return null
            return (
              <section key={sector.id} aria-labelledby={`cl-${sector.id}`}>
                <h2 id={`cl-${sector.id}`}>{localName(sector.name, lang).main}</h2>
                <ul className="list-card checklist-list">
                  {routes.map((r) => (
                    <ChecklistRow key={r.id} route={r} compact={!wide} onError={setError} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <AreaStats areas={areas} routesOf={routesOf} sent={sent} styleOf={styleOf} onPick={pick} {...swipe} />
      )}
    </article>
  )
}

type Personal = ReturnType<typeof usePersonal>

/** 路線的最佳攀登方式：在清單勾選的（chosen），沒有勾選時是攀登紀錄裡最好的完攀方式（fromLog） */
function routeStyle(personal: Personal, routeId: string): { chosen?: Style; fromLog?: Style } {
  const saved = personal.best.get(routeId)
  const chosen = saved && checklistStyle(saved)
  if (chosen) return { chosen }
  const logged = bestStyle(personal.ticks.filter((tk) => tk.routeId === routeId && isSent(tk.style)).map((tk) => tk.style))
  return { fromLog: logged && checklistStyle(logged) }
}

/**
 * 全區（手機）：各區域的完攀統計，不列路線。一列一個區域：名稱、完攀數、OS／RP／TR 分色的進度條；點了進到那個區域。
 */
function AreaStats({
  areas,
  routesOf,
  sent,
  styleOf,
  onPick,
  ...swipe
}: {
  areas: LoadedData['dataset']['areas']
  routesOf: (area: LoadedData['dataset']['areas'][number]) => Route[]
  sent: Set<string>
  styleOf: (id: string) => { chosen?: Style; fromLog?: Style }
  onPick: (id: string) => void
} & ReturnType<typeof useHorizontalSwipe>) {
  const { lang } = useLang()
  return (
    <ul className="checklist-stats" {...swipe}>
      {areas.map((area) => {
        const routes = routesOf(area)
        const count = { onsight: 0, redpoint: 0, toprope: 0 }
        let other = 0
        for (const r of routes) {
          if (!sent.has(r.id)) continue
          const { chosen, fromLog } = styleOf(r.id)
          const style = chosen ?? fromLog
          if (style) count[style]++
          else other++
        }
        const done = Object.values(count).reduce((a, b) => a + b, other)
        const share = (n: number) => `${routes.length ? (n / routes.length) * 100 : 0}%`
        return (
          <li key={area.id}>
            <button type="button" onClick={() => onPick(area.id)}>
              <span className="color-dot" style={{ background: area.color }} aria-hidden />
              <strong>{localName(area.name, lang).main}</strong>
              <span className="checklist-stats-count">
                {done}
                <span className="muted">/{routes.length}</span>
              </span>
              <span className="checklist-stats-bar" aria-hidden>
                {BEST_STYLES.map((s) => (
                  <span key={s} className={`style-${SHORT[s].toLowerCase()}`} style={{ width: share(count[s]) }} />
                ))}
                <span className="other" style={{ width: share(other) }} />
              </span>
              {done > 0 && (
                <span className="checklist-stats-styles small" aria-hidden>
                  {BEST_STYLES.map((s) => (count[s] ? <span key={s} className={`style-${SHORT[s].toLowerCase()}`}>{`${SHORT[s]} ${count[s]}`}</span> : null))}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 一條路線：編號、名稱、難度；最佳攀登方式（再點一次清除）、我的評分（再點同一顆清除）。
 * compact（手機）：全部放一行（只有主要名稱），評分只顯示一個星號與分數，點了才在下面展開五顆星，選好就收起。
 */
function ChecklistRow({ route, compact, onError }: { route: Route; compact: boolean; onError: (message: string | undefined) => void }) {
  const { lang, t } = useLang()
  const personal = usePersonal()
  const cloud = useCloud()
  const social = useSocial()
  const uid = cloud.user?.uid
  const mine = uid ? social.ratings[routeKey(route.id)]?.[uid] : undefined
  // 沒有在清單勾選時，顯示攀登紀錄裡最好的完攀方式（外框）
  const { chosen, fromLog } = routeStyle(personal, route.id)
  const name = localName(route.name, lang)
  const [rating, setRating] = useState(false)

  const choose = (style: Style) => void setBest(route.id, chosen === style ? null : style)
  const star = (n: number) => {
    if (!uid) return
    const next = mine?.stars === n ? null : { stars: n, ...(mine?.feel ? { feel: mine.feel } : {}) }
    // 先更新畫面再送出，連續點選不用等網路；失敗時改回原本的評分
    setLocalRating(uid, route.id, next && { ...next, updatedAt: new Date().toISOString() })
    onError(undefined)
    setRating(false)
    rate(route.id, next).catch((err: Error) => {
      setLocalRating(uid, route.id, mine ?? null)
      onError(t('checklist.rateFailed', { error: err.message }))
    })
  }

  const routeLink = (
    <a className="checklist-route" href={href.route(route.id)}>
      <span className="checklist-no muted">{route.number ? `#${route.number}` : ''}</span>
      <span className="checklist-name">
        {name.main}
        {!compact && name.sub && <span className="en">{name.sub}</span>}
      </span>
      <GradePill grade={route.grade} value={route.gradeValue} size="sm" />
    </a>
  )
  const styles = (
    <div className="checklist-styles" role="group" aria-label={t('checklist.styleAria', { route: name.main })}>
      {BEST_STYLES.map((s) => (
        <button
          key={s}
          type="button"
          className={`checklist-style style-${SHORT[s].toLowerCase()}${chosen === s ? ' on' : fromLog === s ? ' from-log' : ''}`}
          aria-pressed={chosen === s}
          title={fromLog === s ? t('checklist.fromLog', { style: t(`style.${s}`) }) : t(`style.${s}`)}
          onClick={() => choose(s)}
        >
          {SHORT[s]}
        </button>
      ))}
    </div>
  )
  const stars = (
    <div className="checklist-stars" role="group" aria-label={t('checklist.starsAria', { route: name.main })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={(mine?.stars ?? 0) >= n ? 'on' : undefined} aria-label={t('checklist.star', { n })} aria-pressed={mine?.stars === n} onClick={() => star(n)}>
          ★
        </button>
      ))}
    </div>
  )

  if (compact) {
    return (
      <li className="checklist-row checklist-row-m">
        {routeLink}
        {styles}
        <button
          type="button"
          className={`checklist-rate${mine ? ' on' : ''}`}
          aria-label={t('checklist.starsAria', { route: name.main })}
          aria-expanded={rating}
          onClick={() => setRating((open) => !open)}
        >
          <StarIcon filled={!!mine} />
          {mine?.stars}
        </button>
        {rating && <StarPick stars={mine?.stars} label={t('checklist.starsAria', { route: name.main })} onPick={star} />}
      </li>
    )
  }
  return (
    <li className="checklist-row">
      {routeLink}
      <div className="checklist-controls">
        {styles}
        {stars}
      </div>
    </li>
  )
}

/** 星星圖示（評分） */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 手機版的評分：五顆圓形的星星，選到的星星彈一下，下面一句話說明這個分數（再點同一顆清除）。
 */
function StarPick({ stars, label, onPick }: { stars?: number; label: string; onPick: (n: number) => void }) {
  const { t } = useLang()
  return (
    <div className="star-pick" role="group" aria-label={label}>
      <div className="star-pick-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`${(stars ?? 0) >= n ? 'on' : ''}${stars === n ? ' picked' : ''}`}
            aria-label={`${t('checklist.star', { n })}：${t(`checklist.feel.${n}` as 'checklist.feel.1')}`}
            aria-pressed={stars === n}
            onClick={() => onPick(n)}
          >
            <StarIcon filled={(stars ?? 0) >= n} />
          </button>
        ))}
      </div>
      <span className="star-pick-label small">{stars ? t(`checklist.feel.${stars}` as 'checklist.feel.1') : t('checklist.ratePrompt')}</span>
    </div>
  )
}
