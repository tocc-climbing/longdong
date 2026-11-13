/**
 * 建置後輸出岩場站出口（dist/climbio/，格式與檔案見 scripts/lib/climbio.ts）：路線資料、Realtime Database 的 Topo 與地圖編輯
 * （部署時的最新版本）、Topo 照片（從 Cloud Storage 複製過來：Storage 的網址不回 CORS 標頭）。
 * 每份檔案都先通過官方的 validate，不合格就失敗。
 * 沒有授權、署名的照片（2026-11-02 以前上傳、還沒補上的）不輸出，印出警告。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// format.js 是 CommonJS（vendor 的 package.json），Node 只能用預設匯入
import ClimbioFormat, { type Doc } from '../vendor/climbio-format/format'
import { indexDataset } from '../src/data/dataset'
import type { Dataset } from '../src/data/schema'
import { decodeMapEdits } from '../src/map/shapes'
import { DB_URL } from '../src/social/model'
import { decodeEdit, imageUrl, type StoredEdit, type TopoPhoto } from '../src/topo/model'
import { PREVIEW } from '../vendor/climbio-sourcekit/preview-layout.js'
import { areaSet, CRAG_FILE, cragSet, PACK_FILE, topo, type AreaItems, type TopoInput } from './lib/climbio'
import { previewSheet, shrinkForExport } from './lib/climbioPhotos'
import { longdongMap } from './lib/climbioMap'
import { SITE_URL } from './sheet.config'

const OUT = 'dist/climbio'
const site = process.env.VITE_CHANNEL === 'dev' ? 'https://longdong-dev.web.app/' : SITE_URL

const dataset = JSON.parse(readFileSync('dist/data/longdong.json', 'utf8')) as Dataset
const { sectorById } = indexDataset(dataset)
const common = { dataUrl: `${site}data/longdong.json` }

async function json<T>(path: string): Promise<T | null> {
  const res = await fetch(`${DB_URL}/${path}.json`)
  if (!res.ok) throw new Error(`${path}：HTTP ${res.status}`)
  return (await res.json()) as T | null
}

const [photos, edits, mapEdits, profiles] = await Promise.all([
  json<Record<string, Omit<TopoPhoto, 'id'>>>('v2/topos'),
  json<Record<string, Record<string, StoredEdit>>>('v2/topoEdits'),
  json<Parameters<typeof decodeMapEdits>[0]>('v2/mapEdits'),
  json<Record<string, { name: string }>>('v2/profiles'),
])
const nameOf = (uid: string) => profiles?.[uid]?.name ?? uid

mkdirSync(OUT, { recursive: true })
// 寫出的每份文件也收進合併檔（pack.json）：紅點貓一個請求讀完，不用逐檔下載
const written = new Map<string, Doc>()
const write = (doc: Doc, file = `${doc.id}.json`) => {
  const errors = ClimbioFormat.validate(doc)
  if (errors.length) throw new Error(`${file} 不符合格式：\n${errors.join('\n')}`)
  writeFileSync(join(OUT, file), JSON.stringify(doc))
  written.set(file, doc)
}

const sheetPhotos: Buffer[] = []   // 預覽圖用的照片：依輸出順序，第一張是入口照片
const items = new Map<string, AreaItems>(dataset.areas.map((a) => [a.id, { topos: [] }]))
for (const [key, p] of Object.entries(photos ?? {})) {
  const found = sectorById.get(p.sector)
  if (!found) {
    console.warn(`::warning::Topo ${key}：路線資料沒有分區 ${p.sector}，不輸出`)
    continue
  }
  if (!p.license || !p.attribution || !p.origin) {
    console.warn(`::warning::Topo ${key}：照片沒有授權、署名或來源，不輸出`)
    continue
  }
  const res = await fetch(imageUrl(p.image))
  if (!res.ok) throw new Error(`照片 ${p.image}：HTTP ${res.status}`)
  const original = Buffer.from(await res.arrayBuffer())
  const ext = p.image.endsWith('.webp') ? 'webp' : 'jpg'
  // 出口的照片長邊縮到 1600（sourcekit）：w、h 跟圖檔一致，線的座標才對得上
  const { bytes, width, height } = await shrinkForExport(original, ext, p.width, p.height)
  sheetPhotos.push(bytes)
  const versions = Object.entries(edits?.[key] ?? {}).map(([id, e]) => decodeEdit(id, e)).sort((a, b) => a.createdAt - b.createdAt)
  const latest = versions.at(-1)
  const input: TopoInput = {
    key,
    sectorName: found.sector.name,
    createdAt: p.createdAt,
    width,
    height,
    license: p.license,
    attribution: p.attribution,
    origin: p.origin,
    shot: p.shot,
    image: { ext, sha256: createHash('sha256').update(bytes).digest('hex') },
    ...(latest ? { edit: { createdAt: latest.createdAt, marks: latest.marks, crop: latest.crop, editors: [...new Set(versions.map((v) => nameOf(v.uid)))] } } : {}),
  }
  const t = topo(input)
  writeFileSync(join(OUT, t.view.href), bytes)
  write(t.view)
  if (t.layer) write(t.layer)
  items.get(found.area.id)!.topos.push(t)
}

for (const area of dataset.areas) write(areaSet(dataset, area, items.get(area.id)!, common))
// 岩場地圖：原始版套上地圖編輯的最新版本，只有龍洞自己的（不含 OpenStreetMap）
const map = longdongMap(dataset, decodeMapEdits(mapEdits), false)
write(map)
const root = cragSet(dataset, map, common, sheetPhotos.length)
write(root, CRAG_FILE)
// 合成預覽圖：上面入口照片、下面每張照片的小圖；紅點貓匯入前先看、下載時小圖一格格亮起
const sheet = await previewSheet(sheetPhotos)
if (sheet) writeFileSync(join(OUT, PREVIEW), sheet)
// 合併檔：入口以外的所有文件放在一個 JSON（{ docs: { 檔名: 文件 } }），入口的 props.pack 指到它
written.delete(CRAG_FILE)
writeFileSync(join(OUT, PACK_FILE), JSON.stringify({ docs: Object.fromEntries(written) }))

console.log(`岩場站出口：${dataset.areas.length} 個區域、${[...items.values()].reduce((n, i) => n + i.topos.length, 0)} 張 Topo → ${OUT}/`)
