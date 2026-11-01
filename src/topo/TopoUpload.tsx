import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../i18n'
import { useCoarse } from '../layout'
import { href, navigate } from '../router'
import { uploadTopo } from './actions'
import { CropBox } from './CropBox'
import { FULL_CROP, isFullCrop, type Crop } from '../core/topo/geometry'
import type { TopoPhoto } from './model'

/**
 * 選照片上傳到分區：選了照片先裁切（只留岩壁），按「上傳」才上傳；成功後進入那張照片的編輯（onUploaded：在這個畫面接著編輯，不換頁）。
 * pick 開檔案選擇、input 要放進畫面（隱藏的 file input 與裁切畫面）
 */
export function useTopoUpload(sector: string, onUploaded: (photo: string) => void = (photo) => navigate(href.topo(photo))): { pick: () => void; input: ReactNode; busy: boolean; error?: string } {
  const { t } = useLang()
  const ref = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const reset = () => {
    setFile(undefined)
    if (ref.current) ref.current.value = ''
  }
  const upload = async (crop: Crop) => {
    if (!file) return
    setBusy(true)
    setError(undefined)
    reset()
    try {
      onUploaded(await uploadTopo(sector, file, isFullCrop(crop) ? undefined : crop))
    } catch (err) {
      setError(t('topo.uploadError', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }
  return {
    pick: () => ref.current?.click(),
    input: (
      <>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0])} />
        {/* 放在 body：上傳按鈕可能在收起來的清單裡 */}
        {file && createPortal(<UploadCrop file={file} onCancel={reset} onUpload={(crop) => void upload(crop)} />, document.body)}
      </>
    ),
    busy,
    error,
  }
}

/** 上傳前的裁切：整個畫面的照片與裁切框，下面是取消、整張照片、上傳 */
function UploadCrop({ file, onCancel, onUpload }: { file: File; onCancel: () => void; onUpload: (crop: Crop) => void }) {
  const { t } = useLang()
  const coarse = useCoarse()
  const dialog = useRef<HTMLDialogElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const [src] = useState(() => URL.createObjectURL(file))
  const [size, setSize] = useState<{ width: number; height: number }>()
  /** 照片區的大小：照片縮到放得下 */
  const [room, setRoom] = useState({ w: 0, h: 0 })
  const [crop, setCrop] = useState<Crop>(FULL_CROP)
  useEffect(() => {
    dialog.current!.showModal()
    return () => URL.revokeObjectURL(src)
  }, [src])
  useLayoutEffect(() => {
    const el = area.current!
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const photo = size && ({ ...size, image: '' } as TopoPhoto)
  const shown = photo ? Math.min(room.w, (room.h * photo.width) / photo.height) : 0
  return (
    <dialog
      ref={dialog}
      className="topo-upload-crop"
      aria-label={t('topo.modeCrop')}
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <div className="topo-upload-crop-photo" ref={area}>
        {/* 先載入量大小（照片的方向照 EXIF 轉正，和上傳時一樣） */}
        {!photo && <img src={src} alt="" hidden onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />}
        {photo && (
          <div className="topo-upload-crop-frame" style={{ width: shown, height: (shown * photo.height) / photo.width }}>
            <img src={src} alt="" draggable={false} />
            <svg viewBox={`0 0 ${photo.width} ${photo.height}`}>
              <CropBox photo={photo} crop={crop} k={shown > 0 ? photo.width / shown : 1} handle={coarse ? 28 : 12} onChange={setCrop} />
            </svg>
          </div>
        )}
      </div>
      <div className="topo-upload-crop-actions">
        <button type="button" className="action" onClick={onCancel}>
          {t('action.cancel')}
        </button>
        <button type="button" className="action" disabled={isFullCrop(crop)} onClick={() => setCrop(FULL_CROP)}>
          {t('topo.cropReset')}
        </button>
        <button type="button" className="action primary" disabled={!size} onClick={() => onUpload(crop)}>
          {t('topo.cropUpload')}
        </button>
      </div>
    </dialog>
  )
}

export function UploadButton({ sector, className = 'action', onUploaded }: { sector: string; className?: string; onUploaded?: (photo: string) => void }) {
  const { t } = useLang()
  const { pick, input, busy, error } = useTopoUpload(sector, onUploaded)
  return (
    <div className="topo-upload">
      {input}
      <button type="button" className={className} disabled={busy} onClick={pick}>
        {busy ? t('topo.uploading') : t('topo.add')}
      </button>
      {error && <p className="small error">{error}</p>}
    </div>
  )
}
