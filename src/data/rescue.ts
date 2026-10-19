import type { LocalizedName } from './schema'

/**
 * 龍洞岩場救援資訊，來源：TOCC 龍洞岩場救援計畫（https://www.tocc-climbing.org/ems-project）
 * 與「龍洞岩場救援資訊圖」2026 年 7 月版。內容由救援計畫團隊維護，App 照實顯示，不修正、不推測。
 * 救援頁的地圖用比例尺地圖（src/map/，資料由 scripts/gen-scale-map.ts 產生，放在 public/rescue/）。
 */

export const RESCUE_SOURCE = {
  version: '2026-07',
  projectUrl: 'https://www.tocc-climbing.org/ems-project',
  /** 救援計畫書（約 100MB 的 PDF，不放進離線資料） */
  handbookUrl: 'https://www.tocc-climbing.org/_files/ugd/a65be6_7d036a2bf7574815b8870cc0d5788610.pdf',
  /** 「龍洞岩場意外事故通報社群(新)」；TOCC 救援計畫頁上的是舊群組（2026-10-15 更新） */
  lineGroupUrl: 'https://line.me/ti/g2/yNQP-eP_OiI7Ja292782IKVPjtHuySCZgbKWjQ',
  lineGroupPassword: 'TOCC',
  reportFormUrl: 'https://forms.gle/XsEMmdx1hjF8RVyd8',
}

/** 緊急電話：112 在沒有自己電信的訊號時也能撥 */
export const EMERGENCY_NUMBERS = ['119', '112', '118'] as const

export interface RescuePoint {
  /** 地圖上的編號 */
  no: number
  name: LocalizedName
  /** WGS84 座標；地圖上標示「無」的沒有座標 */
  coords?: [number, number]
}

/**
 * 15 個救援點與座標（地圖上的「救援點 GPS 座標」）。
 * 地圖上 #8 另列「第二洞外 25.111783, 121.915150」，與 #1 龍洞安檢所的座標完全相同、應為誤植；
 * 救援計畫團隊確認正確座標前不列入。英文名稱只列地圖或救援計畫頁上有的，其餘顯示中文原名。
 */
export const RESCUE_POINTS: RescuePoint[] = [
  { no: 1, name: { zh: '龍洞安檢所', en: 'Coast Guard Long-Dong Inspection Office' }, coords: [25.111783, 121.91515] },
  { no: 2, name: { zh: '龍洞岩場入口／校門口小徑', en: '龍洞岩場入口／School Gate Trail' }, coords: [25.113133, 121.92035] },
  { no: 3, name: { zh: '校門口', en: 'School Gate' }, coords: [25.1129, 121.921617] },
  { no: 4, name: { zh: '鐘塔', en: 'Clocktower' }, coords: [25.111367, 121.922917] },
  { no: 5, name: { zh: '訓導處' }, coords: [25.110967, 121.922767] },
  { no: 6, name: { zh: '長巷', en: 'Long Lane' }, coords: [25.11065, 121.922983] },
  { no: 7, name: { zh: '音樂廳／演奏台', en: 'Music Hall / Recital Stage' }, coords: [25.110067, 121.922767] },
  { no: 8, name: { zh: '大禮堂／第一洞', en: 'Grand Auditorium / First Cave' }, coords: [25.109867, 121.922233] },
  { no: 9, name: { zh: '黃金谷小徑／龍洞灣步道', en: 'Golden Valley Trail / Long Dong Cape Bay Trail' } },
  { no: 10, name: { zh: '黃金谷', en: 'Golden Valley' }, coords: [25.1067, 121.922483] },
  { no: 11, name: { zh: '鱷魚岬', en: 'Crocodile Cape' }, coords: [25.105583, 121.923117] },
  { no: 12, name: { zh: '後門－地下二樓', en: 'Back Door – Basement' }, coords: [25.104733, 121.922833] },
  { no: 12, name: { zh: '後門－地下一樓', en: 'Back Door – B1' }, coords: [25.103783, 121.922933] },
  { no: 13, name: { zh: '後門小徑', en: 'Back Door Trail' } },
  { no: 14, name: { zh: '南側停車場（西靈巖寺）', en: 'South Parking Lot (Hsilingyan Temple)' }, coords: [25.105167, 121.922183] },
  { no: 15, name: { zh: '龍洞南口海洋公園', en: 'Long Dong South Ocean Park' }, coords: [25.101567, 121.919333] },
]

