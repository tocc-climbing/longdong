import { useEffect, useRef, useState } from 'react'
import type { LoadedData } from '../data/dataset'
import type { Area, Route, Sector } from '../data/schema'
import { RESCUE_POINTS } from '../data/rescue'
import { distanceM, nearestPoints, type LatLng } from '../geo'
import { localName, useLang } from '../i18n'
import { inMapBounds } from '../map/bounds'
import { addMark, type ReportTarget } from '../map/calibration'
import { areaNames, useScaleMap } from '../map/mapData'
import { ScaleMap } from '../map/ScaleMap'
import { LocationHelp } from './LocationHelp'
import { useGeolocation } from './MyLocation'
import { Sheet } from './Sheet'
import { useSimulation } from '../simulate'
import { useCloud } from '../personal/sync'
import { uploadTopo } from '../topo/actions'
import { fromOrientation, readExif, type Orientation, type Shot } from '../core/topo/shot'

/** 誤差在這以內才適合當校正點（與地圖頁相同） */
const GOOD_ACCURACY_M = 10
/** 送出後「已記錄」顯示多久（毫秒） */
const SENT_MS = 4000

type Kind = ReportTarget['kind']

/** 回報附的照片：檔案與按下拍照那一刻的手機姿態 */
interface Photo {
  file: File
  url: string
  pose: Shot
}

/** iOS 要先取得使用者同意才收得到手機姿態（必須在點按的當下要求） */
type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> }

/** 回報畫面開著時持續記下最新的手機姿態（Android 優先用以北為準的 deviceorientationabsolute） */
function useOrientation(on: boolean) {
  const latest = useRef<Orientation>(undefined)
  useEffect(() => {
    if (!on) return
    const onEvent = (e: Event) => {
      const o = e as DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number }
      if (e.type === 'deviceorientation' && latest.current?.absolute && !o.absolute) return
      latest.current = {
        alpha: o.alpha,
        beta: o.beta,
        gamma: o.gamma,
        absolute: o.absolute || e.type === 'deviceorientationabsolute',
        webkitCompassHeading: o.webkitCompassHeading,
        webkitCompassAccuracy: o.webkitCompassAccuracy,
      }
    }
    window.addEventListener('deviceorientationabsolute', onEvent)
    window.addEventListener('deviceorientation', onEvent)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onEvent)
      window.removeEventListener('deviceorientation', onEvent)
    }
  }, [on])
  return latest
}
const KINDS: Kind[] = ['start', 'rest', 'top', 'base']

/**
 * 「回報位置」：路線頁回報這條路線的起攀點、休息點、頂端或這面牆的牆底；分區頁回報這個分區的牆底；
 * 區域頁先選分區，再回報那個分區的牆底。區域、分區、路線從頁面帶入，不必再選；
 * 地圖放大到這個區域、畫出岩壁（回報的分區標成選取），點一下標出自己的位置（岩壁下 GPS 常偏）。
 * 和地圖頁的回報存在同一份記錄裡（src/map/calibration.ts），在背景自動上傳；多了 target 記下回報的是哪裡。
 */
