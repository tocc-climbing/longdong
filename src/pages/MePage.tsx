import { useState } from 'react'
import type { LoadedData } from '../data/dataset'
import { ActivityChart, GradePyramid } from '../components/Charts'
import { GradePill } from '../components/GradePill'
import { InstallButton } from '../components/InstallPrompt'
import { RouteRow } from '../components/RouteRow'
import { FACEBOOK_LOGIN_ENABLED, SignInPrompt } from '../components/SignInPrompt'
import { relativeTime } from '../format'
import { LANGS, localName, monthTitle, setLangSetting, useLang, type LangSetting } from '../i18n'
import { sentRouteIds } from '../personal/model'
import { gradePyramid, groupByMonth, recentActivity, sendStyles } from '../personal/stats'
import { ROUTE_TYPES, TypeFilter } from '../components/TypeFilter'
import type { RouteType } from '../data/schema'
import { deleteTick, setFavorite, usePersonal } from '../personal/store'
import { signOut, useCloud } from '../personal/sync'
import { setThemeSetting, useThemeSetting, type ThemeSetting } from '../theme'
import { deleteMyAccount, rename } from '../social/actions'
import { NAME_MAX } from '../social/model'
import { displayName, useSocial } from '../social/store'
import { useIsAdmin } from '../admin'
import { href, useRouteLink } from '../router'
import { APP_VERSION, formatVersion } from '../version'

type Tab = 'ticks' | 'favorites'

export function MePage({ data }: { data: LoadedData }) {
  const cloud = useCloud()
  const { t } = useLang()

  if (cloud.status === 'signed-in' && cloud.user) {
    return <SignedIn data={data} uid={cloud.user.uid} email={cloud.user.email} />
  }
  if (cloud.status === 'loading') return <p className="empty muted">{t('app.loading')}</p>

  return (
    // 電腦版寬版面中置中，不要只佔左邊一欄
    <div className="me-signed-out">
        <h1>{t('me.title')}</h1>
        <section className="card intro-card">
          <h2>{t('me.introTitle')}</h2>
          <ul className="feature-list">
            {(['log', 'fav', 'social', 'sync'] as const).map((f) => (
              <li key={f}>
                <strong>{t(`me.feature.${f}`)}</strong>
                <span>{t(`me.feature.${f}Desc`)}</span>
              </li>
            ))}
          </ul>
          <SignInPrompt
            message={t('me.signInMessage', { providers: FACEBOOK_LOGIN_ENABLED ? `Google${t('me.or')}Facebook` : 'Google' })}
          />
        </section>
        {/* 語言、外觀設定不需要登入 */}
        <section className="card settings">
          <LanguagePicker />
          <ThemePicker />
          <InstallButton />
          <AppVersionLine />
        </section>
        <p className="center small">
          <a href={href.about()}>{t('footer.about')}</a>
        </p>
    </div>
  )
}

const PYRAMID_TYPES_KEY = 'longdong.pyramid.types'

/** 難度金字塔上次選的路線種類（都不選為全部） */
function loadPyramidTypes(): RouteType[] {
  try {
    const saved = localStorage.getItem(PYRAMID_TYPES_KEY)?.split(',') ?? []
    return ROUTE_TYPES.filter((type) => saved.includes(type))
  } catch {
    return []
  }
}

