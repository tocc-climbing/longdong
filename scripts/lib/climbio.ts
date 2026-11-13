import { createHash } from 'node:crypto'
import { previewProps } from '../../vendor/climbio-sourcekit/preview-layout.js'
import type { Layer, MapView, Node, PhotoView, Set, Text } from '../../vendor/climbio-format/format'
import { toCamera } from '../../src/core/format/camera'
import { toTopoLayer, toTopoView } from '../../src/core/format/topo'
import type { Crop, Marks } from '../../src/core/topo/geometry'
import type { Shot } from '../../src/core/topo/shot'
import type { Area, Dataset, LocalizedName, Route, RouteStatus } from '../../src/data/schema'

/**
 * 岩場站出口：路線資料、Topo、岩場地圖換成 Climbio 公開格式 v2（vendor/climbio-format），放在網站的 /climbio/，
 * 不用 Firebase SDK、不登入就能 GET（見 scripts/gen-climbio.ts）。
 *
 *   longdong.json        入口：岩場的組合（type crag），岩場節點，items 是岩場地圖與各區域的組合
 *   <id>.json            其他檔案以檔案 id 為檔名：岩場地圖（地圖畫面，scripts/lib/climbioMap.ts：底圖、區域、岩壁、地點）、
 *                        區域的組合（type area：區域、分區、路線節點，items 是 Topo）、Topo 的照片畫面、疊在照片上的路線線段與 bolt（圖層）
 *   <畫面 id>.webp／.jpg  Topo 的照片
 *   preview.jpg          合成預覽圖（props.preview）；pack.json 入口以外所有文件的合併檔（props.pack），紅點貓匯入用
 *
 * 全域 id 由好讀代號算出（globalId）：同一個代號每次輸出都一樣。之後 Sheet 加上全域 id 欄時填入同一組值，id 不變。
 */

/** 全域 id：代號的 SHA-256 以 36 進位寫，取前 16 碼 */
export function globalId(key: string): string {
  return BigInt('0x' + createHash('sha256').update(key).digest('hex')).toString(36).slice(0, 16)
}

/** 檔案 id：同一個代號的不同檔案（組合、地圖、圖層）以「#種類」區分；代號裡沒有 # */
export const fileId = (key: string, kind: string) => globalId(`${key}#${kind}`)

export const LICENSE = 'CC-BY-SA-4.0'

/** 入口的檔名 */
export const CRAG_FILE = 'longdong.json'

const text = (name: LocalizedName): Text => ({ 'zh-Hant': name.zh, ...(name.en ? { en: name.en } : {}) })

/** 路線狀態 → 詞彙的 status：只有能確定的才寫（其餘看 longdong:status） */
const STATUS: Partial<Record<RouteStatus, string>> = { tested: 'open', rebolted: 'open', closed: 'closed' }

const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)))

/** 路線節點：通用的詞彙加上龍洞自己的（longdong:）；排序、篩選用的衍生值（gradeValue）不輸出 */
function routeNode(route: Route, parent: string): Node {
  return {
    id: globalId(route.id),
    type: route.isFixture ? 'longdong:fixture' : 'route',
    parent,
    name: text(route.name),
    props: defined({
      code: route.id,
      grade: route.grade ? { yds: route.grade } : undefined,
      style: route.type,
      length: route.heightM,
      bolts: route.boltCount,
      fa: route.firstAscent,
      status: route.status && STATUS[route.status],
      description: route.description,
      'longdong:number': route.number,
      'longdong:pitch': route.pitch,
      'longdong:faDate': route.firstAscentDate ?? route.firstAscentDateLabel,
      'longdong:safety': route.safety,
      'longdong:status': route.status,
      'longdong:statusDate': route.statusDate,
      'longdong:bolts': route.bolts,
      'longdong:anchors': route.anchors,
      'longdong:anchorHardware': route.anchorHardware,
      'longdong:lastTested': route.lastTested,
      'longdong:notes': route.notes,
    }),
  }
}

export interface Common {
  /** 路線資料的網址（source.url） */
  dataUrl: string
}

const datasetT = (d: Dataset) => Date.parse(d.updatedAt)
const datasetSource = (d: Dataset, c: Common) => ({ url: c.dataUrl, version: d.version })

