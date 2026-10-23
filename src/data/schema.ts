import { z } from 'zod'

/**
 * 資料格式定義。匯入程式用它驗證，前端只用 `import type` 取得型別。
 * 日期一律是部分 ISO 字串："YYYY"、"YYYY-MM" 或 "YYYY-MM-DD"。
 */

const PartialDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)

/** 全域唯一 ID：<岩場>/<岩場內 ID>，例如 longdong/523。使用者資料以此指向路線，發布後不可再改 */
const GlobalId = z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+$/)

export const LocalizedName = z.object({
  zh: z.string().min(1),
  en: z.string().optional(),
})

export const RouteType = z.enum(['sport', 'trad', 'toprope', 'boulder', 'mixed'])

export const RouteStatus = z.enum([
  'tested', // 已拉測
  'rebolted', // 已更新
  'needs-test', // 待拉測
  'needs-rebolt', // 待更新
  'closed', // 路線封閉
  'to-remove', // 待移除
  'unknown', // 待查、待確認
])

/** 安全評級燈號：Sheet 上以三顆點表示，亮起的那一顆即為評級 */
export const Safety = z.enum(['green', 'yellow', 'red'])

export const Bolt = z.object({
  /** B01…B18 是路線上的 bolt，A01…A04 是 anchor */
  position: z.string().regex(/^[AB]\d{2}$/),
  /** 材質代號（316-TW、Ti-U…）或特殊值（共用、無 Anchor、天然固定點、待查…） */
  material: z.string(),
  installed: PartialDate.optional(),
  /** 拉測日期，新到舊 */
  tests: z.array(PartialDate),
})

export const AnchorHardware = z.object({
  item: z.string(),
  quantity: z.number().int().positive().optional(),
  spec: z.string().optional(),
  installed: PartialDate.optional(),
})

export const Route = z.object({
  /** longdong/523、longdong/100.1、longdong/242-p2；未編號項目為 longdong/x-<雜湊> */
  id: GlobalId,
  /** 官方路線編號，例如 "523"、"100.1"；未編號（Sheet 上為 # 0）時省略 */
  number: z.string().optional(),
  /** 沒有難度和種類的項目，例如救援固定點、私設固定點 */
  isFixture: z.boolean(),
  name: LocalizedName,
  /** 多繩距路線的第幾段（從名稱的「| P2」取得） */
  pitch: z.number().int().positive().optional(),
  grade: z.string().optional(),
  /** 用來排序和篩選的難度數值，5.10a = 40，5.10b = 41… */
  gradeValue: z.number().optional(),
  type: RouteType.optional(),
  heightM: z.number().positive().optional(),
  firstAscent: z.string().optional(),
  firstAscentDate: PartialDate.optional(),
  /** 首攀日期讀不成日期時的原文，例如「1990年代」 */
  firstAscentDateLabel: z.string().optional(),
  description: z.string().optional(),
  safety: Safety.optional(),
  bolts: z.array(Bolt),
  anchors: z.array(Bolt),
  anchorHardware: z.array(AnchorHardware),
  boltCount: z.number().int().nonnegative().optional(),
  status: RouteStatus.optional(),
  statusLabel: z.string().optional(),
  statusDate: PartialDate.optional(),
  /** 所有 bolt 和 anchor 中最近一次拉測日期 */
  lastTested: PartialDate.optional(),
  notes: z.string().optional(),
})

export const Sector = z.object({
  id: GlobalId,
  name: LocalizedName,
  routes: z.array(Route),
})

export const Area = z.object({
  id: GlobalId,
  name: LocalizedName,
  /** Sheet 上該區域標題列的底色，App 用作區域的識別色 */
  color: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
  /** Sheet 表頭上的統計數字 */
  summary: z.object({ bolts: z.number().optional(), routes: z.number().optional() }),
  sectors: z.array(Sector),
})

export const Hardware = z.object({
  code: z.string(),
  description: z.string(),
})

export const Crag = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: LocalizedName,
})

export const Dataset = z.object({
  schemaVersion: z.literal(2),
  crag: Crag,
  /** 路線ID 來源：legacy 為依路線編號產生（過渡期），sheet 為 Sheet 上「路線ID」欄（固定不變） */
  idSource: z.enum(['legacy', 'sheet']),
  /** 內容雜湊，資料沒變時維持不變 */
  version: z.string(),
  /** 資料內容最後一次變動的時間（ISO 8601） */
  updatedAt: z.string(),
  source: z.object({
    sheetId: z.string(),
    url: z.string().url(),
    /** 資料維護單位，顯示於 App 與授權標示 */
    attribution: z.string(),
    projectUrl: z.string().url(),
  }),
  license: z.string(),
  hardware: z.array(Hardware),
  areas: z.array(Area),
})

export type LocalizedName = z.infer<typeof LocalizedName>
export type RouteType = z.infer<typeof RouteType>
export type RouteStatus = z.infer<typeof RouteStatus>
export type Safety = z.infer<typeof Safety>
export type Bolt = z.infer<typeof Bolt>
export type AnchorHardware = z.infer<typeof AnchorHardware>
export type Route = z.infer<typeof Route>
export type Sector = z.infer<typeof Sector>
export type Area = z.infer<typeof Area>
export type Hardware = z.infer<typeof Hardware>
export type Crag = z.infer<typeof Crag>
export type Dataset = z.infer<typeof Dataset>
