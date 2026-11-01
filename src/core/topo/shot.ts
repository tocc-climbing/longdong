/**
 * 拍照資料：回報附照片時，能存下來的都存（之後用來推算岩壁朝向、和牆線比對）。照片上傳前會重新編碼，原檔的 EXIF 不會留下，
 * 所以先讀出來另外存在 /v2/topos/<照片>/shot。全部都是選填：手機、瀏覽器、使用者的權限不同，拿得到的不一樣。
 */
export interface Shot {
  /** 回報時手機的定位與誤差（公尺） */
  lat?: number
  lng?: number
  accuracy?: number
  /** 按下拍照那一刻的手機姿態（deviceorientation，度）：alpha 繞垂直軸（absolute 時以北為準）、beta 前後傾、gamma 左右傾 */
  alpha?: number
  beta?: number
  gamma?: number
  absolute?: boolean
  /** iOS 的指南針（webkitCompassHeading，度，磁北）與誤差（度） */
  compass?: number
  compassAccuracy?: number
  /** EXIF：拍攝時間（毫秒）、位置、高度（公尺）、相機朝向（度；ref：T 正北、M 磁北）、機型、等效 35mm 焦距 */
  time?: number
  exifLat?: number
  exifLng?: number
  exifAlt?: number
  exifHeading?: number
  exifHeadingRef?: 'T' | 'M'
  make?: string
  model?: string
  focal35?: number
}

/** 手機姿態（deviceorientation 事件裡要存的欄位） */
export interface Orientation {
  alpha: number | null
  beta: number | null
  gamma: number | null
  absolute: boolean
  webkitCompassHeading?: number
  webkitCompassAccuracy?: number
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : undefined)
/** 只留有值的欄位（資料庫不收 undefined） */
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

/** 手機姿態 → 拍照資料 */
export function fromOrientation(o: Orientation): Shot {
  return defined({
    alpha: num(o.alpha),
    beta: num(o.beta),
    gamma: num(o.gamma),
    absolute: o.alpha === null ? undefined : o.absolute,
    compass: num(o.webkitCompassHeading),
    compassAccuracy: num(o.webkitCompassAccuracy),
  })
}

/** exifr 讀出來的欄位 → 拍照資料 */
export function fromExif(raw: Record<string, unknown> | undefined): Shot {
  if (!raw) return {}
  const time = raw.DateTimeOriginal instanceof Date ? raw.DateTimeOriginal.getTime() : undefined
  const ref = raw.GPSImgDirectionRef
  return defined({
    time: num(time),
    exifLat: num(raw.latitude),
    exifLng: num(raw.longitude),
    exifAlt: num(raw.GPSAltitude),
    exifHeading: num(raw.GPSImgDirection),
    exifHeadingRef: ref === 'T' || ref === 'M' ? ref : undefined,
    make: text(raw.Make),
    model: text(raw.Model),
    focal35: num(raw.FocalLengthIn35mmFormat),
  })
}

const EXIF_TAGS = ['DateTimeOriginal', 'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSAltitude', 'GPSImgDirection', 'GPSImgDirectionRef', 'Make', 'Model', 'FocalLengthIn35mmFormat']

/** 讀照片的 EXIF（沒有 EXIF、或是不帶 EXIF 的格式時是空的）；讀取的程式只有用到時才載入 */
export async function readExif(file: Blob): Promise<Shot> {
  const { default: exifr } = await import('exifr')
  try {
    return fromExif(await exifr.parse(await file.arrayBuffer(), { pick: EXIF_TAGS }))
  } catch (err) {
    if ((err as Error).message.startsWith('Unknown file format')) return {}
    throw err
  }
}
