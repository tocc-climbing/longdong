// <climbio-map>：Web Component，包住 MapViewer／MapEditor，React、Vue、純 HTML 都能直接放。載入這個檔就註冊。
// 資料：屬性 view（地圖畫面的網址）、layers（圖層的網址，空白分隔），或設屬性（property）data＝{ view, layers, nodes }。
// 網址只收 https 或同一個網站（相對路徑照頁面網址解析）；圖層的 on 要等於畫面的 id。
// 其他屬性：mode="view|edit"、lang、dim（區域節點 id）、basemap（空白分隔：osm ortho contours）、no-walls、locate、dblclick="home"（點兩下回到一開始的畫面）、controls="false"（不放指北針、縮放鈕、比例尺）。
// 事件（原樣轉出）：ready、view、tap、pick、areapress、locate、error；編輯時還有 change、history、select。
// 要呼叫方法用 el.viewer（mode="edit" 時是 MapEditor）。從頁面拿掉元件時所有監聽與觀察器都解除，再放回來會重建。
// 伺服器端（沒有 HTMLElement）載入時什麼都不做。
// English: <climbio-map> Web Component wrapping MapViewer/MapEditor. Loading this file registers it.
import { MapViewer } from './view.js';
import { MapEditor } from './editor.js';

const EVENTS = ['view', 'tap', 'pick', 'areapress', 'locate', 'error', 'change', 'history', 'select'];

async function getJson(href) {
  const url = new URL(href, document.baseURI);
  if (url.protocol !== 'https:' && url.origin !== location.origin) throw new Error(`必須是 https 或同一個網站：${url.href}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}：${url.href}`);
  return res.json();
}

export const MapElement =
  typeof HTMLElement === 'undefined' || typeof customElements === 'undefined'
    ? undefined
    : (() => {
        class MapElement extends HTMLElement {
          static get observedAttributes() {
            return ['view', 'layers', 'mode', 'lang', 'dim', 'basemap', 'no-walls', 'locate', 'dblclick', 'controls'];
          }
          constructor() {
            super();
            this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;height:300px;position:relative}.root{position:absolute;inset:0}</style><div class="root"></div>';
            this.root = this.shadowRoot.querySelector('.root');
            this._data = undefined;
            this.viewer = undefined;
            this.token = 0;
          }
          get data() {
            return this._data;
          }
          set data(d) {
            this._data = d;
            if (!this.viewer) return;
            this.viewer.setData(d);
            this.dispatchEvent(new CustomEvent('ready'));
          }
          options() {
            return {
              lang: this.getAttribute('lang') ?? 'zh',
              dim: this.getAttribute('dim') ?? undefined,
              walls: !this.hasAttribute('no-walls'),
              locate: this.hasAttribute('locate'),
              ...(this.getAttribute('dblclick') === 'home' ? { dblclick: 'home' } : {}),
              controls: this.getAttribute('controls') !== 'false',
              basemap: Object.fromEntries((this.getAttribute('basemap') ?? '').split(/\s+/).filter(Boolean).map((k) => [k, true])),
            };
          }
          connectedCallback() {
            this.#build();
          }
          disconnectedCallback() {
            this.viewer?.destroy();
            this.viewer = undefined;
          }
          attributeChangedCallback(name, old, value) {
            if (old === value || !this.isConnected || !this.viewer) return;
            if (name === 'mode' || name === 'locate' || name === 'controls') this.#build();
            else if (name === 'view' || name === 'layers') this.#load();
            else this.viewer.set(this.options());
          }
          #build() {
            this.viewer?.destroy();
            const Kind = this.getAttribute('mode') === 'edit' ? MapEditor : MapViewer;
            this.viewer = new Kind(this.root, this.options());
            for (const type of EVENTS) this.viewer.listen(this.viewer, type, (e) => this.dispatchEvent(new CustomEvent(type, { detail: e.detail })));
            if (this._data) this.data = this._data;
            else this.#load();
          }
          async #load() {
            const view = this.getAttribute('view');
            if (!view) return;
            const token = ++this.token;
            try {
              const [v, ...layers] = await Promise.all([view, ...(this.getAttribute('layers') ?? '').split(/\s+/).filter(Boolean)].map(getJson));
              if (token !== this.token) return;
              for (const l of layers) if (l.on !== v.id) throw new Error(`圖層 ${l.id} 不是疊在 ${v.id} 上`);
              this.data = { view: v, layers };
            } catch (err) {
              this.dispatchEvent(new CustomEvent('error', { detail: err }));
            }
          }
        }
        if (!customElements.get('climbio-map')) customElements.define('climbio-map', MapElement);
        return MapElement;
      })();