function SignedIn({ data, uid, email }: { data: LoadedData; uid: string; email: string }) {
  const personal = usePersonal()
  const cloud = useCloud()
  const social = useSocial()
  const { lang, t } = useLang()
  const [tab, setTab] = useState<Tab>('ticks')
  const [settings, setSettings] = useState(false)
  const admin = useIsAdmin()
  const [pyramidTypes, setPyramidTypesState] = useState(loadPyramidTypes)
  const setPyramidTypes = (types: RouteType[]) => {
    setPyramidTypesState(types)
    try {
      localStorage.setItem(PYRAMID_TYPES_KEY, types.join(','))
    } catch {
      /* 存不了就下次顯示全部 */
    }
  }
  const { link } = useRouteLink()

  const lookup = (id: string) => data.routeById.get(id)
  const name = displayName(social.profiles, uid)
  // 完攀過的路線與最好的方式：攀登紀錄加上路線清單勾選的
  const sends = sendStyles(personal.ticks, personal.best)
  const sentRoutes = sentRouteIds(personal.ticks, personal.best)
  const route = (id: string) => lookup(id)?.route
  const hardest = gradePyramid(sends, route).find((r) => r.routes > 0)
  // 金字塔的種類篩選只列出完攀過的種類；兩種以上才顯示
  const sentTypes = ROUTE_TYPES.filter((type) => [...sends.keys()].some((id) => route(id)?.type === type))
  const shownTypes = pyramidTypes.filter((type) => sentTypes.includes(type))
  const pyramid = gradePyramid(sends, route, shownTypes)
  const activity = recentActivity(personal.ticks)

  return (
    <>
      <header className="profile-head">
        <span className="avatar" aria-hidden>
          {[...name][0]}
        </span>
        <div className="profile-text">
          <h1>{name}</h1>
          <p className="muted small">
            {cloud.syncing
              ? t('me.syncing')
              : !cloud.connected
                ? t('me.offline')
                : cloud.lastSync
                  ? t('me.synced', { time: relativeTime(cloud.lastSync, t) })
                  : t('me.connected')}
          </p>
        </div>
        {admin && (
          <a className="icon-button" href={href.admin()} aria-label={t('me.admin')}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.6-4.6 1.4 1.4z" />
            </svg>
          </a>
        )}
        <button
          className={`icon-button${settings ? ' on' : ''}`}
          aria-label={t('me.settings')}
          aria-expanded={settings}
          onClick={() => setSettings((s) => !s)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path
              fill="currentColor"
              d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
              transform="translate(-1 0)"
            />
          </svg>
        </button>
      </header>
      {cloud.error && <p className="small error">{cloud.error}</p>}

      {settings && <Settings uid={uid} email={email} />}

      {/* 寬度夠時（電腦版）統計在左、紀錄在右 */}
      <div className="me-grid">
        <div className="me-stats">
          <section className="stat-row">
            <div>
              <strong>{sentRoutes.size}</strong>
              <span>{t('me.stat.sent')}</span>
            </div>
            <div>
              <strong>{personal.ticks.length}</strong>
              <span>{t('me.stat.ticks')}</span>
            </div>
            <div>
              <strong>{hardest?.grade ?? '—'}</strong>
              <span>{t('me.stat.hardest')}</span>
            </div>
          </section>

          <a className="checklist-entry" href={href.checklist()}>
            <span>
              <strong>{t('checklist.entry')}</strong>
              <span className="muted small">{t('checklist.entryDesc')}</span>
            </span>
            <span aria-hidden>›</span>
          </a>

          <section className="card">
            <h2>{t('me.pyramid')}</h2>
            {sentTypes.length > 1 && (
              <div className="chips" role="group" aria-label={t('type.filter')}>
                <TypeFilter value={shownTypes} onChange={setPyramidTypes} options={sentTypes} />
              </div>
            )}
            <GradePyramid rows={pyramid} />
          </section>

          {activity && (
            <section className="card">
              <h2>{t(`me.activity.${activity.range}`)}</h2>
              <ActivityChart activity={activity} />
            </section>
          )}
        </div>

        <div className="me-log">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'ticks'} onClick={() => setTab('ticks')}>
              {t('me.tab.ticks')}
            </button>
            <button role="tab" aria-selected={tab === 'favorites'} onClick={() => setTab('favorites')}>
              {t('me.tab.favs')}
              {personal.favorites.size > 0 && ` ${personal.favorites.size}`}
            </button>
          </div>

          {tab === 'ticks' &&
            (personal.ticks.length === 0 ? (
              <p className="empty muted">{t('me.noTicks')}</p>
            ) : (
              groupByMonth(personal.ticks).map((g) => (
                <section key={g.key} className="timeline">
                  <h3>{monthTitle(g.key, lang)}</h3>
                  <ul className="list-card">
                    {g.ticks.map((tick) => {
                      const r = lookup(tick.routeId)?.route
                      return (
                        <li key={tick.id} className="timeline-item">
                          <span className="timeline-day">
                            <strong>{Number(tick.date.slice(8, 10))}</strong>
                            {t('me.dayUnit') && <span>{t('me.dayUnit')}</span>}
                          </span>
                          <a className="timeline-body" href={link(tick.routeId)}>
                            <span className="timeline-title">
                              {r
                                ? `${r.number ? `#${r.number} ` : ''}${localName(r.name, lang).main}`
                                : t('me.routeMissing', { id: tick.routeId })}
                            </span>
                            <span className="timeline-meta">
                              <span className={`style-tag style-${tick.style}`}>{t(`style.${tick.style}`)}</span>
                              {tick.note && <span className="muted">{tick.note}</span>}
                            </span>
                          </a>
                          <GradePill grade={r?.grade} value={r?.gradeValue} size="sm" />
                          <button
                            className="icon-button small"
                            aria-label={t('tick.deleteAria')}
                            onClick={() => confirm(t('tick.confirmDelete')) && deleteTick(tick.id)}
                          >
                            ×
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))
            ))}

          {tab === 'favorites' &&
            (personal.favorites.size === 0 ? (
              <p className="empty muted">{t('me.noFavs')}</p>
            ) : (
              <ul className="list-card">
                {[...personal.favorites].map((id) => {
                  const ref = lookup(id)
                  return ref ? (
                    <RouteRow key={id} item={ref} showPlace />
                  ) : (
                    <li key={id} className="timeline-item">
                      <span className="timeline-body muted small">{t('me.routeMissing', { id })}</span>
                      <button className="icon-button small" aria-label={t('me.removeFav')} onClick={() => setFavorite(id, false)}>
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            ))}
        </div>
      </div>
    </>
  )
}

function Settings({ uid, email }: { uid: string; email: string }) {
  const { t } = useLang()
  return (
    <section className="card settings">
      <NameEditor uid={uid} />
      <p className="muted small">{t('me.emailPrivate', { email })}</p>
      <LanguagePicker />
      <ThemePicker />
      <InstallButton />
      <div className="settings-links">
        <a href={href.about()}>{t('footer.about')}</a>
        <button className="link-button" onClick={() => confirm(t('me.confirmSignOut')) && void signOut()}>
          {t('me.signOut')}
        </button>
      </div>
      <DeleteAccount />
      <AppVersionLine />
    </section>
  )
}

/** 設定最下方的版號：回報問題時可以附上 */
function AppVersionLine() {
  const { t } = useLang()
  return <p className="muted small app-version">{t('app.version', { version: formatVersion(APP_VERSION), date: APP_VERSION.date })}</p>
}

/** 語言：自動（依系統語言）、中文、English；選擇存在這台裝置上 */
function LanguagePicker() {
  const { setting, t } = useLang()
  return (
    <label className="lang-picker">
      <span>{t('me.language')}</span>
      <select value={setting} onChange={(e) => void setLangSetting(e.target.value as LangSetting)}>
        <option value="auto">{t('lang.auto')}</option>
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {t(`lang.${l}`)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** 外觀：自動（依系統設定）、淺色、深色；選擇存在這台裝置上 */
function ThemePicker() {
  const { t } = useLang()
  const setting = useThemeSetting()
  return (
    <label className="lang-picker">
      <span>{t('me.theme')}</span>
      <select value={setting} onChange={(e) => setThemeSetting(e.target.value as ThemeSetting)}>
        <option value="auto">{t('theme.auto')}</option>
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
      </select>
    </label>
  )
}

function NameEditor({ uid }: { uid: string }) {
  const social = useSocial()
  const { t } = useLang()
  const [value, setValue] = useState(() => displayName(social.profiles, uid))
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({})
  return (
    <form
      className="name-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setState({ busy: true })
        try {
          // 存下的是整理過的寫法（去掉多餘空白、全形轉半形），輸入框也換成那個寫法
          setValue(await rename(value))
          setState({ saved: true })
        } catch (err) {
          setState({ error: (err as Error).message })
        }
      }}
    >
      <label>
        <span>
          {t('me.nickname')} <span className="muted small">{t('me.nicknameHint')}</span>
        </span>
        <span className="name-row">
          <input value={value} maxLength={NAME_MAX} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="action primary" disabled={state.busy}>
            {state.saved ? t('action.saved') : t('action.save')}
          </button>
        </span>
      </label>
      {state.error && <p className="small error">{state.error}</p>}
    </form>
  )
}

function DeleteAccount() {
  const { t } = useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async () => {
    if (!navigator.onLine) {
      setError(t('me.deleteOffline'))
      return
    }
    if (!confirm(t('me.deleteConfirm'))) return
    setBusy(true)
    setError(undefined)
    try {
      await deleteMyAccount()
      alert(t('me.deleted'))
    } catch (err) {
      setError(t('me.deleteError', { error: (err as { code?: string }).code ?? (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="danger-zone">
      <summary>{t('me.deleteAccount')}</summary>
      <p className="muted small">{t('me.deleteDesc')}</p>
      <button className="action danger" onClick={() => void run()} disabled={busy}>
        {busy ? t('me.deleting') : t('me.deleteButton')}
      </button>
      {error && <p className="small error">{error}</p>}
    </details>
  )
}
