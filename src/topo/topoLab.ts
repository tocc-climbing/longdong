import {
  decodeEdit,
  encodeMarks,
  isFullCrop,
  MIN_CROP,
  SCALE,
  type Crop,
  type Marks,
  type StoredRoutes,
  type TopoPhoto,
} from './model'

/** 單指點擊與拖曳平移的分界（螢幕像素）：移動不超過這個距離且未發生多指觸控才算點擊 */
export const TAP_MAX_PX = 6

/** 實驗頁內建的兩張測試 Topo 照片（免登入、離線或模擬器環境皆可直接載入） */
export const LAB_PHOTOS: TopoPhoto[] = [
  {
    id: '-P4lMof7izFRpQLD7nZ5',
    uid: 'QmblPyEV4bbbyaToS96PaCeyfYE2',
    sector: 'longdong/school-gate-56427g',
    image: 'topos/QmblPyEV4bbbyaToS96PaCeyfYE2/-P4lMof7izFRpQLD7nZ5.webp',
    width: 2560,
    height: 1711,
    createdAt: 1792903436019,
  },
  {
    id: '-P4xMGWX39F7Iokg754u',
    uid: 'QmblPyEV4bbbyaToS96PaCeyfYE2',
    sector: 'longdong/school-gate-4wnzar',
    image: 'topos/QmblPyEV4bbbyaToS96PaCeyfYE2/-P4xMGWX39F7Iokg754u.webp',
    width: 2560,
    height: 1711,
    createdAt: 1793104618291,
  },
]

const INITIAL_STORED: Record<string, { routes: StoredRoutes; crop?: Crop }> = {
  '-P4lMof7izFRpQLD7nZ5': {
    crop: { h: 8646, w: 6305, x: 1067, y: 5 },
    routes: {
      'longdong:6ns9n4': { line: '3865,7755 3764,7236 3702,6200 3791,5366 3988,4777 4253,4197 4239,3658 3947,2225 3893,1422 3838,647' },
      'longdong:gu9egk': { line: '2996,7897 3009,6891 3172,6027 3227,5702 3254,5203 2840,4573 2683,4309 2534,3719 2663,3252 3095,2888 3356,2587 3527,2179 3576,1959 3607,715' },
      'longdong:nrkn3m': { line: '4810,7663 4749,7033 4755,6383 4694,5539 4694,4990 4796,4248 4749,3211 4681,2581 4538,1941 4375,1514 4239,1188 4177,737' },
      'longdong:xhfv9z': { line: '3003,7907 2982,7196 3064,6484 3234,5742 3261,5224 3023,4838 2670,4339 2384,3435 2235,2988 2276,1971 2690,1107' },
      'longdong:xjbzhz': { line: '5972,8233 5938,7287 5931,6322 5951,5305 5870,4614 5822,4106 5897,3374 5985,2784 6039,1656 6019,1331' },
      'longdong:yydn2f': { line: '5360,8314 5272,7206 5421,6149 5618,5508 5591,4258 5686,3669 5489,2561 5367,1575 5204,1097' },
    },
  },
  '-P4xMGWX39F7Iokg754u': {
    crop: { h: 7459, w: 5427, x: 2176, y: 0 },
    routes: {
      'longdong:jag38d': {
        bolts: { A01: '6061,1057', A02: '6156,1058', B01: '5974,4915', B02: '5963,3994', B03: '6082,3137', B04: '6093,2133' },
        line: '5908,6574 6171,4940 6345,4339 6440,3573 6382,2885 6276,1731 6166,1162',
      },
      'longdong:kj45bv': {
        bolts: { A01: '5555,1209', A02: '5715,1241', B01: '4951,6076', B02: '4974,5361', B03: '5020,4741', B04: '5129,4013' },
        line: '4842,7289 4973,6371 5083,5669 5045,4575 5282,3313 5436,2177 5580,1391',
      },
      'longdong:udy37z': {
        line: '5608,6815 5640,5358 5725,3940 5720,2984 5795,2124 5912,1566 6071,1134',
      },
      'longdong:xfb2fj': {
        bolts: { A01: '4588,2225', A02: '4673,2229', B01: '3335,6427', B02: '3747,5518', B03: '3792,4974', B04: '4013,4023', B05: '4297,3122' },
        line: '3766,7217 3841,6129 3965,5557 4045,5016 4212,4305 4133,3539 4336,2747 4605,2382',
      },
    },
  },
}

