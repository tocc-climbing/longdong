import { useEffect, useState } from 'react'
import { useIsAdmin } from '../admin'
import { CopyButton } from '../components/CopyButton'
import { ScaleMap } from '../map/ScaleMap'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import { formatCoords } from '../data/rescue'
import { distanceM, type LatLng } from '../geo'
import { LOCALES, useLang } from '../i18n'
import type { CalibrationUploads } from '../personal/firebase'
import { useCloud, withCloud } from '../personal/sync'
import { areaNames, useScaleMap } from '../map/mapData'
import { displayName, useSocial } from '../social/store'
import './ReportsPage.css'

interface Report {
  note: string
  /** GPS 位置 */
  coords: LatLng
  accuracy: number
  time: number
  /** 回報者在地圖上點的位置（選填） */
  picked?: LatLng
  /** 清單與地圖上的編號（1 起算） */
  no: number
}

interface UserReports {
  /** 帳號 uid，或沒登入時的裝置代號 */
  uid: string
  anon: boolean
  /** 上傳了幾次（每次都是完整的一份，只看最新的一份） */
  uploads: number
  lastUpload: number
  reports: Report[]
}

/** 每個人（或沒登入的每台手機）最新上傳的那一份（GeoJSON）轉成回報清單 */
function latestByUser(all: CalibrationUploads, anon: boolean): UserReports[] {
  return Object.entries(all)
    .map(([uid, uploads]) => {
      const list = Object.values(uploads)
      const latest = list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
      const features = (
        JSON.parse(latest.geojson) as {
          features: { properties: { note: string; accuracy: number; time: string; picked?: [number, number] }; geometry: { coordinates: [number, number] } }[]
        }
      ).features
      const reports = features
        .map((f) => ({
          note: f.properties.note,
          coords: [f.geometry.coordinates[1], f.geometry.coordinates[0]] as LatLng,
          accuracy: f.properties.accuracy,
          time: Date.parse(f.properties.time),
          picked: f.properties.picked && ([f.properties.picked[1], f.properties.picked[0]] as LatLng),
          no: 0,
        }))
        .sort((a, b) => b.time - a.time)
      return { uid, anon, uploads: list.length, lastUpload: latest.createdAt, reports }
    })
}

/**
 * 管理員：所有人上傳的地圖回報（/reports），地圖上標出位置、下面依使用者列出。
 * 每筆回報有編號，地圖上的橘點是 GPS 位置；回報者有在地圖上點出自己的位置時另有紫色菱形與虛線，清單寫出相差幾公尺。
 * 點清單上的一筆：地圖移到那裡並加大標示。
 * 入口只顯示給管理員（/role）；資料庫規則也只讓管理員讀 v2/calibration。
 */
export function ReportsPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const cloud = useCloud()
  const admin = useIsAdmin()
  const social = useSocial()
  const map = useScaleMap()
  const [users, setUsers] = useState<UserReports[]>()
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<number>()

  useEffect(() => {
    if (!admin) return
    let alive = true
    withCloud()
      .then(({ m }) => m.loadCalibrationUploads())
      .then(
        ({ signedIn, anon }) => {
          if (!alive) return
          const list = [...latestByUser(signedIn, false), ...latestByUser(anon, true)].sort((a, b) => b.lastUpload - a.lastUpload)
          // 依清單順序編號
          let no = 0
          for (const u of list) for (const r of u.reports) r.no = ++no
          setUsers(list)
        },
        (err: Error) => alive && setError(err.message),
      )
    return () => {
      alive = false
    }
  }, [admin])

  const time = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const all = users?.flatMap((u) => u.reports) ?? []
  const focused = all.find((r) => r.no === selected)

  return (
    <article className="reports">
      <h1>{t('reports.title')}</h1>
      {cloud.status !== 'signed-in' ? (
        <SignInPrompt message={t('reports.signIn')} />
      ) : admin === undefined || (admin && !users && !error) ? (
        <p className="muted">{t('app.loading')}</p>
      ) : !admin ? (
        <p className="muted">{t('reports.notAdmin')}</p>
      ) : error ? (
        <p className="error" role="alert">
          {t('reports.loadFailed', { error })}
        </p>
      ) : (
        <>
          <p className="muted small">{t('reports.summary', { users: users!.length, n: all.length })}</p>
          {map.status === 'ok' && all.length > 0 && (
            <div className="reports-map">
              <ScaleMap
                map={map.data}
                areaNames={areaNames(data, lang)}
                marks={all.map((r) => ({ at: r.coords, picked: r.picked, label: String(r.no), selected: r.no === selected }))}
                focus={focused && { key: `report-${focused.no}`, coords: focused.picked ? [focused.coords, focused.picked] : [focused.coords] }}
              />
            </div>
          )}
          {users!.length === 0 && <p className="muted">{t('reports.empty')}</p>}
          {users!.map((u) => (
            <section key={(u.anon ? 'anon:' : '') + u.uid} className="card">
              <h2>{u.anon ? t('reports.anon', { id: u.uid.slice(0, 4) }) : displayName(social.profiles, u.uid)}</h2>
              <p className="muted small">{t('reports.user', { n: u.uploads, time: time(u.lastUpload) })}</p>
              <ol className="report-list">
                {u.reports.map((r) => (
                  <li key={r.no} className={r.no === selected ? 'selected' : undefined}>
                    <button type="button" className="report-pick" aria-pressed={r.no === selected} onClick={() => setSelected(r.no === selected ? undefined : r.no)}>
                      <span className="report-no">{r.no}</span>
                      <span className="report-note">{r.note}</span>
                    </button>
                    <span className="muted small">
                      <span className="mono">{formatCoords(r.coords)}</span> · ±{t('myloc.m', { n: r.accuracy })} · {time(r.time)}
                    </span>
                    {r.picked && <span className="report-offset small">{t('reports.pickedOffset', { m: Math.round(distanceM(r.coords, r.picked)) })}</span>}
                    <CopyButton text={formatCoords(r.coords)} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </>
      )}
    </article>
  )
}
