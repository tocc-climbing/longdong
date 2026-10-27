import { useEffect, useMemo, useState } from 'react'
import { useWide } from '../layout'
import { inMapBounds } from '../map/bounds'
import { ScaleMap } from '../map/ScaleMap'
import { useGeolocation } from '../components/MyLocation'
import { LocationHelp } from '../components/LocationHelp'
import { Sheet } from '../components/Sheet'
import { addMark, hasUnuploaded, onCalibrationEvent, useCalibration, useSimulatedMarks, type ReportTarget } from '../map/calibration'
import type { LoadedData } from '../data/dataset'
import { RESCUE_POINTS, formatCoords } from '../data/rescue'
import { distanceM, nearestPoints, type LatLng } from '../geo'
import { localName, useLang, type MessageKey, type Translate } from '../i18n'
import { useCloud } from '../personal/sync'
import { reportOptions, type ReportOption } from '../map/reportOptions'
import { href, navigate } from '../router'
import { areaNames, project, useScaleMap } from '../map/mapData'
import { ORTHO_DOWNLOAD_MB, cachedOrthoCount, downloadOrtho, orthoDownloadUrls } from '../map/ortho'
import { insideRing } from '../map/reportOptions'
import { useSectorWalls } from '../map/shapes'
import { setSimulation, useSimulation } from '../simulate'
import { displayName, useSocial } from '../social/store'
import { ManualReportForm, WallDetails, sectorLabel } from './MapTools'

/** 誤差在這以內才適合當校正點 */
const GOOD_ACCURACY_M = 10
/** 附近沒有明確地點時，也可以選的一般描述 */
const GENERIC: MessageKey[] = ['map.quick.trail', 'map.quick.wallBase', 'map.quick.boundary']
const INTRO_KEY = 'longdong.map.intro'
/** 航照底圖開著（這台裝置記住） */
const ORTHO_KEY = 'longdong.map.ortho'
/** 回報後的提示顯示多久（毫秒） */
const TOAST_MS = 4000

/**
 * 地圖（/map）：照比例尺的龍洞地圖，打開就開始定位。
 * 地圖還在校正：第一次使用先說明可能有誤差；左上「回報」依目前位置列出附近的地點，選一下就記錄下來。
 * 回報時也可以在地圖上點出自己認為所在的位置（選填）：和 GPS 的差距可以看出地圖或 GPS 偏了多少。
 * 記錄先存在手機上，登入且連上網路時在背景自動上傳（src/map/calibration.ts，不必停在這一頁），用來校正地圖。
 * 不在現場（沒有定位、或不在龍洞）時「回報」改成手動回報：對照航照在地圖上點位置，選分區或路線。
 * 左上只有圖示：回報、航照（國土測繪中心的正射影像；看過的地方離線時照樣顯示，還沒存齊時提示下載整個範圍）、修改（電腦版、登入）。
 * 登入者看得到所有人畫的岩壁，點一段看詳細、本人與管理員可以刪除。
 * 電腦版的「編輯地圖」開編輯模式（/edit，src/edit/EditPage.tsx）。
 */