/** 岩場的組合：岩場節點（五金代號表放在 props），items 是岩場地圖與各區域的組合 */
/** 出口檔案：合併檔（紅點貓一個請求讀完整個出口）、合成預覽圖 */
export const PACK_FILE = 'pack.json'

/** photos：出口裡有幾張 Topo 照片（預覽圖的格子數）；有的話組合帶 props.preview（紅點貓下載前先看），並一律帶 props.pack */
export function cragSet(d: Dataset, map: MapView, c: Common, photos = 0): Set {
  return {
    climbio: 2,
    kind: 'set',
    type: 'crag',
    id: fileId(d.crag.id, 'set'),
    name: text(d.crag.name),
    t: datasetT(d),
    license: LICENSE,
    attribution: d.source.attribution,
    source: datasetSource(d, c),
    items: [{ href: `${map.id}.json`, id: map.id, t: map.t }, ...d.areas.map((a) => ({ href: `${fileId(a.id, 'set')}.json`, id: fileId(a.id, 'set'), name: text(a.name) }))],
    nodes: [{ id: globalId(d.crag.id), type: 'crag', name: text(d.crag.name), props: { code: d.crag.id, 'longdong:hardware': d.hardware } }],
    props: { pack: { href: PACK_FILE }, ...(photos ? { preview: previewProps(photos) } : {}) },
  }
}

export interface AreaItems {
  topos: { view: PhotoView; layer?: Layer }[]
}

/** 區域的組合：區域 → 分區 → 路線節點，items 是這個區域的 Topo */
export function areaSet(d: Dataset, area: Area, items: AreaItems, c: Common): Set {
  const id = globalId(area.id)
  return {
    climbio: 2,
    kind: 'set',
    type: 'area',
    id: fileId(area.id, 'set'),
    name: text(area.name),
    t: datasetT(d),
    license: LICENSE,
    attribution: d.source.attribution,
    source: datasetSource(d, c),
    items: [
      ...items.topos.flatMap(({ view, layer }) => [
        { href: `${view.id}.json`, id: view.id, t: view.t },
        ...(layer ? [{ href: `${layer.id}.json`, id: layer.id, t: layer.t }] : []),
      ]),
    ],
    nodes: [
      { id, type: 'area', parent: globalId(d.crag.id), name: text(area.name), props: { code: area.id } },
      ...area.sectors.flatMap((s) => {
        const sid = globalId(s.id)
        return [{ id: sid, type: 'sector', parent: id, name: text(s.name), props: { code: s.id } }, ...s.routes.map((r) => routeNode(r, sid))]
      }),
    ],
  }
}

/** 資料庫裡的一張 Topo 照片（v2/topos）與它的最新版本 */
export interface TopoInput {
  /** 照片 id（資料庫的 key） */
  key: string
  sectorName: LocalizedName
  createdAt: number
  width: number
  height: number
  license: string
  attribution: string
  origin: 'self' | 'authorized'
  shot?: Shot
  image: { ext: 'webp' | 'jpg'; sha256: string }
  /** 最新版本；沒有版本時沒有圖層 */
  edit?: { createdAt: number; marks: Marks; crop?: Crop; editors: string[] }
}

/** 一張 Topo 的照片畫面與線段圖層 */
export function topo(input: TopoInput): { view: PhotoView; layer?: Layer } {
  const key = `longdong/topo/${input.key}`
  const view = toTopoView({
    id: fileId(key, 'view'),
    name: input.sectorName.zh,
    license: input.license,
    attribution: input.attribution,
    origin: input.origin,
    t: input.createdAt,
    href: `${fileId(key, 'view')}.${input.image.ext}`,
    w: input.width,
    h: input.height,
    mime: input.image.ext === 'webp' ? 'image/webp' : 'image/jpeg',
    sha256: input.image.sha256,
    camera: toCamera(input.shot),
    crop: input.edit?.crop,
  })
  const e = input.edit
  if (!e) return { view }
  const layer = toTopoLayer({
    id: fileId(key, 'routes'),
    view,
    href: `${view.id}.json`,
    license: LICENSE,
    attribution: e.editors.join('、'),
    t: e.createdAt,
    marks: e.marks,
    globalId,
  })
  return { view, layer }
}
