import { useEffect, useState } from 'react'
import { useIsAdmin } from '../admin'
import { CopyButton } from '../components/CopyButton'
import { ScaleMap } from '../components/ScaleMap'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import { formatCoords } from '../data/rescue'
import type { LatLng } from '../geo'
import { LOCALES, useLang } from '../i18n'
import { useCloud, withCloud } from '../personal/sync'
import { areaNames, useScaleMap } from '../scaleMap'
import { displayName, useSocial } from '../social/store'

interface Report {
  note: string
  coords: LatLng
  accuracy: number
  time: number
}

interface UserReports {
  uid: string
  /** 上傳了幾次（每次都是完整的一份，只看最新的一份） */
  uploads: number
  lastUpload: number
  reports: Report[]
}

/** 每個人最新上傳的那一份（GeoJSON）轉成回報清單 */
function latestByUser(all: Record<string, Record<string, { geojson: string; createdAt: number }>>): UserReports[] {
  return Object.entries(all)
    .map(([uid, uploads]) => {
      const list = Object.values(uploads)
      const latest = list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
      const features = (JSON.parse(latest.geojson) as { features: { properties: { note: string; accuracy: number; time: string }; geometry: { coordinates: [number, number] } }[] }).features
      const reports = features
        .map((f) => ({
          note: f.properties.note,
          coords: [f.geometry.coordinates[1], f.geometry.coordinates[0]] as LatLng,
          accuracy: f.properties.accuracy,
          time: Date.parse(f.properties.time),
        }))
        .sort((a, b) => b.time - a.time)
      return { uid, uploads: list.length, lastUpload: latest.createdAt, reports }
    })
    .sort((a, b) => b.lastUpload - a.lastUpload)
}

/**
 * 管理員：所有人上傳的地圖回報（/reports），地圖上標出位置、下面依使用者列出。
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

  useEffect(() => {
    if (!admin) return
    let alive = true
    withCloud()
      .then(({ m }) => m.loadCalibrationUploads())
      .then(
        (all) => alive && setUsers(latestByUser(all)),
        (err: Error) => alive && setError(err.message),
      )
    return () => {
      alive = false
    }
  }, [admin])

  const time = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const all = users?.flatMap((u) => u.reports) ?? []

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
              <ScaleMap map={map.data} areaNames={areaNames(data, lang)} marks={all.map((r) => r.coords)} />
            </div>
          )}
          {users!.length === 0 && <p className="muted">{t('reports.empty')}</p>}
          {users!.map((u) => (
            <section key={u.uid} className="card">
              <h2>{displayName(social.profiles, u.uid)}</h2>
              <p className="muted small">{t('reports.user', { n: u.uploads, time: time(u.lastUpload) })}</p>
              <ol className="report-list">
                {u.reports.map((r, i) => (
                  <li key={i}>
                    <span className="report-note">{r.note}</span>
                    <span className="muted small">
                      <span className="mono">{formatCoords(r.coords)}</span> · ±{t('myloc.m', { n: r.accuracy })} · {time(r.time)}
                    </span>
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
