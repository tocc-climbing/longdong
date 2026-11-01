// ClimbioFormat 的型別。照片上的座標都是照片像素（以 photo 的 w、h 為準）；地理座標是 GeoJSON（經度在前）。
// English: ClimbioFormat type definitions. Image coordinates are photo pixels; geo coordinates are GeoJSON.

export type Point = [number, number];
/** s 起攀、h 手點、f 腳點、t 完攀 */
export type HoldType = 's' | 'h' | 'f' | 't';

export interface Photo {
  /** 相對路徑（同一個資料夾、ZIP）或 https 網址 */
  href: string;
  w: number; h: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  sha256?: string;
  license: string;
  attribution: string;
  /** self 自己拍的、authorized 有權利人授權；紙本、來源不明的照片不出裝置 */
  origin: 'self' | 'authorized';
}
export interface DerivedFrom { url: string; id?: string; t?: number }
export interface Hold { id: string; poly: Point[]; source?: 'detect' | 'edited' | 'manual'; t?: number; [key: string]: unknown }
export interface Route {
  id: string;
  holds: Record<string, HoldType>;
  name?: string; grade?: string; author?: string; t?: number;
  seq?: string[];
  shapes?: Record<string, Hold>;
  [key: string]: unknown;
}
interface Common {
  climbio: 2;
  name: string;
  author?: string;
  license: string;
  t: number;
  derivedFrom?: DerivedFrom;
  photo: Photo;
  [key: string]: unknown;
}
/** 室內：一面牆的照片、岩點、路線 */
export interface Wall extends Common { kind: 'wall'; id: string; gym?: string; thumb?: string; holds: Hold[]; routes: Route[] }
export interface TopoRoute { name?: string; grade?: string; line?: Point[]; bolts?: Record<string, Point>; [key: string]: unknown }
export type GeoLine = { type: 'LineString'; coordinates: number[][] } | { type: 'MultiLineString'; coordinates: number[][][] };
/** 戶外：一張岩壁照片上的路線線段與 bolt；路線 id 是來源的 id（例如 longdong/7kq2mx） */
export interface Topo extends Common {
  kind: 'topo'; id: string;
  source?: { url: string; version?: string };
  sector?: string;
  crop?: { x: number; y: number; w: number; h: number };
  routes: Record<string, TopoRoute>;
  geo?: { wall?: GeoLine };
}
export type Doc = Wall | Topo;

export declare const VERSION: 2;
/** JSON Schema（draft 2020-12），同 climbio.schema.json */
export declare const SCHEMA: Record<string, unknown>;
/** 錯誤清單（`欄位路徑：原因`），空陣列就是合格 */
export declare function validate(doc: unknown): string[];

declare const ClimbioFormat: { VERSION: typeof VERSION; SCHEMA: typeof SCHEMA; validate: typeof validate };
export default ClimbioFormat;
