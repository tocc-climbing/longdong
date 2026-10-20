import { useState } from 'react'
import { GradePill } from '../components/GradePill'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import type { Route } from '../data/schema'
import { localName, useLang } from '../i18n'
import { BEST_STYLES, bestStyle, checklistStyle, isSent, sentRouteIds } from '../personal/model'
import { setBest, usePersonal } from '../personal/store'
import { useCloud } from '../personal/sync'
import { href } from '../router'
import { rate } from '../social/actions'
import { routeKey } from '../social/model'
import { setLocalRating, useSocial } from '../social/store'

const AREA_KEY = 'longdong.checklist.area'

type Style = (typeof BEST_STYLES)[number]

/** 清單上的簡寫與顏色（CSS 的 .style-os 等） */
const SHORT: Record<Style, string> = { onsight: 'OS', redpoint: 'RP', toprope: 'TR' }

function loadArea(): string | undefined {
  try {
    return localStorage.getItem(AREA_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 路線清單（/checklist，像攀岩指南書最後的路線表）：依區域、分區列出全部路線，
 * 每條路線直接點選最佳攀登方式（OS／FL／RP／TR，不記日期）與星等評分。
 * 最佳攀登方式存在手機上並同步到雲端（v2/personal/<uid>/best）；評分與路線頁的評分相同（公開平均）。
 */
export function ChecklistPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const cloud = useCloud()
  const personal = usePersonal()
  const areas = data.dataset.areas
  const [areaId, setAreaId] = useState(() => {
    const saved = loadArea()
    return areas.some((a) => a.id === saved) ? saved! : areas[0].id
  })
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [error, setError] = useState<string>()

  if (cloud.status !== 'signed-in') {
    return (
      <article className="checklist">
        <h1>{t('checklist.title')}</h1>
        <SignInPrompt message={t('checklist.signIn')} />
      </article>
    )
  }

  const routesOf = (area: (typeof areas)[number]) => area.sectors.flatMap((s) => s.routes).filter((r) => !r.isFixture)
  const sent = sentRouteIds(personal.ticks, personal.best)
  const total = areas.reduce((n, a) => n + routesOf(a).length, 0)
  const done = areas.reduce((n, a) => n + routesOf(a).filter((r) => sent.has(r.id)).length, 0)
  const area = areas.find((a) => a.id === areaId)!
  const pick = (id: string) => {
    setAreaId(id)
    try {
      localStorage.setItem(AREA_KEY, id)
    } catch {
      /* 存不了就下次從第一區開始 */
    }
  }

  return (
    <article className="checklist">
      <h1>{t('checklist.title')}</h1>
      <p className="checklist-legend small">
        {BEST_STYLES.map((s) => (
          <span key={s}>
            <span className={`style-tag style-${SHORT[s].toLowerCase()}`}>{SHORT[s]}</span>
            {t(`checklist.legend.${s}`)}
          </span>
        ))}
      </p>
      <p className="checklist-total">{t('checklist.total', { done, total })}</p>

      <div className="checklist-areas" role="tablist" aria-label={t('checklist.areas')}>
        {areas.map((a) => {
          const rs = routesOf(a)
          return (
            <button key={a.id} type="button" role="tab" className="chip" aria-selected={a.id === areaId} aria-pressed={a.id === areaId} onClick={() => pick(a.id)}>
              {localName(a.name, lang).main}
              <span className="chip-meta">
                {rs.filter((r) => sent.has(r.id)).length}/{rs.length}
              </span>
            </button>
          )
        })}
      </div>

      <label className="checklist-filter small">
        <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
        {t('checklist.onlyOpen')}
      </label>

      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}

      {area.sectors.map((sector) => {
        const routes = sector.routes.filter((r) => !r.isFixture && !(onlyOpen && sent.has(r.id)))
        if (routes.length === 0) return null
        return (
          <section key={sector.id} aria-labelledby={`cl-${sector.id}`}>
            <h2 id={`cl-${sector.id}`}>{localName(sector.name, lang).main}</h2>
            <ul className="list-card checklist-list">
              {routes.map((r) => (
                <ChecklistRow key={r.id} route={r} onError={setError} />
              ))}
            </ul>
          </section>
        )
      })}
    </article>
  )
}

/** 一條路線：編號、名稱、難度；最佳攀登方式（再點一次清除）、我的評分（再點同一顆清除） */
function ChecklistRow({ route, onError }: { route: Route; onError: (message: string | undefined) => void }) {
  const { lang, t } = useLang()
  const personal = usePersonal()
  const cloud = useCloud()
  const social = useSocial()
  const uid = cloud.user?.uid
  const mine = uid ? social.ratings[routeKey(route.id)]?.[uid] : undefined
  const saved = personal.best.get(route.id)
  const chosen = saved && checklistStyle(saved)
  // 沒有在清單勾選時，顯示攀登紀錄裡最好的完攀方式（淡色）
  const logged = chosen ? undefined : bestStyle(personal.ticks.filter((tk) => tk.routeId === route.id && isSent(tk.style)).map((tk) => tk.style))
  const fromLog = logged && checklistStyle(logged)
  const name = localName(route.name, lang)

  const choose = (style: Style) => void setBest(route.id, chosen === style ? null : style)
  const star = (n: number) => {
    if (!uid) return
    const next = mine?.stars === n ? null : { stars: n, ...(mine?.feel ? { feel: mine.feel } : {}) }
    // 先更新畫面再送出，連續點選不用等網路；失敗時改回原本的評分
    setLocalRating(uid, route.id, next && { ...next, updatedAt: new Date().toISOString() })
    onError(undefined)
    rate(route.id, next).catch((err: Error) => {
      setLocalRating(uid, route.id, mine ?? null)
      onError(t('checklist.rateFailed', { error: err.message }))
    })
  }

  return (
    <li className="checklist-row">
      <a className="checklist-route" href={href.route(route.id)}>
        <span className="checklist-no muted">{route.number ? `#${route.number}` : ''}</span>
        <span className="checklist-name">
          {name.main}
          {name.sub && <span className="en">{name.sub}</span>}
        </span>
        <GradePill grade={route.grade} value={route.gradeValue} size="sm" />
      </a>
      <div className="checklist-controls">
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
        <div className="checklist-stars" role="group" aria-label={t('checklist.starsAria', { route: name.main })}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={(mine?.stars ?? 0) >= n ? 'on' : undefined} aria-label={t('checklist.star', { n })} aria-pressed={mine?.stars === n} onClick={() => star(n)}>
              ★
            </button>
          ))}
        </div>
      </div>
    </li>
  )
}
