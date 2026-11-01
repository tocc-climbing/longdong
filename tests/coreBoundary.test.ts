import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * src/core 是各個 App（龍洞、紅點貓、來點貓）共用的部分：只能匯入 core 自己的檔案與下列套件，
 * 不能碰 App 的資料來源（Firebase）、路由、語言包、路線資料格式。
 */
const PACKAGES = ['react', 'exifr']
const CORE = resolve(__dirname, '../src/core')

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))
}

/** 不在 core 裡、也不是允許的套件的 import */
function outsideImports(file: string, source: string): string[] {
  const specs = [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1])
  return specs.filter((spec) => (spec.startsWith('.') ? relative(CORE, resolve(dirname(file), spec)).startsWith('..') : !PACKAGES.includes(spec)))
}

describe('src/core 的相依', () => {
  it('只匯入 core 自己的檔案與允許的套件', () => {
    const found = files(CORE).flatMap((f) => outsideImports(f, readFileSync(f, 'utf8')).map((spec) => `${relative(CORE, f)}: ${spec}`))
    expect(found).toEqual([])
  })

  it('抓得到 core 外的檔案、不允許的套件與動態 import', () => {
    const f = join(CORE, 'topo/TopoView.tsx')
    expect(outsideImports(f, "import { navigate } from '../../router'\nimport { x } from './geometry'\nimport { y } from 'firebase/app'\nconst z = await import('../../i18n')")).toEqual([
      '../../router',
      'firebase/app',
      '../../i18n',
    ])
  })
})
