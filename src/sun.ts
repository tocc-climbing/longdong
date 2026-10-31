/**
 * 日出、日落時間：在裝置上計算（日出方程式，NOAA 的簡化版），離線也看得到。
 * 誤差約一分鐘；不考慮地形遮蔽（龍洞面海，東邊沒有山擋）。
 */

const DAY_MS = 86_400_000
/** 1970-01-01 00:00 UTC 的儒略日 */
const JD_UNIX = 2440587.5
/** 2000-01-01 12:00 UTC 的儒略日 */
const J2000 = 2451545
const rad = Math.PI / 180

/** date：當地的日期 YYYY-MM-DD；lng 東經為正。回傳的是那一天當地中午前後的日出與日落 */
export function sunTimes(date: string, [lat, lng]: [number, number]): { rise: Date; set: Date } {
  const [y, m, d] = date.split('-').map(Number)
  // 從 J2000 起算的第幾天（那天 UTC 中午），再依經度移到當地的太陽正午
  const n = Date.UTC(y, m - 1, d, 12) / DAY_MS + JD_UNIX - J2000
  const meanNoon = n - lng / 360
  const M = (357.5291 + 0.98560028 * meanNoon) % 360
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad)
  const lambda = (M + C + 180 + 102.9372) % 360
  const transit = J2000 + meanNoon + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad)
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad)
  const cosDec = Math.cos(Math.asin(sinDec))
  // 太陽上緣碰到地平線（含大氣折射）：天頂距 90.833°
  const cosHour = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec)
  const half = Math.acos(cosHour) / rad / 360
  const toDate = (jd: number) => new Date((jd - JD_UNIX) * DAY_MS)
  return { rise: toDate(transit - half), set: toDate(transit + half) }
}
