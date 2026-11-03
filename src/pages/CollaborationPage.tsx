import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { LoadedData } from '../data/dataset'
import { localName, useLang } from '../i18n'
import { useCloud, withCloud } from '../personal/sync'
import { SignInPrompt } from '../components/SignInPrompt'
import { createCollection, DriveError, uploadPhoto, type Collection } from '../collaboration/drive'
import './collaboration.css'

type Photo = { id: string; file: File; status: 'pending' | 'uploading' | 'done' | 'failed'; error?: string }
type Session = { uid: string; token: string }

function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return <img src={url || undefined} alt="" />
}

export function CollaborationPage({ data }: { data: LoadedData }) {
  const { t, lang } = useLang()
  const cloud = useCloud()
  const [authorization, setAuthorization] = useState<Session>()
  const session = authorization?.uid === cloud.user?.uid ? authorization : undefined
  const [folder, setFolder] = useState<(Collection & { uid: string })>()
  const collection = folder?.uid === cloud.user?.uid ? folder : undefined
  const [photos, setPhotos] = useState<Photo[]>([])
  const [area, setArea] = useState('')
  const [sector, setSector] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => abort.current?.abort(), [cloud.user?.uid])

  const errorText = (err: unknown) => err instanceof DriveError && err.status === 401
    ? t('collab.expired')
    : err instanceof DriveError && err.status === 403 ? t('collab.forbidden') : t('collab.uploadError')

  async function connect() {
    setConnecting(true)
    setError('')
    try {
      const { m, uid } = await withCloud()
      const token = await m.authorizeDrive()
      setAuthorization({ uid, token })
    } catch {
      setError(t('collab.connectError'))
    } finally { setConnecting(false) }
  }

  function select(files: FileList | null) {
    if (!files?.length) return
    const chosen = [...files]
    if (chosen.some(f => !/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type))) {
      setPhotos([])
      setError(t('collab.fileType'))
      return
    }
    setPhotos(chosen.map(file => ({ id: crypto.randomUUID(), file, status: 'pending' })))
    setFolder(undefined)
    setCopied(false)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!session || !consent || busy || !photos.some(p => p.status !== 'done')) return
    if (!navigator.onLine) { setError(t('collab.offline')); return }
    setBusy(true)
    setError('')
    const controller = new AbortController()
    abort.current = controller
    const update = (id: string, patch: Partial<Photo>) => setPhotos(old => old.map(p => p.id === id ? { ...p, ...patch } : p))
    try {
      const destination = collection ?? { ...await createCollection(session.token, controller.signal), uid: session.uid }
      setFolder(destination)
      for (const photo of photos.filter(p => p.status !== 'done')) {
        if (controller.signal.aborted) break
        update(photo.id, { status: 'uploading', error: undefined })
        try {
          await uploadPhoto(session.token, destination.id, photo.file, { area: area || undefined, sector: sector || undefined }, controller.signal)
          update(photo.id, { status: 'done' })
        } catch (err) {
          if (controller.signal.aborted) break
          update(photo.id, { status: 'failed', error: errorText(err) })
          if (err instanceof DriveError && err.status === 401) {
            setAuthorization(undefined)
            setError(t('collab.expired'))
            break
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(errorText(err))
      if (err instanceof DriveError && err.status === 401) setAuthorization(undefined)
    } finally { setBusy(false) }
  }

  const selectedArea = data.areaById.get(area)
  const done = photos.filter(p => p.status === 'done').length
  return (
    <article className="collaboration-page">
      <header className="collaboration-head">
        <span className="collaboration-mark" aria-hidden>↗</span>
        <div><h1>{t('collab.title')}</h1><p className="muted">{t('collab.intro')}</p></div>
      </header>
      <form className="card collaboration-form" onSubmit={e => void submit(e)}>
        <div className="collaboration-drive">
          <div><h2>{t('collab.storage')}</h2><p className="muted small">{t('collab.storageNote')}</p></div>
          {cloud.status === 'signed-in' ? <div>
            <p className="small">{cloud.user?.email}</p>
            <button type="button" className="action" onClick={() => void connect()} disabled={busy || connecting}>
              {connecting ? t('collab.connecting') : session ? t('collab.connected') : t('collab.connect')}
            </button>
          </div> : <SignInPrompt message={t('collab.signIn')} />}
        </div>
        <label className={`collaboration-picker${busy ? ' disabled' : ''}`}>
          <strong>{t('collab.choose')}</strong><span className="small muted">JPG · PNG · WebP · HEIC</span>
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={e => select(e.target.files)} disabled={busy} />
        </label>
        <div className="collaboration-location">
          <label>{t('collab.area')}<select value={area} disabled={busy || done > 0} onChange={e => { setArea(e.target.value); setSector('') }}>
            <option value="">{t('collab.optional')}</option>
            {data.dataset.areas.map(a => <option key={a.id} value={a.id}>{localName(a.name, lang).main}</option>)}
          </select></label>
          <label>{t('collab.sector')}<select value={sector} disabled={busy || done > 0 || !area} onChange={e => setSector(e.target.value)}>
            <option value="">{t('collab.optional')}</option>
            {selectedArea?.sectors.map(s => <option key={s.id} value={s.id}>{localName(s.name, lang).main}</option>)}
          </select></label>
        </div>
        {!!photos.length && <ul className="collaboration-photos" aria-label={t('collab.photos')}>
          {photos.map(p => <li key={p.id}>
            <Preview file={p.file} /><div><span className="collaboration-filename">{p.file.name}</span>
              <span className={`small ${p.status === 'failed' ? 'error' : 'muted'}`}>{p.error || t(`collab.${p.status}`)}</span>
            </div>
          </li>)}
        </ul>}
        <p className="small collaboration-notice">{t('collab.publicNotice')}</p>
        <label className="collaboration-consent"><input type="checkbox" checked={consent} required disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>{t('collab.consent')}</span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="collaboration-submit">
          <button type="submit" className="action primary" disabled={!session || !consent || !photos.length || busy || done === photos.length}>
            {busy ? t('collab.uploading') : photos.some(p => p.status === 'failed') ? t('collab.retry') : t('collab.upload')}
          </button>
          {!!photos.length && <span className="small muted" role="status">{t('collab.progress', { done, total: photos.length })}</span>}
        </div>
      </form>
      {collection && <section className="card collaboration-result">
        <h2>{t('collab.folder')}</h2>
        <a href={collection.url} target="_blank" rel="noreferrer">{t('collab.openFolder')} ↗</a>
        <button type="button" className="action" onClick={() => {
          void navigator.clipboard.writeText(collection.url).then(() => setCopied(true)).catch(() => setError(t('collab.copyError')))
        }}>{copied ? t('collab.copied') : t('collab.copy')}</button>
      </section>}
    </article>
  )
}
