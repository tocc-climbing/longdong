/**
 * 驗證路線資料（public/data/longdong.json）符合目前程式的資料格式。
 * 部署正式站時用：main 的新資料要先通過正式版（release）程式的格式檢查，才會加到正式站。
 */
import { readFileSync } from 'node:fs'
import { Dataset } from '../src/data/schema'

const result = Dataset.safeParse(JSON.parse(readFileSync('public/data/longdong.json', 'utf8')))
if (!result.success) {
  console.error('路線資料不符合資料格式：')
  for (const issue of result.error.issues.slice(0, 10)) console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  process.exit(1)
}
console.log('路線資料符合資料格式')
