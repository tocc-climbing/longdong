// @climbio/topokit 的型別。座標都是照片像素；資料是 Climbio 公開格式 v2（@climbio/format）的照片畫面與圖層。

export type Point = [number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** v2 的名稱：字串，或語言代碼 → 字串 */
export type Name = string | Record<string, string>;

/** v2 的節點（只列 TopoKit 用到的欄位） */
export interface Node {
  id: string;
  type: string;
  name?: Name;
  parent?: string;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Mark {
  node?: string;
  geometry: { type: 'Point'; coordinates: number[] } | { type: 'LineString' | 'MultiPoint'; coordinates: number[][] } | { type: string; coordinates: unknown };
  props?: { label?: string | number; style?: { stroke?: string; [key: string]: unknown }; [key: string]: unknown };
}

/** 照片畫面：kind: view、surface: photo（座標是照片像素） */
export interface PhotoView {
  climbio: 2;
  kind: 'view';
  surface: 'photo';
  id: string;
  href: string;
  w: number;
  h: number;
  nodes?: Node[];
  marks?: Mark[];
  props?: { crop?: Rect; [key: string]: unknown };
  [key: string]: unknown;
}

/** 疊在畫面上的圖層：kind: layer，on 是畫面的 id */
export interface Layer {
  climbio: 2;
  kind: 'layer';
  id: string;
  on: string;
  t?: number;
  nodes?: Node[];
  marks?: Mark[];
  [key: string]: unknown;
}

export interface TopoData {
  view: PhotoView;
  layers?: Layer[];
  /** 額外的節點（例如組合檔裡的路線名稱、難度） */
  nodes?: Node[];
}

export interface Bolt {
  at: Point;
  /** 材質等說明（標註的 props.label） */
  note?: string;
  anchor?: boolean;
  /** bolt 節點的 id */
  id?: string;
}

export interface TopoRoute {
  id: string;
  /** 編號牌的文字（線段標註的 props.label） */
  label?: string;
  /** props.style 是 sport 時 'sport'（藍色），其他 'other'（紅色） */
  kind: 'sport' | 'other';
  grade?: string;
  name?: string;
  line?: Point[];
  /** 位置（B01、A01）→ bolt */
  bolts?: Record<string, Bolt>;
  /** 線段標註的 props.style.stroke：覆蓋線的顏色 */
  stroke?: string;
  /** 它的標註在第幾個圖層（-1 是畫面自己） */
  layer: number;
}

export interface TopoModel {
  photo: { href: string; w: number; h: number };
  crop?: Rect;
  routes: TopoRoute[];
}

export interface ReadOptions {
  lang?: string;
  gradeSystems?: string[];
}

export interface ViewerOptions extends ReadOptions {
  /** 亮色的路線 id */
  highlight?: string;
  /** true＝全部路線的 bolt；路線 id 陣列；預設只畫 highlight 的 */
  bolts?: boolean | string[];
  /** 路線卡片：highlight 標編號與說明，其他只標小的編號 */
  solo?: boolean;
  /** 編輯時的排版：線細一點、不顯示難度名稱，牌子避開 highlight 路線的點（TopoEditor 一律是這個排版） */
  editing?: boolean;
  /** 牌子與字的倍率，預設寬螢幕（≥900px）1.5、其他 1 */
  ui?: number;
  /** 顯示的範圍（照片像素），預設用畫面的 props.crop，沒有就整張 */
  crop?: Rect;
  /** 路線可以點（預設 true） */
  interactive?: boolean;
  /** 'ctrl'（預設）：按著 Ctrl／⌘ 才用滾輪縮放；'always'：直接縮放 */
  wheel?: 'ctrl' | 'always';
  /** 顯示縮放按鈕（預設 true） */
  controls?: boolean;
  /** 可以縮放、平移（預設 true）；false 時滾輪、雙指、點兩下、按鍵都不縮放（路線卡片） */
  zoom?: boolean;
  /** 照片灰階，highlight 路線周圍是原色（路線卡片） */
  reveal?: boolean;
  /** 原色帶子的寬度（顯示範圍寬度的比例，預設 0.14） */
  revealWidth?: number;
  /** 左右滑（照片沒有跟著橫移時）發 swipe 事件 */
  swipe?: boolean;
  /** 縮放按鈕的說明（aria-label、title），預設是按鈕上的符號 */
  text?: { zoomIn?: string; zoomOut?: string; zoomFit?: string; hand?: string };
}

export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export interface ViewerEventMap {
  ready: CustomEvent<undefined>;
  pick: CustomEvent<{ id: string }>;
  zoom: CustomEvent<{ scale: number }>;
  /** 左右滑：1 往左滑（下一條），-1 往右滑（上一條）；要開 swipe 選項 */
  swipe: CustomEvent<{ step: 1 | -1 }>;
  destroy: CustomEvent<undefined>;
}

/** 看圖：照片＋原生 SVG。destroy() 解除所有事件監聽、ResizeObserver、計時器 */
export class TopoViewer extends EventTarget {
  constructor(host: HTMLElement, options?: ViewerOptions);
  readonly host: HTMLElement;
  readonly options: ViewerOptions;
  /** 目前的縮放與平移 */
  readonly state: ViewState;
  readonly model: TopoModel | undefined;
  readonly routes: TopoRoute[];
  /** 不是 v2 照片畫面（或圖層不是疊在這個畫面上）會丟錯 */
  setData(data: TopoData): void;
  setOptions(options: Partial<ViewerOptions>): void;
  select(id: string | undefined): void;
  setView(view: ViewState): void;
  zoomBy(ratio: number, at?: { x: number; y: number }): void;
  /** 平滑地縮放到照片上的一塊（照片像素）；keepZoom 只放大不縮小；已經整個看得到、放得夠大時不動 */
  zoomToRect(rect: Rect, options?: { keepZoom?: boolean; animate?: boolean }): void;
  /** 一個螢幕像素等於幾個照片像素 */
  readonly k: number;
  destroy(): void;
  addEventListener<K extends keyof ViewerEventMap>(type: K, listener: (e: ViewerEventMap[K]) => void, options?: AddEventListenerOptions | boolean): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void;
}

export type Tool = 'select' | 'line' | 'bolt' | 'crop';
export type PickedPoint = { kind: 'line'; index: number } | { kind: 'bolt'; pos: string };

export interface EditorOptions extends ViewerOptions {
  /** 編輯哪個圖層（預設 0）；沒有圖層時建一個空的 */
  editLayer?: number;
  tool?: Tool;
  /** 鍵盤快捷鍵（v 選取、l 畫線、b bolt、f 分岔、z／y 復原重做、Delete 刪除；預設 true）；window：整個視窗都收，modifiers：Ctrl／⌘＋Z、Y，backspace：Backspace 也刪除 */
  keys?: boolean | { window?: boolean; modifiers?: boolean; backspace?: boolean };
  /** 手指按住不動一下出現放大鏡瞄準，放開才放點；拖曳點時也顯示放大鏡 */
  aim?: boolean;
  /** 這條路線可以放的 bolt 位置；有給時只放這些，放完自動換下一個空位 */
  positions?: (routeId: string) => string[];
  /** 每次修改寫進圖層前改寫路線：before 是修改前、id 是改的路線（拖曳的每一步都套用，仍然只記一個復原點） */
  transform?: (routes: TopoRoute[], before: TopoRoute[], id: string | undefined) => TopoRoute[];
}

export interface EditorEventMap extends ViewerEventMap {
  change: CustomEvent<{ layer: Layer; reason: 'line' | 'bolt' | 'move' | 'delete' | 'clear' | 'fork' | 'undo' | 'redo' | 'replace' }>;
  history: CustomEvent<{ canUndo: boolean; canRedo: boolean }>;
  select: CustomEvent<{ id: string | undefined }>;
  selectpoint: CustomEvent<{ picked: PickedPoint | undefined }>;
  tool: CustomEvent<{ tool: Tool }>;
  /** 開始或結束分岔 */
  fork: CustomEvent<{ on: boolean }>;
  /** 裁切範圍改了（拖曳完、setCrop、復原重做）；undefined 是整張 */
  crop: CustomEvent<{ crop: Rect | undefined }>;
}

/**
 * 編輯：畫線、加 bolt、移動與刪除節點、分岔、復原／重做。輸出是圖層（toLayer()），提交與歷史版本由 App 負責。
 * 只有標註在編輯圖層裡的路線能改，其他路線只能看、能選；改的時候丟錯。
 */
export class TopoEditor extends TopoViewer {
  constructor(host: HTMLElement, options?: EditorOptions);
  tool: Tool;
  readonly selected: string | undefined;
  /** 選取的路線可以修改 */
  readonly editable: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canFork: boolean;
  /** 正在分岔（等著點別條路線的一個點） */
  readonly forking: boolean;
  /** 選取的點或 bolt */
  readonly picked: PickedPoint | undefined;
  /** 下一個要放的 bolt 位置 */
  /** 有 positions 而且都放了時是 undefined */
  readonly nextBoltPos: string | undefined;
  setTool(tool: Tool): void;
  setOptions(options: Partial<EditorOptions>): void;
  /** 新增一條路線並選起來；第一次畫線或放 bolt 才寫進圖層。回傳 id */
  addRoute(route?: { id?: string; label?: string | number; name?: string; kind?: 'sport' | 'other' }): string;
  setBoltPos(pos: string | undefined): void;
  /** 整個編輯圖層換掉（例如從舊版本繼續）：記一個復原點、發 change（reason 'replace'） */
  setLayer(layer: Layer): void;
  /** 裁切範圍（照片像素；undefined 是整張） */
  readonly cropRect: Rect | undefined;
  /** 清掉復原紀錄（例如 App 提交了一個版本） */
  clearHistory(): void;
  /** 換裁切範圍：記一個復原點、發 crop 事件 */
  setCrop(rect: Rect | undefined): void;
  /** 「移動」：開啟後左鍵拖曳就是平移 */
  readonly hand: boolean;
  setHand(on: boolean): void;
  /** 在這一點（照片像素）加線上的點或放 bolt，看目前的工具 */
  placeAt(p: Point): void;
  deletePicked(): void;
  /** 選取線上的點或 bolt（undefined 取消），發 selectpoint */
  pickPoint(p: PickedPoint | undefined): void;
  /** 把選取路線的線段整條換成這些點（照片像素，第一點是起攀點）；一次復原 */
  setLine(points: Point[]): void;
  clearRoute(): void;
  fork(on?: boolean): void;
  undo(): void;
  redo(): void;
  /** 編輯後的圖層（複本） */
  toLayer(): Layer;
  addEventListener<K extends keyof EditorEventMap>(type: K, listener: (e: EditorEventMap[K]) => void, options?: AddEventListenerOptions | boolean): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void;
}

/** 不是 v2 的照片畫面就丟錯 */
export function assertView(view: unknown): asserts view is PhotoView;
export function readTopo(data: TopoData, options?: ReadOptions): TopoModel;
/** 編輯後的路線寫回圖層（index 是這個圖層在 layers 裡的位置；known＝路線節點在別處已經有的 id） */
export function writeLayer(layer: Layer, routes: TopoRoute[], index: number, known?: Set<string>): Layer;
export function pickName(name: Name | undefined, lang?: string): string | undefined;
export function pickGrade(grade: string | Record<string, string | number> | undefined, systems?: string[]): string | undefined;
export function newId(): string;

export interface RenderOptions {
  photo: { w: number; h: number };
  crop?: Rect;
  /** 一個螢幕像素等於幾個照片像素 */
  k: number;
  highlight?: string;
  bolts?: boolean | string[];
  editing?: boolean;
  solo?: boolean;
  interactive?: boolean;
  ui?: number;
  /** 不放牌子與說明的範圍（照片像素），例如分享卡片左下角的標誌 */
  reserved?: Rect[];
}
/** 路線、編號、bolt 的 SVG 字串（沒有 DOM 也能跑） */
export function renderLines(routes: TopoRoute[], options: RenderOptions): string;
/** 灰階遮罩：沿著線疊回原色照片的 SVG（線不到兩點時是空字串）；width 是帶子寬度（照片像素），id 是 mask 的 id */
export function renderReveal(line: Point[] | undefined, options: { photo: { href: string; w: number; h: number }; width: number; id: string }): string;

export function drawnRuns(lines: [string, Point[]][]): Map<string, Point[][]>;
export function ownRuns(lines: [string, Point[]][]): Map<string, Point[][]>;
export function segmentAt(line: Point[], p: Point, near: number): number;
export function addLinePoint(routes: TopoRoute[], id: string, p: Point, near: number): TopoRoute[];
export function forkLine(line: Point[], index: number): Point[];
export function moveSharedPoint(routes: TopoRoute[], from: Point, to: Point): TopoRoute[];
export function removeLinePoint(routes: TopoRoute[], id: string, index: number): TopoRoute[];

export function smoothPath(pts: Point[]): string;
export function pathLength(pts: Point[]): number;
export function pointAlong(pts: Point[], f: number): Point;
export function textWidth(text: string, fontPx: number): number;
export function wrapText(text: string, fontPx: number, maxWidth: number): string[];
export class Placer {
  constructor(bounds: Rect, gap?: number, lines?: Point[][]);
  fits(box: Rect): boolean;
  onLine(box: Rect, except?: Point[]): boolean;
  place(candidates: Rect[], force?: boolean): Rect | undefined;
  reserve(box: Rect): void;
}

export const IDENTITY: ViewState;
export const MAX_SCALE: number;
export const DOUBLE_TAP_SCALE: number;
/** 縮放到一塊（box：以內容中心為原點、沒放大時的螢幕像素）；keepZoom 只放大不縮小；已經整個看得到、放得夠大時回傳原本的 view */
export function focusView(view: ViewState, box: Rect, stage: { w: number; h: number }, content: { w: number; h: number }, options?: { keepZoom?: boolean; inset?: { top: number; bottom: number } }): ViewState;
/** 左右滑：照片沒有跟著橫移（panned 小於 1 螢幕像素）時，1 往左滑（下一條）、-1 往右滑（上一條），其他 undefined */
export function swipeStep(from: { x: number; y: number }, to: { x: number; y: number }, panned: number): 1 | -1 | undefined;
export const DRAG_PX: number;
export function clampView(view: ViewState, stage: { w: number; h: number }, content: { w: number; h: number }): ViewState;
export function moveView(view: ViewState, from: { x: number; y: number }, to: { x: number; y: number }, ratio: number, stage: { w: number; h: number }, content: { w: number; h: number }): ViewState;
export function fitSize(stage: { w: number; h: number }, aspect: number): { w: number; h: number };
export function routeCrop(base: Rect, route: TopoRoute | undefined): Rect;
export function isSketch(base: Rect, route: TopoRoute | undefined): boolean;
export function doubleTapView(view: ViewState, at: { x: number; y: number }, stage: { w: number; h: number }, content: { w: number; h: number }): ViewState;
export function isDoubleTap(prev: { at: { x: number; y: number }; time: number } | undefined, now: { at: { x: number; y: number }; time: number }): boolean;
export const CSS: string;
