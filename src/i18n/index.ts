import { useSyncExternalStore } from 'react'
import type { LocalizedName } from '../data/schema'
import { en } from './en'
import { zh } from './zh'

/**
 * 中英雙語。預設依系統語言（zh 開頭用中文，其他用英文），
 * 使用者可在「我的 → 設定」手動指定，選擇存在這台裝置上。
 */

export type Lang = 'zh' | 'en'
export type LangSetting = Lang | 'auto'
export type MessageKey = keyof typeof zh
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

const STORAGE_KEY = 'longdong.lang'
const DICTS: Record<Lang, Record<MessageKey, string>> = { zh, en }

export function detectLang(languages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): Lang {
  const first = (languages[0] ?? '').toLowerCase()
  return first.startsWith('zh') ? 'zh' : 'en'
}

function readSetting(): LangSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'zh' || v === 'en' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

let setting: LangSetting = readSetting()
let lang: Lang = setting === 'auto' ? detectLang() : setting
const listeners = new Set<() => void>()

function apply() {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant-TW' : 'en'
    document.title = DICTS[lang]['app.title']
  }
}
apply()

export function setLangSetting(next: LangSetting) {
  setting = next
  lang = next === 'auto' ? detectLang() : next
  try {
    if (next === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* 私密瀏覽等情況，只在這次使用有效 */
  }
  apply()
  for (const l of listeners) l()
}

/** 給 React 以外的程式（例如同步、錯誤訊息）使用 */
export function getLang(): Lang {
  return lang
}

/**
 * 代入變數：{n} 換成值；{n|單數|複數} 依 n 是否為 1 選一個（英文的 1 route／2 routes）。
 */
export function translate(l: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTS[l][key] ?? DICTS.zh[key] ?? key
  if (!vars) return text
  return text
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, name: string, one: string, other: string) =>
      name in vars ? (Number(vars[name]) === 1 ? one : other) : m,
    )
    .replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

export const t: Translate = (key, vars) => translate(lang, key, vars)

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useLang(): { lang: Lang; setting: LangSetting; t: Translate } {
  const current = useSyncExternalStore(subscribe, () => lang)
  const currentSetting = useSyncExternalStore(subscribe, () => setting)
  return { lang: current, setting: currentSetting, t: (key, vars) => translate(current, key, vars) }
}

/** 路線、區域名稱：英文模式以英文為主（沒有英文名時用中文），另一種語言當副標 */
export function localName(name: LocalizedName, l: Lang): { main: string; sub?: string } {
  if (l === 'en' && name.en) return { main: name.en, sub: name.zh }
  return { main: name.zh, sub: name.en }
}

/** 「2026 年 10 月」／「October 2026」 */
export function monthTitle(key: string, l: Lang): string {
  const [y, m] = key.split('-').map(Number)
  return l === 'zh' ? `${y} 年 ${m} 月` : new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' })
}

/** 圖表用的短月份：「10月」／「Oct」 */
export function monthShort(key: string, l: Lang): string {
  const [y, m] = key.split('-').map(Number)
  return l === 'zh' ? `${m}月` : new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short' })
}