/** 實驗頁每張照片的預設標記與裁切 */
export function initialLabContent(photoId: string): { marks: Marks; crop?: Crop } {
  const entry = INITIAL_STORED[photoId]
  if (!entry) return { marks: {} }
  const decoded = decodeEdit('initial', { uid: 'lab', createdAt: 0, routes: entry.routes, crop: entry.crop })
  return { marks: decoded.marks, ...(decoded.crop ? { crop: decoded.crop } : {}) }
}

/** 判定單指按下到放開是否為點擊（非平移拖曳、非雙指縮放） */
export function isTapGesture(start: { x: number; y: number }, end: { x: number; y: number }, moved: boolean, multiTouch: boolean): boolean {
  if (moved || multiTouch) return false
  return Math.hypot(end.x - start.x, end.y - start.y) <= TAP_MAX_PX
}

/** 放大後每個螢幕像素對應的照片像素（讓線寬、編號牌、把手在任何縮放倍率下維持相同螢幕尺寸） */
export function screenK(frameK: number, zoomScale: number): number {
  return frameK / zoomScale
}

export interface LabSnapshot {
  photoId?: string
  routes: StoredRoutes
  crop?: Crop
}

const POINT_RE = /^(10000|\d{1,4}),(10000|\d{1,4})$/
const LINE_RE = /^(10000|\d{1,4}),(10000|\d{1,4})( (10000|\d{1,4}),(10000|\d{1,4}))+$/
const POS_RE = /^[BA]\d{2}$/

function validCrop(c: unknown): c is Crop {
  if (!c || typeof c !== 'object') return false
  const { x, y, w, h } = c as Crop
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    x >= 0 &&
    y >= 0 &&
    w >= MIN_CROP &&
    h >= MIN_CROP &&
    x + w <= SCALE &&
    y + h <= SCALE
  )
}

/** 將目前標記與裁切匯出為可讀的 JSON 字串 */
export function serializeLabJson(photoId: string, marks: Marks, crop?: Crop): string {
  const payload: LabSnapshot = {
    photoId,
    routes: encodeMarks(marks),
    ...(crop && !isFullCrop(crop) ? { crop } : {}),
  }
  return JSON.stringify(payload, null, 2)
}

/** 解析並驗證匯入的 JSON 字串；格式或座標不合法時丟出明確錯誤 */
export function parseLabJson(raw: string): { photoId?: string; marks: Marks; crop?: Crop } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('JSON 語法錯誤')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 必須是物件')
  }
  const obj = parsed as Record<string, unknown>
  if (!obj.routes || typeof obj.routes !== 'object' || Array.isArray(obj.routes)) {
    throw new Error('缺少 routes 欄位')
  }
  const routes: StoredRoutes = {}
  for (const [key, val] of Object.entries(obj.routes as Record<string, unknown>)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) throw new Error(`路線 ${key} 格式錯誤`)
    const r = val as { line?: unknown; bolts?: unknown }
    if (r.line !== undefined) {
      if (typeof r.line !== 'string' || !LINE_RE.test(r.line)) throw new Error(`路線 ${key} 的 line 座標不合法`)
    }
    let bolts: Record<string, string> | undefined
    if (r.bolts !== undefined) {
      if (!r.bolts || typeof r.bolts !== 'object' || Array.isArray(r.bolts)) throw new Error(`路線 ${key} 的 bolts 格式錯誤`)
      bolts = {}
      for (const [pos, pt] of Object.entries(r.bolts as Record<string, unknown>)) {
        if (!POS_RE.test(pos) || typeof pt !== 'string' || !POINT_RE.test(pt)) throw new Error(`路線 ${key} 的 bolt ${pos} 座標不合法`)
        bolts[pos] = pt
      }
    }
    routes[key] = { ...(typeof r.line === 'string' ? { line: r.line } : {}), ...(bolts ? { bolts } : {}) }
  }
  let crop: Crop | undefined
  if (obj.crop !== undefined) {
    if (!validCrop(obj.crop)) throw new Error('crop 範圍不合法')
    if (!isFullCrop(obj.crop)) crop = obj.crop
  }
  const decoded = decodeEdit('lab', { uid: 'lab', createdAt: 0, routes, crop })
  return {
    ...(typeof obj.photoId === 'string' ? { photoId: obj.photoId } : {}),
    marks: decoded.marks,
    ...(decoded.crop ? { crop: decoded.crop } : {}),
  }
}

export const labStorageKey = (photoId: string) => `longdong.topoLab.${photoId}`
