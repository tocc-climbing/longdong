import type { TopoData, TopoEditor, TopoViewer } from './index';

/** <climbio-topo>：載入 @climbio/topokit/element 就註冊。屬性見 element.js 開頭 */
export class TopoElement extends HTMLElement {
  /** { view, layers, nodes }；設了就重畫 */
  data: TopoData | undefined;
  /** 目前的 TopoViewer 或 TopoEditor */
  readonly viewer: TopoViewer | undefined;
  /** mode="edit" 時的 TopoEditor */
  readonly editor: TopoEditor | undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'climbio-topo': TopoElement;
  }
}