export function PlaceReport({ data, area, sector, route }: { data: LoadedData; area: Area; sector?: Sector; route?: Route }) {
  const { lang, t } = useLang()
  const map = useScaleMap()
  const [geo, start] = useGeolocation()
  const simulated = useSimulation()
  const [open, setOpen] = useState(false)
  const [chosenKind, setKind] = useState<Kind>()
  const [chosenSector, setSector] = useState<Sector>()
  // 沒有路線時只能回報牆底；沒有分區時（區域頁）要先選分區
  const kind = route ? chosenKind : 'base'
  const target = sector ?? chosenSector
  const [picked, setPicked] = useState<LatLng>()
  const [extra, setExtra] = useState('')
  const [sent, setSent] = useState(false)
  const signedIn = useCloud().status === 'signed-in'
  const [photos, setPhotos] = useState<Photo[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string>()
  const photoInput = useRef<HTMLInputElement>(null)
  const pose = useOrientation(open && signedIn)
  /** 按下拍照那一刻的姿態（選好照片回來時手機已經放下了） */
  const poseAtTap = useRef<Shot>({})

  useEffect(() => {
    if (!sent) return
    const timer = setTimeout(() => setSent(false), SENT_MS)
    return () => clearTimeout(timer)
  }, [sent])

  const fix = geo.status === 'ok' ? { coords: geo.coords, accuracy: geo.accuracy, time: geo.time } : undefined
  /** 不在龍洞地圖範圍內（例如在家裡打開）：不能回報，說明離最近的救援點多遠 */
  const outside = fix && !simulated && !inMapBounds(fix.coords) ? nearestPoints(fix.coords, RESCUE_POINTS, 1)[0]?.distance : undefined
  const distance = (m: number) => (m < 1000 ? t('myloc.m', { n: Math.round(m) }) : t('myloc.km', { n: (m / 1000).toFixed(1) }))
  const routeName = route && `${route.number ? `#${route.number} ` : ''}${localName(route.name, lang).main}`

  const openSheet = () => {
    setKind(undefined)
    setSector(undefined)
    setPicked(undefined)
    setExtra('')
    setPhotos((list) => {
      list.forEach((p) => URL.revokeObjectURL(p.url))
      return []
    })
    setUploadError(undefined)
    setOpen(true)
    if (geo.status !== 'ok') start()
  }

  const takePhoto = () => {
    const permission = (window.DeviceOrientationEvent as OrientationPermission | undefined)?.requestPermission
    if (permission) void permission().catch(() => 'denied')
    poseAtTap.current = pose.current ? fromOrientation(pose.current) : {}
    photoInput.current?.click()
  }

  const addPhotos = (files: FileList | null) => {
    const picked = [...(files ?? [])].map((file) => ({ file, url: URL.createObjectURL(file), pose: poseAtTap.current }))
    setPhotos((list) => [...list, ...picked])
  }

  const removePhoto = (photo: Photo) => {
    URL.revokeObjectURL(photo.url)
    setPhotos((list) => list.filter((p) => p !== photo))
  }

  const submit = async () => {
    if (!kind || !target || !fix || outside !== undefined || uploading) return
    // 照片先上傳（放進這個分區的 Topo）：失敗時留在這個畫面，位置也還沒記錄，再按一次送出不會重複
    if (photos.length) {
      setUploading(true)
      setUploadError(undefined)
      try {
        for (const photo of photos) {
          const shot: Shot = { lat: fix.coords[0], lng: fix.coords[1], accuracy: fix.accuracy, ...photo.pose, ...(await readExif(photo.file)) }
          await uploadTopo(target.id, photo.file, undefined, shot)
          removePhoto(photo)
        }
      } catch (err) {
        setUploadError((err as Error).message)
        return
      } finally {
        setUploading(false)
      }
    }
    // 說明：管理頁的清單直接看得懂（「#62 火龍 · 起攀點」「地下二樓 · 牆底」）
    const what = kind === 'base' || !routeName ? localName(target.name, lang).main : routeName
    const note = [`${what} · ${t(`place.kind.${kind}`)}`, extra.trim()].filter(Boolean).join(' · ')
    addMark({
      ...fix,
      note,
      ...(picked ? { picked } : {}),
      target: { kind, areaId: area.id, sectorId: target.id, ...(kind === 'base' || !route ? {} : { routeId: route.id }) },
    })
    setOpen(false)
    setSent(true)
  }

  return (
    <>
      {/* 標題卡右上的圖示（定位圖釘）；送出後圖示短暫換成打勾，提示改成已記錄 */}
      <button
        type="button"
        className={`tool-button place-report-button${sent ? ' on' : ''}`}
        aria-label={sent ? t(simulated ? 'sim.notSent' : 'place.sent') : t('place.button')}
        title={sent ? t(simulated ? 'sim.notSent' : 'place.sent') : t('place.button')}
        onClick={openSheet}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          {sent ? (
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.3" fill="currentColor" />
            </>
          )}
        </svg>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('place.title')} locked={uploading}>
        <form
          className="place-report"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {/* 上傳照片中：表單全部鎖住（記錄的是按下送出時的內容） */}
          <fieldset className="place-report-fields" disabled={uploading}>
            {route ? (
              <>
                <p className="map-question">{t('place.which')}</p>
                <div className="chips">
                  {KINDS.map((k) => (
                    <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? undefined : k)}>
                      {t(`place.kind.${k}`)}
                    </button>
                  ))}
                </div>
              </>
            ) : sector ? (
              <p className="map-question">
                {localName(sector.name, lang).main} · {t('place.kind.base')}
              </p>
            ) : (
              <>
                <p className="map-question">{t('place.whichSector')}</p>
                <div className="chips">
                  {area.sectors.map((x) => (
                    <button key={x.id} type="button" className="chip" aria-pressed={chosenSector === x} onClick={() => setSector(chosenSector === x ? undefined : x)}>
                      {localName(x.name, lang).main}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="map-question">
              {t('place.pick')}
            </p>
            <div className="place-report-map">
              {map.status === 'ok' && (
                <ScaleMap
                  map={map.data}
                  areaNames={areaNames(data, lang)}
                  here={fix}
                  marks={[]}
                  focus={{ key: area.id, area: area.id.split('/').pop() }}
                  lines={Object.entries(map.data.walls).flatMap(([id, walls]) =>
                    walls.map((points, i) => ({ key: `${id}#${i}`, points, area: data.sectorById.get(id)?.area.id.split('/').pop(), selected: id === target?.id })),
                  )}
                  pick={{ at: picked, onPick: (at) => !uploading && setPicked(at) }}
                />
              )}
            </div>
            <p className="small">
              {geo.status === 'error' ? (
                <>
                  <span className="warn">{t(geo.code === 'denied' ? 'map.denied' : 'map.unavailable')}</span>
                  {geo.code === 'denied' && <LocationHelp />}
                </>
              ) : !fix ? (
                <span className="muted">{t('map.locating')}</span>
              ) : outside !== undefined ? (
                <span className="warn">{t('map.outsideReport', { dist: distance(outside) })}</span>
              ) : (
                <>
                  <span className={fix.accuracy <= GOOD_ACCURACY_M ? 'muted' : 'warn'}>{t('map.accuracy', { m: Math.round(fix.accuracy) })}</span>
                  {picked && <span className="muted"> · {t('map.pickedAt', { m: Math.round(distanceM(fix.coords, picked)) })}</span>}
                </>
              )}
            </p>

            <input className="map-extra" type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('map.extra')} aria-label={t('map.extra')} />
            {signedIn && (
              <div className="place-photos">
                {photos.map((p) => (
                  <span key={p.url} className="place-photo">
                    <img src={p.url} alt="" />
                    <button type="button" aria-label={t('place.removePhoto')} onClick={() => removePhoto(p)}>
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" className="action place-photo-add" onClick={takePhoto}>
                  {t('place.photo')}
                </button>
                <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => (addPhotos(e.target.files), (e.target.value = ''))} />
              </div>
            )}
            {uploading && <p className="small muted">{t('topo.uploading')}</p>}
            {uploadError && <p className="small warn">{t('topo.uploadError', { error: uploadError })}</p>}
            <div className="actions">
              <button type="submit" className="action primary" disabled={!kind || !target || !fix || outside !== undefined || uploading}>
                {t('map.send')}
              </button>
              <button type="button" className="action" onClick={() => setOpen(false)}>
                {t('map.cancel')}
              </button>
            </div>
          </fieldset>
        </form>
      </Sheet>
    </>
  )
}
