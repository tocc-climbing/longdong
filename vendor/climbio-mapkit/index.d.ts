// @climbio/mapkit 的型別。經緯度一律 [經度, 緯度]；平面座標是公尺（x 向東、y 向南）；資料是 Climbio 公開格式 v2（@climbio/format）的地圖畫面與圖層。

export type LngLat = [number, number];
export type Vec = [number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 移動範圍用：畫面最寬幾公尺（底圖資料的寬） */
  maxW?: number;
}

/** v2 的名稱：字串，或語言代碼 → 字串 */
export type Name = string | Record<string, string>;

export interface Node {
  id: string;
  type?: string;
  name?: Name;
  parent?: string;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Mark {
  node?: string;
  geometry: { type: string; coordinates: unknown };
  props?: { kind?: string; style?: { stroke?: string; fill?: string; [key: string]: unknown }; [key: string]: unknown };
}

/** 地圖畫面：kind: view、surface: map（經緯度）；props.bounds、extent、home 是 [西, 南, 東, 北] */
export interface MapViewDoc {
  climbio: 2;
  kind: 'view';
  surface: 'map';
  id: string;
  attribution: string;
  nodes?: Node[];
  marks?: Mark[];
  props?: { bounds?: number[]; extent?: number[]; home?: number[]; [key: string]: unknown };
  [key: string]: unknown;
}

/** 疊在地圖上的圖層：kind: layer，on 是畫面的 id；有標註的節點以最後一個圖層的形狀為準 */
export interface Layer {
  climbio: 2;
  kind: 'layer';
  id: string;
  on: string;
  t?: number;
  license?: string;
  attribution?: string;
  nodes?: Node[];
  marks?: Mark[];
  [key: string]: unknown;
}

export interface MapData {
  view: MapViewDoc;
  layers?: Layer[];
  /** 其他檔案的節點（例如組合裡的區域、分區名稱） */
  nodes?: Node[];
}

/** 畫面狀態（內部）：中心（平面座標）、每像素幾公尺、旋轉（弧度） */
export interface ViewState {
  cx: number;
  cy: number;
  s: number;
  r: number;
}

/** 畫面（對外）：中心經緯度、每像素幾公尺、旋轉（度，順時針） */
export interface MapViewInfo {
  center: LngLat;
  metersPerPixel: number;
  rotation: number;
}

export interface Projection {
  origin: LngLat;
  project(p: LngLat): Vec;
  unproject(p: Vec): LngLat;
}

export interface MapMarkPoint {
  at: LngLat;
  picked?: LngLat;
  label?: string;
  selected?: boolean;
}

export interface ViewerOptions {
  lang?: string;
  text?: Partial<typeof TEXT.zh>;
  /** 右下角的版權標示；預設是畫面的 attribution */
  attribution?: string | { text: string; href?: string }[];
  /** 區域節點 id：其他區域變淡 */
  dim?: string;
  hideAreas?: boolean;
  /** 不畫的區域、分區節點 id（點也點不到） */
  hide?: string[];
  /** 畫岩壁（預設 true） */
  walls?: boolean;
  /** 放大後標分區名稱（預設 true）；分區 id 陣列只標這些 */
  sectorLabels?: boolean | string[];
  /** 選中的岩壁：分區節點 id 與第幾條（標名稱）；沒有 line 是整個分區的每一條（不標名稱） */
  selected?: { node: string; line?: number };
  basemap?: { osm?: boolean; ortho?: boolean; contours?: boolean };
  marks?: MapMarkPoint[];
  here?: { at: LngLat; accuracy: number };
  /** 圖釘 */
  pin?: LngLat;
  draft?: { points: LngLat[]; closed?: boolean };
  /** 羅盤、縮放按鈕、比例尺（預設 true） */
  controls?: boolean;
  /** 「回到我的位置」按鈕：按了發 locate */
  locate?: boolean;
  aria?: string;
}

export interface EditorOptions extends ViewerOptions {
  /** 受控模式：App 正在畫新的一塊，點地圖一律發 tap */
  picking?: boolean;
  /** 要接著改的圖層（id、license、attribution 沿用） */
  layer?: Layer;
  license?: string;
}

export interface MapModel {
  proj: Projection;
  base: Record<string, string>;
  lines: Record<string, Vec[][]>;
  areas: { id: string; node: Node; path: string; rings: Vec[][]; label: Vec; size: number; style: { fill?: string; stroke?: string } }[];
  walls: { id: string; node: Node; lines: Vec[][]; lngLat: LngLat[][]; style: { stroke?: string } }[];
  pois: { id: string; node: Node; kind: string; at: Vec; label?: string; tone?: string; line?: string }[];
  nodes: Map<string, Node>;
  bounds: Rect;
  extent: Rect;
  home: Rect;
}

export interface Tile {
  key: string;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileSource {
  url: string;
  minZ: number;
  maxZ: number;
  credit: string;
  href: string;
}

export declare const TEXT: Record<'zh' | 'en' | 'ja', { aria: string; locate: string; north: string; zoomIn: string; zoomOut: string; meters: string; hazard: string; boat: string; hoist: string; aid: string }>;
export declare const LINE_HIT_PX: number;

export declare class MapViewer extends EventTarget {
  constructor(host: HTMLElement, options?: ViewerOptions);
  readonly options: ViewerOptions;
  readonly model: MapModel | undefined;
  /** 最近一次畫出來的區域、分區名稱、地點與道路名稱（螢幕座標） */
  readonly labels: { areas: { id: string; at: Vec }[]; sectors: { id: string; at: Vec }[]; markers: { kind: string; at: Vec }[]; lineNames: string[] } | undefined;
  setData(data: MapData): void;
  set(options: ViewerOptions): void;
  getView(): MapViewInfo | undefined;
  setView(view: { center: LngLat; metersPerPixel: number; rotation?: number }): void;
  focus(target: { node?: string; points?: LngLat[]; tight?: boolean }): void;
  zoomBy(factor: number): void;
  toScreen(p: LngLat): Vec;
  toLngLat(p: Vec): LngLat;
  render(): void;
  destroy(): void;
}

export declare class MapEditor extends MapViewer {
  constructor(host: HTMLElement, options?: EditorOptions);
  /** 受控模式：形狀由 App 給（經緯度），修改發 editstart、editchange、select；undefined 結束 */
  setEdit(edit: { rings: LngLat[][]; closed: boolean; selected?: number; faces?: boolean } | undefined): void;
  /** 開始改一個節點的形狀；closed 預設看節點的標註（區域是多邊形），faces 預設分區 */
  edit(target: { node: string; closed?: boolean; faces?: boolean }): void;
  readonly rings: LngLat[][];
  select(index: number): void;
  draw(): void;
  finish(): void;
  cancel(): void;
  flip(index?: number): void;
  removeRing(index?: number): void;
  removeVertex(vertex: number, index?: number): boolean;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** 輸出的圖層：改過的節點各一個標註 */
  readonly layer: Layer;
}

export declare function faceTrail(line: Vec[], trails: Vec[][]): Vec[];
export declare function wallFaces(line: Vec[]): { bearing: number; length: number }[];
export declare function nearestOnSegment(p: Vec, a: Vec, b: Vec): Vec;
export declare function newId(): string;

export declare function readMap(view: MapViewDoc, layers?: Layer[], nodes?: Node[]): MapModel;
export declare function assertMap(view: unknown): asserts view is MapViewDoc;
export declare function pickName(name: Name | undefined, lang: string): string;
export declare function pathOf(line: Vec[], close?: boolean): string;
export declare function centroid(ring: Vec[]): { at: Vec; size: number };
export declare const BASE_KINDS: string[];
export declare const LINE_KINDS: string[];

export declare function renderMap(model: MapModel, view: ViewState, frame: { w: number; h: number }, options: Record<string, unknown>): { svg: string; labels: NonNullable<MapViewer['labels']> };
export declare function wallLabelAt(lines: LngLat[][]): LngLat | undefined;
export declare const SECTOR_LABEL_SCALE: number;

export declare function declutter(...args: unknown[]): { shown: Set<number>; labels: { id: string; text: string; at: Vec }[]; sectorLabels: { id: string; text: string; at: Vec }[]; nudged: Map<number, Vec>; occupied: number[][] };
export declare function placeLineNames(...args: unknown[]): { key: string; name: unknown; points: Vec[]; boxes: number[][] }[];
export declare function textWidth(text: string, fontPx: number): number;
export declare function segmentDistance(p: Vec, a: Vec, b: Vec): number;

export declare function projection(origin: LngLat): Projection;
export declare function toScreen(v: ViewState, frame: { w: number; h: number }, p: Vec): Vec;
export declare function toMap(v: ViewState, frame: { w: number; h: number }, p: Vec): Vec;
export declare function mapTransform(v: ViewState, frame: { w: number; h: number }): string;
export declare function fitRectView(target: Rect, bounds: Rect, frame: { w: number; h: number }, margin?: { x: number; y: number }): ViewState;
export declare function focusView(target: Rect, bounds: Rect, frame: { w: number; h: number }): ViewState;
export declare function clampView(v: ViewState, bounds: Rect, frame: { w: number; h: number }): ViewState;
export declare function clampScale(s: number, bounds: Rect, frame: { w: number; h: number }): number;
export declare function maxScale(bounds: Rect, frame: { w: number; h: number }): number;
export declare function panBy(v: ViewState, dx: number, dy: number): ViewState;
export declare function zoomAt(v: ViewState, frame: { w: number; h: number }, at: { x: number; y: number }, s: number): ViewState;
export declare function rotateAt(v: ViewState, frame: { w: number; h: number }, at: { x: number; y: number }, r: number): ViewState;
export declare function dashLength(px: number, metersPerPixel: number): number;
export declare function rectOf(points: Vec[]): Rect;
export declare const MIN_SCALE: number;
export declare const STEP: number;

export declare const SOURCES: Record<'osm' | 'ortho' | 'contours', TileSource>;
export declare function visibleTiles(proj: Projection, view: ViewState, frame: { w: number; h: number }, source: TileSource, options?: { dpr?: number; level?: number; transparent?: boolean }): Tile[];
export declare function tileLevel(proj: Projection, view: ViewState, dpr?: number, source?: TileSource): number;
export declare function keepContours(pixels: Uint8ClampedArray): void;
export declare function contourTile(href: string): Promise<string>;

export declare const CSS: string;