export function MapPage({ data, simulate }: { data: LoadedData; simulate?: LatLng }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const [geo, start] = useGeolocation()
  const simulated = useSimulation()
  // /map@緯度,經度：開始模擬（之後在這個分頁裡都有效，網址換回 /map）
  useEffect(() => {
    if (!simulate) return
    setSimulation(simulate)
    navigate(href.map(), { replace: true })
  }, [simulate?.[0], simulate?.[1]])
  const cloud = useCloud()
  const records = useCalibration()
  const simulatedMarks = useSimulatedMarks()
  const [intro, setIntro] = useState(() => !seenIntro())
  const [reporting, setReporting] = useState(false)
  /** 回報表單的內容：在地圖上點位置時表單會關起來，內容留在這裡 */
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  /** 正在地圖上點自己的位置 */
  const [picking, setPicking] = useState(false)
  const [toast, setToast] = useState<string>()
  const [ortho, setOrtho] = useState(() => readFlag(ORTHO_KEY))
  /** 離線航照：整個範圍存齊了沒、下載進度；undefined 表示還沒查（或這個瀏覽器不能離線快取） */
  const [offline, setOffline] = useState<{ done: number; total: number; downloading: boolean }>()
  /** 打開航照時提示下載離線航照，按「不用」後這次不再提示 */
  const [offlineOfferClosed, setOfflineOfferClosed] = useState(false)
  /** 手動回報：在地圖上點位置中／點好的位置（表單開著） */
  const [manualPicking, setManualPicking] = useState(false)
  const [manualAt, setManualAt] = useState<LatLng>()
  const [manualOpen, setManualOpen] = useState(false)
  const [selectedWall, setSelectedWall] = useState<string>()
  const wide = useWide()
  const { walls, error: wallsError } = useSectorWalls()
  const { profiles } = useSocial()
  const uid = cloud.status === 'signed-in' ? cloud.user?.uid : undefined
  const sectorNames = Object.fromEntries([...data.sectorById].map(([id, { sector }]) => [id, localName(sector.name, lang).main]))

  const names = areaNames(data, lang)
  const fix = geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy, time: geo.time } : undefined
  /** 定位到了但不在地圖範圍內：不能回報；離最近的救援點多遠 */
  const outside = fix && !simulated && !inMapBounds(fix.coords) ? nearestPoints(fix.coords, RESCUE_POINTS, 1)[0]?.distance : undefined
  const distance = (m: number) => (m < 1000 ? t('myloc.m', { n: Math.round(m) }) : t('myloc.km', { n: (m / 1000).toFixed(1) }))

  // 打開地圖就開始定位（瀏覽器第一次會詢問權限）
  useEffect(start, [])

  // 背景上傳、存檔的結果
  useEffect(
    () =>
      onCalibrationEvent((e) =>
        setToast(
          e.kind === 'sent'
            ? t('map.sent')
            : e.kind === 'simulated'
              ? t('sim.notSent')
              : e.kind === 'failed'
                ? t('map.uploadFailed', { error: e.error })
                : t('map.saveError'),
        ),
      ),
    [t],
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // 離線下載的圖磚（最清楚的層級只下載 9 個區域附近，要等地圖資料）
  const tiles = useMemo(() => (map.status === 'ok' ? orthoDownloadUrls(map.data.areas) : undefined), [map])

  // 開著航照時查離線快取存齊了沒
  useEffect(() => {
    if (!ortho || !tiles || !('caches' in window)) return
    let alive = true
    cachedOrthoCount(tiles).then(
      (done) => alive && setOffline((o) => o ?? { done, total: tiles.length, downloading: false }),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [ortho, tiles])

  const downloadOffline = async () => {
    setOffline((o) => o && { ...o, downloading: true })
    try {
      await downloadOrtho(tiles!, (done, total) => setOffline({ done, total, downloading: true }))
      setOffline((o) => o && { ...o, downloading: false })
      setToast(t('map.orthoDownloaded'))
    } catch (err) {
      setOffline((o) => o && { ...o, downloading: false })
      setToast(t('map.orthoDownloadFailed', { error: (err as Error).message }))
    }
  }

  const toggleOrtho = () => {
    writeFlag(ORTHO_KEY, !ortho)
    setOrtho(!ortho)
  }

  /** 按「回報」：在龍洞且定位到了就是現場回報；否則手動回報，先在地圖上點位置 */
  const startReport = () => {
    if (fix && outside === undefined) return setReporting(true)
    setManualAt(undefined)
    setManualPicking(true)
  }

  const submitManual = (note: string, target: ReportTarget) => {
    if (!manualAt) return
    addMark({ manual: true, coords: manualAt, time: Date.now(), note, target })
    setManualOpen(false)
    setManualAt(undefined)
    if (!simulated && (!navigator.onLine || (cloud.status === 'signed-in' && !cloud.connected))) setToast(t('map.queued'))
  }

  const report = (note: string) => {
    if (!fix) return
    addMark({ ...fix, note, ...(draft.at ? { picked: draft.at } : {}) })
    setDraft(EMPTY_DRAFT)
    setReporting(false)
    // 上傳成功會另外提示；沒網路時先存在手機上（不登入也能上傳）
    if (!simulated && (!navigator.onLine || (cloud.status === 'signed-in' && !cloud.connected))) setToast(t('map.queued'))
  }

  const closeIntro = () => {
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch {
      /* 存不了就下次再顯示一次 */
    }
    setIntro(false)
  }

  const pending = hasUnuploaded(records)
  const wall = walls.find((w) => w.key === selectedWall)
  const pick = picking
    ? { at: draft.at, onPick: (at: LatLng) => setDraft((d) => ({ ...d, at })) }
    : manualPicking
      ? { at: manualAt, onPick: setManualAt }
      : undefined
  /** 點的位置所在的大區域（手動回報預設選這個區域） */
  const areaAt = (at: LatLng) => (map.status === 'ok' ? map.data.areas.findLast((a) => a.rings.some((r) => insideRing(project(at), r)))?.id : undefined)

  return (
    <div className="map-page">
      {map.status === 'ok' ? (
        <ScaleMap
          map={map.data}
          areaNames={names}
          here={fix}
          marks={[...records.marks, ...simulatedMarks].map((m) => ({ at: m.coords, picked: 'manual' in m ? undefined : m.picked }))}
          pick={pick}
          ortho={ortho}
          lines={[
            ...walls.map((w) => ({ key: w.key, points: w.points, label: sectorLabel(data, w.sector, lang), selected: w.key === selectedWall })),
          ]}
          onLineTap={setSelectedWall}
          sectorNames={sectorNames}
          onAreaPress={(key) => navigate(href.area(`${data.dataset.crag.id}/${key}`))}
          onLocate={() => {
            if (outside !== undefined) setToast(t('map.outside', { dist: distance(outside) }))
            else if (geo.status === 'locating') setToast(t('map.locating'))
            else if (geo.status !== 'ok') {
              start()
              setToast(t('map.locating'))
            }
          }}
          topLeft={
            <>
              {/* 只用圖示：回報（有還沒上傳的記錄時加一個點）、航照、修改（電腦版、登入） */}
              <button type="button" className="sm-control sm-tool report" onClick={startReport} aria-label={t('map.report')} title={t('map.report')}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                  <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor" />
                </svg>
                {pending && <span className="sm-chip-dot" aria-label={t('map.pending')} />}
              </button>
              <button type="button" className="sm-control sm-tool" aria-pressed={ortho} onClick={toggleOrtho} aria-label={t('map.ortho')} title={t('map.ortho')}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                  <path d="M12 3 2 8.5 12 14l10-5.5L12 3zm-7.6 8.8L2 13.1 12 18.6l10-5.5-2.4-1.3L12 16l-7.6-4.2zm0 4.4L2 17.5 12 23l10-5.5-2.4-1.3L12 20.4l-7.6-4.2z" fill="currentColor" />
                </svg>
              </button>
              {wide && uid && (
                <a className="sm-control sm-tool" href={href.edit('map', 'trails')} aria-label={t('shape.edit')} title={t('shape.edit')}>
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                    <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor" />
                  </svg>
                </a>
              )}
            </>
          }
        />
      ) : (
        <p className={map.status === 'error' ? 'small error map-status' : 'muted small map-status'} role={map.status === 'error' ? 'alert' : 'status'}>
          {map.status === 'error' ? t('map.loadFailed', { error: map.message }) : t('app.loading')}
        </p>
      )}

      {picking && (
        <div className="map-pick-bar" role="status">
          <span>{t('map.pickPrompt')}</span>
          <button
            type="button"
            className="action primary"
            disabled={!draft.at}
            onClick={() => {
              setPicking(false)
              setReporting(true)
            }}
          >
            {t('map.pickDone')}
          </button>
          <button
            type="button"
            className="action"
            onClick={() => {
              setDraft((d) => ({ ...d, at: undefined }))
              setPicking(false)
              setReporting(true)
            }}
          >
            {t('map.cancel')}
          </button>
        </div>
      )}

      {manualPicking && (
        <div className="map-pick-bar" role="status">
          <span>{t('map.manualPick')}</span>
          <button
            type="button"
            className="action primary"
            disabled={!manualAt}
            onClick={() => {
              setManualPicking(false)
              setManualOpen(true)
            }}
          >
            {t('map.pickDone')}
          </button>
          <button type="button" className="action" onClick={() => setManualPicking(false)}>
            {t('map.cancel')}
          </button>
        </div>
      )}


      <div className="map-toasts">
        {geo.status === 'error' && (
          <p className="map-toast warn" role="alert">
            {t(geo.code === 'denied' ? 'map.denied' : 'map.unavailable')}
            {geo.code === 'denied' && <LocationHelp />}
          </p>
        )}
        {toast && (
          <p className="map-toast" role="status">
            {toast}
          </p>
        )}
        {ortho && offline && offline.done < offline.total && !offlineOfferClosed && (
          <p className="map-toast offer" role="status">
            {offline.downloading ? t('map.orthoDownloading', { done: offline.done, total: offline.total }) : t('map.orthoOffer')}
            {!offline.downloading && (
              <>
                <button type="button" className="link-button" onClick={() => void downloadOffline()}>
                  {t('map.orthoDownload', { mb: ORTHO_DOWNLOAD_MB })}
                </button>
                <button type="button" className="link-button" onClick={() => setOfflineOfferClosed(true)}>
                  {t('map.orthoNoThanks')}
                </button>
              </>
            )}
          </p>
        )}
        {wallsError && (
          <p className="map-toast warn" role="alert">
            {t('wall.loadFailed', { error: wallsError })}
          </p>
        )}
      </div>

      <Sheet open={intro} onClose={closeIntro} title={t('map.introTitle')}>
        <p className="map-warn">{t('map.introWarn')}</p>
        <ul className="map-how">
          <li>{t('map.introHow')}</li>
          <li>{t('map.introReport')}</li>
        </ul>
        <div className="actions">
          <button type="button" className="action primary" onClick={closeIntro}>
            {t('map.introOk')}
          </button>
        </div>
      </Sheet>

      <Sheet open={manualOpen && !!manualAt} onClose={() => setManualOpen(false)} title={t('map.manualTitle')}>
        {manualAt && (
          <ManualReportForm
            data={data}
            at={manualAt}
            areaKey={areaAt(manualAt)}
            onRepick={() => {
              setManualOpen(false)
              setManualPicking(true)
            }}
            onSubmit={submitManual}
            onCancel={() => setManualOpen(false)}
          />
        )}
      </Sheet>

      <Sheet open={!!wall} onClose={() => setSelectedWall(undefined)} title={t('wall.title')}>
        {wall && (
          <WallDetails data={data} wall={wall} author={displayName(profiles, wall.uid)} canEdit={wide && !!uid} />
        )}
      </Sheet>

      <Sheet open={reporting} onClose={() => setReporting(false)} title={t('map.reportTitle')}>
        {map.status === 'ok' && (
          <ReportForm
            fix={fix}
            options={fix ? reportOptions(project(fix.coords), map.data, RESCUE_POINTS) : []}
            areaNames={names}
            draft={draft}
            onDraft={setDraft}
            onPick={() => {
              setReporting(false)
              setPicking(true)
            }}
            onSubmit={report}
            onCancel={() => setReporting(false)}
          />
        )}
      </Sheet>
    </div>
  )
}

function seenIntro(): boolean {
  return readFlag(INTRO_KEY)
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    /* 存不了就只在這次有效 */
  }
}

/** 選項的文字（也是記錄下來的說明） */
function optionLabel(o: ReportOption, areaNames: Record<string, string>, lang: Parameters<typeof localName>[1], t: Translate): string {
  if (o.kind === 'area') return t(o.inside ? 'map.inArea' : 'map.nearArea', { name: areaNames[o.id] ?? o.id })
  if (o.kind === 'rescue') return t('map.rescue', { no: o.no, name: localName(o.name, lang).main })
  const m = o.marker
  if (m.kind === 'ems') return t('map.ems', { n: m.no })
  if (m.kind === 'place') return lang === 'en' ? m.en : m.zh
  return t(m.kind === 'parking' ? 'map.parking' : m.kind === 'boat' ? 'map.boat' : 'map.hoist')
}

/** 回報表單的內容：選的地點、補充說明、在地圖上點的位置 */
interface Draft {
  place?: string
  extra: string
  at?: LatLng
}
const EMPTY_DRAFT: Draft = { extra: '' }

function ReportForm({
  fix,
  options,
  areaNames,
  draft,
  onDraft,
  onPick,
  onSubmit,
  onCancel,
}: {
  fix?: { coords: [number, number]; accuracy: number }
  options: ReportOption[]
  areaNames: Record<string, string>
  draft: Draft
  onDraft: (update: (d: Draft) => Draft) => void
  /** 到地圖上點自己的位置 */
  onPick: () => void
  onSubmit: (note: string) => void
  onCancel: () => void
}) {
  const { lang, t } = useLang()
  const { place: picked, extra } = draft
  const setPicked = (place: string | undefined) => onDraft((d) => ({ ...d, place }))
  const setExtra = (value: string) => onDraft((d) => ({ ...d, extra: value }))
  const choices = [
    ...options.map((o) => ({ label: optionLabel(o, areaNames, lang, t), distance: o.distance })),
    ...GENERIC.map((k) => ({ label: t(k), distance: undefined })),
  ]
  const note = [picked, extra.trim()].filter(Boolean).join(' · ')

  if (!fix) return <p className="muted small">{t('map.noFix')}</p>

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (note) onSubmit(note)
      }}
    >
      <p className="small">
        <span className="mono">{formatCoords(fix.coords)}</span>
        <span className={fix.accuracy <= GOOD_ACCURACY_M ? 'muted' : 'warn'}> · {t('map.accuracy', { m: Math.round(fix.accuracy) })}</span>
      </p>
      <p className="map-question">{t('map.where')}</p>
      <div className="chips">
        {choices.map((c) => (
          <button key={c.label} type="button" className="chip" aria-pressed={picked === c.label} onClick={() => setPicked(picked === c.label ? undefined : c.label)}>
            {c.label}
            {c.distance !== undefined && c.distance > 0 && <span className="chip-meta"> {t('myloc.m', { n: Math.round(c.distance) })}</span>}
          </button>
        ))}
      </div>
      <p className="map-question">{t('map.pickQuestion')}</p>
      <div className="map-pick-row">
        {draft.at ? (
          <>
            <span className="small">{t('map.pickedAt', { m: Math.round(distanceM(fix.coords, draft.at)) })}</span>
            <button type="button" className="link-button" onClick={onPick}>
              {t('map.repick')}
            </button>
            <button type="button" className="link-button" onClick={() => onDraft((d) => ({ ...d, at: undefined }))}>
              {t('map.clearPick')}
            </button>
          </>
        ) : (
          <button type="button" className="action" onClick={onPick}>
            {t('map.pickButton')}
          </button>
        )}
      </div>
      <input className="map-extra" type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('map.extra')} aria-label={t('map.extra')} />
      <div className="actions">
        <button type="submit" className="action primary" disabled={!note}>
          {t('map.send')}
        </button>
        <button type="button" className="action" onClick={onCancel}>
          {t('map.cancel')}
        </button>
      </div>
    </form>
  )
}
