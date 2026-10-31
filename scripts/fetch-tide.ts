/**
 * 抓中央氣象署的潮汐預報（未來 1 個月），存成 public/data/tide.json。
 * 授權碼從環境變數 CWA_API_KEY 讀（GitHub 的 CWA_API_KEY Environment），不寫進程式碼。
 *
 *   CWA_API_KEY=… npm run tide
 *
 * 每週由 .github/workflows/tide.yml 執行。
 */
import { writeFileSync } from 'node:fs'
import { parseCwaTide } from '../src/tide'

const key = process.env.CWA_API_KEY
if (!key) throw new Error('沒有 CWA_API_KEY（氣象署的授權碼）')

const res = await fetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-A0021-001?Authorization=${encodeURIComponent(key)}&format=JSON`)
if (!res.ok) throw new Error(`氣象署回應 HTTP ${res.status}`)
const tide = parseCwaTide(await res.json(), new Date().toISOString())
writeFileSync('public/data/tide.json', JSON.stringify(tide, null, 2) + '\n')
console.log(`潮汐：${tide.location}，${tide.days[0].date} ~ ${tide.days.at(-1)!.date}，共 ${tide.days.length} 天`)
