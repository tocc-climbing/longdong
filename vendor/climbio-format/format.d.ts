// ClimbioFormat 的型別。畫面上的座標用畫面的座標系（照片像素、向量圖的 w／h、地圖的經緯度）；節點的 geo 一律是經緯度（經度在前）。
// English: ClimbioFormat type definitions: views, layers, sets, nodes and marks.

export type Position = [number, number] | [number, number, number];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };
/** 字串，或語言代碼 → 字串（例如 { "zh-Hant": "後門", "en": "Back Door" }） */
export type Text = string | Record<string, string>;

/** 節點：任何東西（路線、岩點、bolt、分區……）。type 是自由字串，描述放 props，詞彙見 VOCABULARY.md */
export interface Node {
  id: string;
  type?: string;
  name?: Text;
  /** 上層節點：這個檔案的 id、全域 id，或「檔案id#節點id」 */
  parent?: string;
  author?: string; t?: number; license?: string;
  geo?: Geometry;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}
/** 標註：畫在畫面上的一個形狀；node 是這個檔案（或圖層底下的畫面）的節點 id，或全域 id */
export interface Mark { node?: string; geometry: Geometry; props?: Record<string, unknown>; [key: string]: unknown }
/** 拍照資料：作者同意公開才寫 */
export interface Camera {
  /** [經度, 緯度] 或 [經度, 緯度, 高度（公尺）] */
  position: Position;
  /** 水平誤差（公尺） */
  accuracy?: number;
  /** 鏡頭朝向，從正北順時針 0–360 度 */
  heading?: number;
  /** 俯仰，往上為正，-90–90 度 */
  pitch?: number;
  /** 拍攝時間（毫秒） */
  t?: number;
  /** 等效 35mm 焦距（公釐） */
  focal?: number;
  model?: string;
}
interface Common {
  climbio: 2;
  /** 隨機、至少 12 碼小寫英數（新產生的用 16 碼） */
  id: string;
  name?: Text;
  t: number;
  author?: string;
  license: string;
  attribution?: string;
  source?: { url: string; version?: string };
  derivedFrom?: { url: string; id?: string; t?: number };
  props?: Record<string, unknown>;
  nodes?: Node[];
  [key: string]: unknown;
}
interface ViewCommon extends Common {
  kind: 'view';
  attribution: string;
  /** self 自己的、authorized 有權利人授權；紙本、來源不明的不出裝置 */
  origin: 'self' | 'authorized';
  marks?: Mark[];
}
export interface PhotoView extends ViewCommon {
  surface: 'photo';
  href: string; w: number; h: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  sha256?: string;
  camera?: Camera;
}
export interface DrawingView extends ViewCommon {
  surface: 'drawing';
  w: number; h: number;
  href?: string; mime?: 'image/svg+xml' | 'image/png' | 'image/webp' | 'image/jpeg'; sha256?: string;
}
export interface MapView extends ViewCommon { surface: 'map' }
export type View = PhotoView | DrawingView | MapView;
/** 圖層：疊在畫面 on 上的節點和標註（常變更的資料） */
export interface Layer extends Common { kind: 'layer'; on: string; href?: string; marks?: Mark[] }
/** 組合：畫面、圖層或組合放在一起，可以再組合 */
export interface Set extends Common { kind: 'set'; type?: string; items?: { href: string; id?: string; name?: Text; t?: number; props?: Record<string, unknown> }[] }
export type Doc = View | Layer | Set;

export declare const VERSION: 2;
/** JSON Schema（draft 2020-12），同 climbio.schema.json */
export declare const SCHEMA: Record<string, unknown>;
/** 錯誤清單（`欄位路徑：原因`），空陣列就是合格 */
export declare function validate(doc: unknown): string[];

declare const ClimbioFormat: { VERSION: typeof VERSION; SCHEMA: typeof SCHEMA; validate: typeof validate };
export default ClimbioFormat;