export interface EmsLocation {
  no: number
  name: LocalizedName
  /** 放置位置的說明 */
  where: LocalizedName
  /** 另有捲式擔架（SKED）：救援資訊圖上長巷、第一洞、黃金谷、後門四處有 */
  sked: boolean
}

/**
 * 6 處急救器材設置點：每處有藍色密封桶（急救器材）與墨綠色帆布袋（長背板），長巷、第一洞、黃金谷、後門另有捲式擔架（SKED）。
 * 2026-10-15 依救援團隊更新：#3 由音樂廳演奏臺移到長巷最深處、#5 改為黃金谷中央區小木屋，
 * 與救援資訊圖 2026 年 7 月版的器材位置一致（TOCC 救援計畫頁的文字仍是舊位置）。
 */
export const EMS_LOCATIONS: EmsLocation[] = [
  { no: 1, name: { zh: '校門口', en: 'School Gate' }, where: { zh: '左側洞穴內', en: 'Inside the boulder cave at the left side' }, sked: false },
  {
    no: 2,
    name: { zh: '鐘塔', en: 'Clocktower' },
    where: { zh: '總統頭像山後方洞穴內', en: 'Inside the tunnel at the left side to the base of Four Presidents' },
    sked: false,
  },
  { no: 3, name: { zh: '長巷', en: 'Long Lane' }, where: { zh: '最深處', en: 'At the far end of the lane' }, sked: true },
  { no: 4, name: { zh: '第一洞', en: 'First Cave' }, where: { zh: '洞內最深處', en: 'At the end of the cave' }, sked: true },
  { no: 5, name: { zh: '黃金谷', en: 'Golden Valley' }, where: { zh: '中央區小木屋', en: 'In the small cabin in the central area' }, sked: true },
  { no: 6, name: { zh: '後門', en: 'Back Door' }, where: { zh: '鱷魚岬與老人牆內角洞穴內', en: 'In the alcove between Crocodile Cape and Old Man Wall' }, sked: true },
]

/**
 * 各大區域的就近救援點與急救器材（依地圖上的位置）。
 * key 是路線資料的大區域 ID 去掉岩場前綴（longdong/golden-valley → golden-valley），也是局部圖的檔名。
 */
export const AREA_RESCUE: Record<string, { points: number[]; ems: number }> = {
  'school-gate': { points: [2, 3], ems: 1 },
  clocktower: { points: [4, 5], ems: 2 },
  'long-lane': { points: [6], ems: 3 },
  'music-hall': { points: [7], ems: 3 },
  'grand-auditorium': { points: [8], ems: 4 },
  'first-cave': { points: [8], ems: 4 },
  // #9 在地圖上標示無座標，一併列出緊鄰、有座標的 #8（北側）與 #10（南側）
  'second-cave': { points: [8, 9, 10], ems: 4 },
  'golden-valley': { points: [10], ems: 5 },
  'back-door': { points: [11, 12, 13, 14], ems: 6 },
}

/** 大區域 ID（longdong/golden-valley）對應的救援資訊 key；沒有時回傳 undefined */
export function rescueKey(areaId: string): string | undefined {
  const key = areaId.split('/').pop()!
  return key in AREA_RESCUE ? key : undefined
}

/** 「25.106700, 121.922483」：照地圖上的寫法固定 6 位小數 */
export function formatCoords([lat, lng]: [number, number]): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

/** 用地圖 App 開啟座標（手機上會跳出 Google 地圖或 Apple 地圖） */
export function mapUrl([lat, lng]: [number, number]): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}
