/**
 * 下載地圖資料範圍（src/map/extent.ts）內的 OpenStreetMap 資料，存成 scripts/data/osm-extent.json（gen-scale-map.ts 使用）：
 *   coastline  海岸線（範圍外多抓一些，才接得成穿過範圍的線；陸地在線的左側）
 *   building   建物外框
 *   highway    台二線（highway=primary，不含隧道：隧道沿用 osm-reference.json 的鼻頭隧道）
 *   road       其他道路（residential、unclassified、service、track）
 *   trail      步道（path、footway、steps）
 *   parking    停車場的範圍（amenity=parking）
 * 座標是 [緯度, 經度]，小數 6 位。
 *
 *   npx tsx scripts/fetch-osm-extent.ts
 */
import { writeFileSync } from 'node:fs'
import { EXTENT_LATLNG as E } from '../src/map/extent'

type Pt = [number, number]
interface Way {
  tags: Record<string, string>
  geometry: { lat: number; lon: number }[]
}

/** 依序試，忙碌（504 等）時換下一個 */
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
/** 海岸線往外多抓的度數（約 2 公里） */
const COAST_PAD = 0.02
const bbox = `${E.south},${E.west},${E.north},${E.east}`
const coastBox = `${E.south - COAST_PAD},${E.west - COAST_PAD},${E.north + COAST_PAD},${E.east + COAST_PAD}`
const query = `[out:json][timeout:90];(way["natural"="coastline"](${coastBox});way["building"](${bbox});way["highway"](${bbox});way["amenity"="parking"](${bbox}););out geom tags;`

async function download(): Promise<Way[]> {
  for (const server of SERVERS) {
    const res = await fetch(server, {
      method: 'POST',
      headers: { 'User-Agent': 'longdong-app (https://github.com/tocc-climbing/longdong)', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
    })
    if (res.ok) return ((await res.json()) as { elements: Way[] }).elements
    console.warn(`${server}：${res.status}`)
  }
  throw new Error('Overpass 都下載失敗')
}
const ways = await download()
const pts = (w: Way): Pt[] => w.geometry.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)])
const pick = (test: (t: Record<string, string>) => boolean) => ways.filter((w) => test(w.tags)).map(pts)

const ROADS = ['residential', 'unclassified', 'service', 'track', 'tertiary', 'secondary']
const TRAILS = ['path', 'footway', 'steps']
const data = {
  source: `© OpenStreetMap contributors，ODbL 1.0（https://www.openstreetmap.org/copyright）；${new Date().toISOString().slice(0, 10)} 以 Overpass API 下載（scripts/fetch-osm-extent.ts）`,
  coastline: pick((t) => t.natural === 'coastline'),
  building: pick((t) => !!t.building),
  highway: pick((t) => t.highway === 'primary' && !t.tunnel),
  road: pick((t) => ROADS.includes(t.highway) && !t.tunnel),
  trail: pick((t) => TRAILS.includes(t.highway) && !t.tunnel),
  parking: pick((t) => t.amenity === 'parking'),
}
writeFileSync(new URL('./data/osm-extent.json', import.meta.url), JSON.stringify(data) + '\n')
console.log(Object.entries(data).map(([k, v]) => `${k} ${Array.isArray(v) ? v.length : ''}`).join('，'))
