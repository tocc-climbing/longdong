/**
 * 公開的社群資料（評分、留言、暱稱），存在 Firebase Realtime Database 的 /v2 底下：
 *   /v2/profiles/<uid>              { name, updatedAt }
 *   /v2/ratings/<routeKey>/<uid>     { stars, feel?, updatedAt }   每人每條路線一筆
 *   /v2/comments/<routeKey>/<id>     { uid, text, createdAt, hidden?, parent? }   parent：回覆的是哪一則留言（只有一層）
 *   /v2/likes/<routeKey>/<id>/<uid>  true     對留言按讚，每人每則一筆
 *   /v2/reports/<id>                 { path, uid, reason?, createdAt }   檢舉，只有管理員看得到
 */

/** 端對端測試（vite build --mode e2e）讀寫 Firebase 模擬器，不碰正式資料 */
export const E2E = import.meta.env.MODE === 'e2e'

export const DB_URL = E2E ? 'http://127.0.0.1:9000' : 'https://longdong.firebaseio.com'

/** 資料庫 REST 的網址（模擬器要指定資料庫實例） */
export const dbUrl = (path: string) => `${DB_URL}/${path}.json${E2E ? '?ns=longdong' : ''}`

/** Realtime Database 的 key 不能含 "/" "."：longdong/328ac2 → longdong:328ac2 */
export function routeKey(routeId: string): string {
  return routeId.replace(/\//g, ':').replace(/\./g, ',')
}

export type Feel = 'soft' | 'fair' | 'hard'

/** 體感難度；顯示文字見 i18n 的 feel.* */
export const FEELS: Feel[] = ['soft', 'fair', 'hard']


export interface Rating {
  stars: number
  feel?: Feel
  updatedAt: string
}

export interface Comment {
  id: string
  uid: string
  text: string
  /** 伺服器時間（毫秒） */
  createdAt: number
  hidden?: boolean
  /** 回覆的是哪一則留言（只有一層：回覆不能再被回覆） */
  parent?: string
}

export interface Profile {
  name: string
  updatedAt: string
}

export interface RatingSummary {
  count: number
  average: number
  /** 各星等人數，index 0 = 1 星 */
  stars: number[]
  feel: Record<Feel, number>
}

export function summarize(ratings: Record<string, Rating> | undefined): RatingSummary | undefined {
  const list = Object.values(ratings ?? {}).filter((r) => r.stars >= 1 && r.stars <= 5)
  if (list.length === 0) return undefined
  const stars = [0, 0, 0, 0, 0]
  const feel: Record<Feel, number> = { soft: 0, fair: 0, hard: 0 }
  let total = 0
  for (const r of list) {
    stars[r.stars - 1]++
    total += r.stars
    if (r.feel) feel[r.feel]++
  }
  return { count: list.length, average: total / list.length, stars, feel }
}

/** 體感難度的多數意見，至少 3 人回答且過半才顯示，避免一兩個人就下定論 */
export function feelConsensus(summary: RatingSummary | undefined): Feel | undefined {
  if (!summary) return undefined
  const answered = summary.feel.soft + summary.feel.fair + summary.feel.hard
  if (answered < 3) return undefined
  const top = (Object.entries(summary.feel) as [Feel, number][]).sort((a, b) => b[1] - a[1])[0]
  return top[1] * 2 > answered ? top[0] : undefined
}

export const COMMENT_MAX = 1000
export const NAME_MAX = 30

/**
 * 暱稱的標準寫法：相容字元正規化（全形英數字、全形空白轉半形）、去掉看不見的零寬字元、
 * 連續空白合併成一個、去掉頭尾空白。存進資料庫的一律是這個寫法。
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 比對暱稱是否重複用的 key：標準寫法轉小寫，再把 Realtime Database key 不能用的字元轉成 %XX。
 * 算法必須和 firebase/database.rules.json 裡的完全相同（規則測試會檢查）。
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/%/g, '%25')
    .replace(/\./g, '%2E')
    .replace(/\$/g, '%24')
    .replace(/#/g, '%23')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
    .replace(/\//g, '%2F')
}
