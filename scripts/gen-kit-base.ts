/**
 * App 的地圖（mapkit）用的底圖：public/rescue/kitbase.json。
 * 只放和路線資料、地圖編輯無關的部分：救援資訊圖頁框裡的陸地與建物加上頁框外 OpenStreetMap 的（先裁切合併，手機上不用算）、
 * 停車場、頁框外 OpenStreetMap 的道路與步道、救援點等地點、移動範圍。
 * 區域、岩壁、頁框裡可以編輯的道路與步道線由 App 套上地圖編輯後組上去（src/map/mapkitView.ts）。
 *   npm run kit-base   public/rescue/*.geojson 改了之後重新產生（tests/kitMap.test.ts 檢查是不是最新的）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Dataset } from '../src/data/schema'
import { kitBaseOf } from '../src/map/mapkitView'
import { longdongMap } from './lib/climbioMap'

export function kitBase() {
  const dataset = JSON.parse(readFileSync(new URL('../public/data/longdong.json', import.meta.url), 'utf8')) as Dataset
  return kitBaseOf(longdongMap(dataset))
}

export const KIT_BASE_FILE = new URL('../public/rescue/kitbase.json', import.meta.url)

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/gen-kit-base.ts')) {
  writeFileSync(KIT_BASE_FILE, JSON.stringify(kitBase()))
  console.log('public/rescue/kitbase.json')
}
