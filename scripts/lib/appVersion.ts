import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * App 版號：「主.次.提交數」，例如 1.0.65。
 * 主、次版號寫在 package.json（大改版時手動調）；最後一碼是目前 commit 的提交數，main 每合併一個 PR 自動加一。
 * 建置時算出來，注入程式（__APP_VERSION__）並輸出 version.json（給「有新版本」的提示讀新版號）。
 */
export interface AppVersion {
  version: string
  /** commit 短碼 */
  commit: string
  /** commit 時間（YYYY-MM-DD，台灣時間） */
  date: string
}

const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' }).trim()

export function appVersion(): AppVersion {
  // 淺層 clone（actions/checkout 預設只抓最新一個 commit）算出來的提交數是錯的：直接停下來
  if (git('rev-parse --is-shallow-repository') === 'true') {
    throw new Error('版號需要完整的 git 歷史：actions/checkout 請設定 fetch-depth: 0')
  }
  const [major, minor] = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version.split('.')
  const time = new Date(git('log -1 --format=%cI'))
  return {
    version: `${major}.${minor}.${git('rev-list --count HEAD')}`,
    commit: git('rev-parse --short=7 HEAD'),
    date: time.toLocaleDateString('sv', { timeZone: 'Asia/Taipei' }),
  }
}
