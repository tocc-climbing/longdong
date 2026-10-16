import { useSyncExternalStore } from 'react'
import type { LocalizedName } from '../data/schema'
import type { zh } from './zh'

/**
 * 多語言介面：中文（zh）、English（en）、日本語（ja）。
 * 語言包分開打包，只載入目前使用的那一個（initI18n／setLangSetting 才載入），不會一次讀進所有語言。
 * 預設依系統語言（zh、ja 開頭用該語言，其他用英文），使用者可在「我的 → 設定」手動指定，選擇存在這台裝置上。
 *
 * 新增語言：在 LANGS 加上代碼、在 LOADERS 加上載入方式、新增 <代碼>.ts（型別為 Messages，
 * 型別檢查會確保 key 與中文完全相同），並在 zh.ts 等加上 lang.<代碼> 的語言名稱。
 */

export const LANGS = ['zh', 'en', 'ja'] as const
export type Lang = (typeof LANGS)[number]
export type LangSetting = Lang | 'auto'
/** 介面文字的 key，以中文語言包為準（只取型別，不會因此載入中文語言包） */
export type MessageKey = keyof typeof zh
export type Messages = Record<MessageKey, string>
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

const LOADERS: Record<Lang, () => Promise<Messages>> = {
  zh: () => import('./zh').then((m) => m.zh),
  en: () => import('./en').then((m) => m.en),
  ja: () => import('./ja').then((m) => m.ja),
}

/** 日期、時間格式用的地區設定 */
export const LOCALES: Record<Lang, string> = { zh: 'zh-TW', en: 'en', ja: 'ja' }
const HTML_LANG: Record<Lang, string> = { zh: 'zh-Hant-TW', en: 'en', ja: 'ja' }

const STORAGE_KEY = 'longdong.lang'

export function detectLang(languages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): Lang {
  const first = (languages[0] ?? '').toLowerCase()
  if (first.startsWith('zh')) return 'zh'
  if (first.startsWith('ja')) return 'ja'
  return 'en'
}

function readSetting(): LangSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return (LANGS as readonly string[]).includes(v ?? '') ? (v as Lang) : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * 代入變數：{n} 換成值；{n|單數|複數} 依 n 是否為 1 選一個（英文的 1 route／2 routes）。
 * 純函式：給測試、建置腳本直接傳入語言包使用。
 */
export function translate(messages: Messages, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = messages[key] ?? key
  if (!vars) return text
  return text
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, name: string, one: string, other: string) =>
      name in vars ? (Number(vars[name]) === 1 ? one : other) : m,
    )
    .replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

interface State {
  lang: Lang
  setting: LangSetting
  messages: Messages | undefined
}

const loaded: Partial<Record<Lang, Messages>> = {}
let state: State = { lang: 'zh', setting: 'auto', messages: undefined }
const listeners = new Set<() => void>()

async function load(l: Lang): Promise<Messages> {
  return (loaded[l] ??= await LOADERS[l]())
}

function commit(next: State) {
  state = next
  if (typeof document !== 'undefined' && next.messages) {
    document.documentElement.lang = HTML_LANG[next.lang]
    document.title = next.messages['app.title']
  }
  for (const l of listeners) l()
}

/** 啟動時載入目前語言的語言包；畫面要等它完成再顯示（main.tsx） */
export async function initI18n(): Promise<void> {
  const setting = readSetting()
  const lang = setting === 'auto' ? detectLang() : setting
  commit({ lang, setting, messages: await load(lang) })
}

/** 切換語言：先載入新的語言包，載入完成才切換，畫面不會出現空白文字 */
export async function setLangSetting(next: LangSetting): Promise<void> {
  const lang = next === 'auto' ? detectLang() : next
  try {
    if (next === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* 私密瀏覽等情況，只在這次使用有效 */
  }
  const messages = await load(lang)
  commit({ lang, setting: next, messages })
}

/** 給 React 以外的程式（例如同步、錯誤訊息）使用 */
export function getLang(): Lang {
  return state.lang
}

export const t: Translate = (key, vars) => (state.messages ? translate(state.messages, key, vars) : key)

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useLang(): { lang: Lang; setting: LangSetting; t: Translate } {
  const current = useSyncExternalStore(subscribe, () => state)
  const messages = current.messages
  return {
    lang: current.lang,
    setting: current.setting,
    t: (key, vars) => (messages ? translate(messages, key, vars) : key),
  }
}

/**
 * 路線、區域名稱：英文模式以英文為主（沒有英文名時用中文），另一種語言當副標。
 * 日文模式以中文（漢字）為主、英文為副標：漢字名稱對日本使用者也大多看得懂。
 */
export function localName(name: LocalizedName, l: Lang): { main: string; sub?: string } {
  if (l === 'en' && name.en) return { main: name.en, sub: name.zh }
  return { main: name.zh, sub: name.en }
}

/** 「2026 年 10 月」／「October 2026」／「2026年10月」 */
export function monthTitle(key: string, l: Lang): string {
  const [y, m] = key.split('-').map(Number)
  if (l === 'zh') return `${y} 年 ${m} 月`
  if (l === 'ja') return `${y}年${m}月`
  return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' })
}

/** 圖表用的短月份：「10月」／「Oct」 */
export function monthShort(key: string, l: Lang): string {
  const [y, m] = key.split('-').map(Number)
  return l === 'en' ? new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short' }) : `${m}月`
}
