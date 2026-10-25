import { useRef, useState } from 'react'
import type { Sector } from '../data/schema'
import { relativeTime } from '../format'
import { localName, useLang } from '../i18n'
import { useWide } from '../layout'
import { useCloud } from '../personal/sync'
import { href, navigate, useRouteLink } from '../router'
import { displayName, useSocial } from '../social/store'
import { uploadTopo } from './actions'
import { useSectorTopos, type SectorTopo } from './store'
import { TopoFullscreen } from './TopoFullscreen'
import { TopoFrame, TopoLines } from './TopoView'

/** 路線 ID → 照片上顯示的編號（沒有編號的固定點等不顯示） */
export function routeLabels(sector: Sector): Map<string, string> {
  return new Map(sector.routes.filter((r) => r.number).map((r) => [r.id, r.number!]))
}

/** 電腦版、登入後才能上傳與編輯 */
function useCanEdit(): boolean {
  const wide = useWide()
  return useCloud().status === 'signed-in' && wide
}

/** 分區頁：這個分區的所有 Topo，點線段換到那條路線；電腦版登入後可以新增照片、編輯 */
export function SectorTopos({ sector }: { sector: Sector }) {
  const { lang, t } = useLang()
  const topos = useSectorTopos(sector.id)
  const canEdit = useCanEdit()
  const { link, selected } = useRouteLink()
  if (!topos || (topos.length === 0 && !canEdit)) return null
  const labels = routeLabels(sector)
  return (
    <section className="topos" aria-label={t('topo.title')}>
      {topos.map((topo) => (
        <figure key={topo.photo.id} className="topo">
          <TopoFrame photo={topo.photo} crop={topo.latest?.crop} alt={t('topo.alt', { name: localName(sector.name, lang).main })}>
            {(k) => topo.latest && <TopoLines photo={topo.photo} marks={topo.latest.marks} labels={labels} k={k} highlight={selected} link={link} crop={topo.latest.crop} />}
          </TopoFrame>
          {topo.latest && <FullscreenButton topo={topo} sector={sector} initial={selected} />}
          <TopoCaption topo={topo} canEdit={canEdit} />
        </figure>
      ))}
      {canEdit && <UploadButton sector={sector.id} />}
    </section>
  )
}

/** 路線頁：有標記這條路線的 Topo，這條用亮色並標出 bolt */
export function RouteTopos({ sector, routeId }: { sector: Sector; routeId: string }) {
  const { lang, t } = useLang()
  const topos = useSectorTopos(sector.id)?.filter((x) => x.latest?.marks[routeId])
  const canEdit = useCanEdit()
  if (!topos || topos.length === 0) return null
  const labels = routeLabels(sector)
  return (
    <section className="route-block topos">
      <h2>{t('topo.title')}</h2>
      {topos.map((topo) => (
        <figure key={topo.photo.id} className="topo">
          <TopoFrame photo={topo.photo} crop={topo.latest?.crop} alt={t('topo.alt', { name: localName(sector.name, lang).main })}>
            {(k) => <TopoLines photo={topo.photo} marks={topo.latest!.marks} labels={labels} k={k} highlight={routeId} crop={topo.latest!.crop} />}
          </TopoFrame>
          <FullscreenButton topo={topo} sector={sector} initial={routeId} />
          <TopoCaption topo={topo} canEdit={canEdit} />
        </figure>
      ))}
    </section>
  )
}

/** 照片右上角的全螢幕按鈕；全螢幕裡點路線只切換高亮，不離開 */
function FullscreenButton({ topo, sector, initial }: { topo: SectorTopo; sector: Sector; initial?: string }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="topo-full-open" aria-label={t('topo.fullscreen')} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
      {open && (
        <TopoFullscreen
          photo={topo.photo}
          crop={topo.latest!.crop}
          marks={topo.latest!.marks}
          labels={routeLabels(sector)}
          routes={sector.routes}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** 最後修改的人與時間；可以編輯時多一個「編輯」 */
function TopoCaption({ topo, canEdit }: { topo: SectorTopo; canEdit: boolean }) {
  const { t } = useLang()
  const profiles = useSocial().profiles
  const by = topo.latest ?? topo.photo
  return (
    <figcaption className="muted small">
      {t(topo.latest ? 'topo.editedBy' : 'topo.uploadedBy', {
        name: displayName(profiles, by.uid),
        time: relativeTime(new Date(by.createdAt).toISOString(), t),
      })}
      {canEdit && (
        <>
          {' · '}
          <a href={href.topo(topo.photo.id)}>{t('topo.edit')}</a>
        </>
      )}
    </figcaption>
  )
}

function UploadButton({ sector }: { sector: string }) {
  const { t } = useLang()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(undefined)
    try {
      navigate(href.topo(await uploadTopo(sector, file)))
    } catch (err) {
      setError(t('topo.uploadError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="topo-upload">
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <button className="action" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t('topo.uploading') : t('topo.add')}
      </button>
      {error && <p className="small error">{error}</p>}
    </div>
  )
}
