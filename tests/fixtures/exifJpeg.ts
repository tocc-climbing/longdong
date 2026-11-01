/**
 * 測試用：在 JPEG 的開頭插入一段 EXIF（APP1），只放拍照資料會讀的欄位（src/topo/shot.ts）。
 * TIFF 小端序；IFD0 有機型與兩個指標，Exif IFD 有拍攝時間與焦距，GPS IFD 有位置、高度與相機朝向。
 */
export interface ExifFields {
  make: string
  model: string
  /** 'YYYY:MM:DD HH:MM:SS' */
  time: string
  focal35: number
  lat: number
  lng: number
  alt: number
  heading: number
  headingRef: 'T' | 'M'
}

type Entry = { tag: number; type: number; count: number; data: number[] }

const ASCII = 2
const SHORT = 3
const LONG = 4
const RATIONAL = 5

const ascii = (tag: number, s: string): Entry => ({ tag, type: ASCII, count: s.length + 1, data: [...Buffer.from(s + '\0', 'latin1')] })
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]
const rational = (tag: number, values: number[]): Entry => ({
  tag,
  type: RATIONAL,
  count: values.length,
  data: values.flatMap((v) => [...u32(Math.round(v * 10000)), ...u32(10000)]),
})
const dms = (deg: number) => {
  const d = Math.floor(deg)
  const m = Math.floor((deg - d) * 60)
  return [d, m, (deg - d - m / 60) * 3600]
}

/** 一個 IFD 寫在 offset：項目、下一個 IFD（0）、放不進 4 bytes 的資料接在後面 */
function ifd(entries: Entry[], offset: number): number[] {
  const head = 2 + entries.length * 12 + 4
  const out: number[] = [entries.length & 255, entries.length >> 8]
  const extra: number[] = []
  for (const e of entries) {
    out.push(e.tag & 255, e.tag >> 8, e.type, 0, ...u32(e.count))
    if (e.data.length <= 4) out.push(...e.data, ...Array(4 - e.data.length).fill(0))
    else {
      out.push(...u32(offset + head + extra.length))
      extra.push(...e.data, ...(e.data.length % 2 ? [0] : []))
    }
  }
  return [...out, 0, 0, 0, 0, ...extra]
}

const size = (entries: Entry[]) => ifd(entries, 0).length

export function withExif(jpeg: Uint8Array, f: ExifFields): Uint8Array<ArrayBuffer> {
  const exif = [ascii(0x9003, f.time), { tag: 0xa405, type: SHORT, count: 1, data: [f.focal35 & 255, f.focal35 >> 8] }]
  const gps = [
    ascii(0x0001, f.lat >= 0 ? 'N' : 'S'),
    rational(0x0002, dms(Math.abs(f.lat))),
    ascii(0x0003, f.lng >= 0 ? 'E' : 'W'),
    rational(0x0004, dms(Math.abs(f.lng))),
    { tag: 0x0005, type: 1, count: 1, data: [0] },
    rational(0x0006, [f.alt]),
    ascii(0x0010, f.headingRef),
    rational(0x0011, [f.heading]),
  ]
  const ifd0 = (exifAt: number, gpsAt: number) => [
    ascii(0x010f, f.make),
    ascii(0x0110, f.model),
    { tag: 0x8769, type: LONG, count: 1, data: u32(exifAt) },
    { tag: 0x8825, type: LONG, count: 1, data: u32(gpsAt) },
  ]
  const at0 = 8
  const exifAt = at0 + size(ifd0(0, 0))
  const gpsAt = exifAt + size(exif)
  const tiff = [0x49, 0x49, 42, 0, ...u32(at0), ...ifd(ifd0(exifAt, gpsAt), at0), ...ifd(exif, exifAt), ...ifd(gps, gpsAt)]
  const body = [...Buffer.from('Exif\0\0', 'latin1'), ...tiff]
  const length = body.length + 2
  const app1 = [0xff, 0xe1, length >> 8, length & 255, ...body]
  return new Uint8Array([...jpeg.slice(0, 2), ...app1, ...jpeg.slice(2)])
}
