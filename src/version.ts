import type { AppVersion } from '../scripts/lib/appVersion'

declare const __APP_VERSION__: AppVersion

/** 這一版 App 的版號（建置時由 scripts/lib/appVersion.ts 注入） */
export const APP_VERSION: AppVersion = __APP_VERSION__

/** 「1.0.65 (0968ddc)」 */
export function formatVersion(v: AppVersion): string {
  return `${v.version} (${v.commit})`
}

/** 網站上最新一版的版號：version.json 不在離線快取裡，一定讀網路上的；讀不到時回傳 undefined */
export async function fetchLatestVersion(): Promise<AppVersion | undefined> {
  try {
    const res = await fetch('version.json', { cache: 'no-store' })
    return res.ok ? ((await res.json()) as AppVersion) : undefined
  } catch {
    return undefined
  }
}
