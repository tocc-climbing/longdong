export interface Versioned {
  id: string
  uid: string
  createdAt: number
}

/** 連續的一筆（顯示用）：latest 是最新的版本，members 是合併進來的所有版本（舊到新） */
export interface VersionGroup<T> {
  latest: T
  members: T[]
}

const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * 修改記錄的顯示：同一天、同一個人、中間沒有別人修改的連續版本合併成一筆（只影響顯示，版本資料不動）。
 * 輸入舊到新，輸出新到舊。
 */
export function groupVersions<T extends Versioned>(versions: T[]): VersionGroup<T>[] {
  const groups: VersionGroup<T>[] = []
  for (const v of versions) {
    const last = groups.at(-1)
    if (last && last.latest.uid === v.uid && dayKey(last.latest.createdAt) === dayKey(v.createdAt)) {
      last.members.push(v)
      last.latest = v
    } else groups.push({ latest: v, members: [v] })
  }
  return groups.reverse()
}
