/**
 * TopoKit、mapkit、sourcekit 的固定版本副本：從本機 climbio-internal 的指定提交複製到 vendor/，記下來源與檔案雜湊。
 * climbio-internal 是私人 repo，GitHub Actions 抓不到，所以副本放進龍洞；副本不在這裡改，要改回 climbio-internal 改再重新複製。
 *
 *   npx tsx scripts/vendor-climbio.ts <climbio-internal 路徑> <提交> [套件…]   複製套件（不給就全部）、寫 SOURCE.md
 *   npx tsx scripts/vendor-climbio.ts --check                          核對副本與 SOURCE.md 的雜湊（tests/vendorClimbio.test.ts 也會跑）
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PACKAGES = [
  { dir: 'topokit', vendor: 'vendor/climbio-topokit' },
  { dir: 'mapkit', vendor: 'vendor/climbio-mapkit' },
  { dir: 'sourcekit', vendor: 'vendor/climbio-sourcekit' },
] as const

/** 套件 package.json 的 files 裡要的：程式、型別、授權與說明；demo.html 讀 climbio 的其他資料夾，不複製 */
const wanted = (name: string) => /\.(js|d\.ts)$/.test(name) || ['README.md', 'LICENSE', 'NOTICE', 'package.json'].includes(name)

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

/** SOURCE.md 的雜湊表：`| 檔名 | sha256 |` */
export function recordedHashes(sourceMd: string): Map<string, string> {
  return new Map([...sourceMd.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)].map((m) => [m[1], m[2]]))
}

/** 副本裡和 SOURCE.md 對不上的檔案（改過、多出來、少了） */
export function vendorMismatches(root: string): string[] {
  const bad: string[] = []
  for (const p of PACKAGES) {
    const dir = join(root, p.vendor)
    const recorded = recordedHashes(readFileSync(join(dir, 'SOURCE.md'), 'utf8'))
    const files = readdirSync(dir).filter((f) => f !== 'SOURCE.md')
    for (const f of files) if (recorded.get(f) !== sha256(readFileSync(join(dir, f)))) bad.push(`${p.vendor}/${f}`)
    for (const f of recorded.keys()) if (!files.includes(f)) bad.push(`${p.vendor}/${f}（少了）`)
  }
  return bad
}

function copy(repo: string, commit: string, only: string[] = []) {
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 64 << 20 })
  const full = git('rev-parse', '--verify', `${commit}^{commit}`).toString().trim()
  for (const p of PACKAGES.filter((q) => !only.length || only.includes(q.dir))) {
    const names = git('ls-tree', '--name-only', full, `${p.dir}/`)
      .toString()
      .split('\n')
      .map((l) => l.slice(p.dir.length + 1))
      .filter(wanted)
    if (!names.includes('index.js')) throw new Error(`${full} 沒有 ${p.dir}/index.js`)
    rmSync(p.vendor, { recursive: true, force: true })
    mkdirSync(p.vendor, { recursive: true })
    const rows: string[] = []
    for (const name of names.sort()) {
      const data = git('show', `${full}:${p.dir}/${name}`)
      writeFileSync(join(p.vendor, name), data)
      rows.push(`| \`${name}\` | \`${sha256(data)}\` |`)
    }
    const version = JSON.parse(readFileSync(join(p.vendor, 'package.json'), 'utf8')).version
    writeFileSync(
      join(p.vendor, 'SOURCE.md'),
      `# 來源

\`climb-io/climbio-internal\` 的 \`${p.dir}/\`，commit \`${full}\`（${version}）。

這裡不改：要改回 climbio-internal 改，再用 \`npx tsx scripts/vendor-climbio.ts <climbio-internal 路徑> <提交>\` 重新複製；\`npm test\` 核對下面的雜湊。
套件上了 npm 之後改成依賴 npm 套件，刪掉這個資料夾。

| 檔案 | sha256 |
|---|---|
${rows.join('\n')}
`,
    )
    console.log(`${p.vendor}：${names.length} 個檔案（${full.slice(0, 7)}，${version}）`)
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/vendor-climbio.ts')) {
  const [a, b, ...only] = process.argv.slice(2)
  if (a === '--check') {
    const bad = vendorMismatches('.')
    if (bad.length) throw new Error(`副本和 SOURCE.md 對不上：\n${bad.join('\n')}`)
    console.log('副本與 SOURCE.md 一致')
  } else if (a && b) copy(a, b, only)
  else throw new Error('用法：vendor-climbio.ts <climbio-internal 路徑> <提交>，或加套件名只更新那幾個，或 --check')
}
