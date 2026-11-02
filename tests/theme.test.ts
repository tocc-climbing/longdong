import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveTheme } from '../src/theme'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

/** 救援用的桃紅：深淺色都一樣（白字才看得清楚） */
const SAME_IN_BOTH = ['--emergency']

/** 某個選擇器的所有區塊裡定義的變數；colors：只算顏色（值是 # 或 rgb 開頭的） */
function tokens(selector: string, colors: boolean): Set<string> {
  const names = new Set<string>()
  for (const m of css.matchAll(/^([^\n{}]+)\{([^}]*)\}/gm)) {
    if (m[1].trim() !== selector) continue
    for (const d of m[2].matchAll(colors ? /(--[\w-]+):\s*(#|rgb)/g : /(--[\w-]+):/g)) names.add(d[1])
  }
  return names
}

describe('外觀', () => {
  it('自動依系統；手動選的優先', () => {
    expect([resolveTheme('auto', true), resolveTheme('auto', false), resolveTheme('light', false), resolveTheme('dark', true)]).toEqual(['light', 'dark', 'light', 'dark'])
  })

  it('深色的每個顏色變數都有淺色值', () => {
    const light = new Set([...tokens(":root[data-theme='light']", false), ...tokens(":root[data-layout][data-theme='light']", false), ...SAME_IN_BOTH])
    const layoutLight = tokens(":root[data-layout][data-theme='light']", false)
    expect([...tokens(':root', true)].filter((t) => !light.has(t))).toEqual([])
    // 手機版的變數（:root[data-layout]）權重同淺色的 :root[data-theme='light']，要在手機版的淺色區塊裡
    expect([...tokens(':root[data-layout]', true)].filter((t) => !layoutLight.has(t))).toEqual([])
  })
})
