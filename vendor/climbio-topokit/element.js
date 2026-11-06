// <climbio-topo>：Web Component，包住 TopoViewer／TopoEditor，React、Vue、純 HTML 都能直接放。載入這個檔就註冊。
// 資料：屬性 view（照片畫面的網址）、layers（圖層的網址，空白分隔），或設屬性（property）data＝{ view, layers, nodes }。
// 網址只收 https 或同一個網站（相對路徑照頁面網址解析）；圖層的 on 要等於畫面的 id。
// 其他屬性：mode="view|edit"、highlight（路線 id）、bolts（全部路線的 bolt；bolts="zoom" 放大才畫）、grade-pill="false"（編號牌不帶難度）、names="false"（不顯示路線名稱）、solo、controls="false"（隱藏縮放工具）、fit="contain|cover|width"、swipe（swipe="page" 一條路線也發）、tool="line|bolt|select"、lang。
// 事件（原樣轉出）：ready、pick、zoom、swipe、load；編輯時還有 change、history、select、selectpoint、tool。
// 要呼叫編輯器的方法用 el.editor（mode="edit" 時是 TopoEditor）。從頁面拿掉元件時所有監聽與觀察器都解除，再放回來會重建。
// 伺服器端（沒有 HTMLElement）載入時什麼都不做。
// English: <climbio-topo> Web Component wrapping TopoViewer/TopoEditor. Loading this file registers it.
import { TopoViewer } from './view.js';
import { TopoEditor } from './editor.js';

const EVENTS = ['ready', 'pick', 'zoom', 'swipe', 'change', 'history', 'select', 'selectpoint', 'tool'];

async function getJson(href) {
  const url = new URL(href, document.baseURI);
  if (url.protocol !== 'https:' && url.origin !== location.origin) throw new Error(`必須是 https 或同一個網站：${url.href}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}：${url.href}`);
  return { json: await res.json(), url: url.href };
}

export const TopoElement =
  typeof HTMLElement === 'undefined' || typeof customElements === 'undefined'
    ? undefined
    : (() => {
        class TopoElement extends HTMLElement {
          static get observedAttributes() {
            return ['view', 'layers', 'mode', 'highlight', 'bolts', 'solo', 'tool', 'lang', 'controls', 'fit', 'swipe', 'grade-pill', 'names'];
          }
          constructor() {
            super();
            this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;height:300px;position:relative}.root{position:absolute;inset:0}</style><div class="root"></div>';
            this.root = this.shadowRoot.querySelector('.root');
            this._data = undefined;
            this.instance = undefined;
            this.token = 0;
          }
          get data() {
            return this._data;
          }
          set data(v) {
            this._data = v;
            this.build();
          }
          /** 目前的 TopoViewer 或 TopoEditor */
          get viewer() {
            return this.instance;
          }
          /** mode="edit" 時的 TopoEditor，其他時候是 undefined */
          get editor() {
            return this.instance instanceof TopoEditor ? this.instance : undefined;
          }
          connectedCallback() {
            this.load();
          }
          disconnectedCallback() {
            this.token++;
            this.teardown();
          }
          attributeChangedCallback(name) {
            if (!this.isConnected) return;
            if (name === 'view' || name === 'layers') this.load();
            else if (name === 'mode' || name === 'controls') this.build();
            else if (name === 'tool') this.editor?.setTool(this.getAttribute('tool'));
            else this.instance?.setOptions(this.options());
          }
          options() {
            return {
              highlight: this.getAttribute('highlight') || undefined,
              bolts: this.getAttribute('bolts') === 'zoom' ? 'zoom' : this.hasAttribute('bolts') ? true : undefined,
              gradePill: this.getAttribute('grade-pill') !== 'false',
              names: this.getAttribute('names') !== 'false',
              solo: this.hasAttribute('solo'),
              controls: this.getAttribute('controls') !== 'false',
              fit: ['cover', 'width'].includes(this.getAttribute('fit')) ? this.getAttribute('fit') : 'contain',
              swipe: this.hasAttribute('swipe') && this.getAttribute('mode') !== 'edit' && (this.getAttribute('swipe') === 'page' ? 'page' : true),
              lang: this.getAttribute('lang') || undefined,
            };
          }
          /** 讀 view、layers 屬性指的檔案（沒有 view 屬性就用 data 屬性） */
          async load() {
            const view = this.getAttribute('view');
            if (!view) return this.build();
            const token = ++this.token;
            try {
              const urls = [view, ...(this.getAttribute('layers') ?? '').split(/\s+/).filter(Boolean)];
              const [v, ...layers] = await Promise.all(urls.map(getJson));
              if (token !== this.token) return;
              // 畫面的 href 是相對路徑時，照畫面檔案的網址解析
              this._data = { view: { ...v.json, href: new URL(v.json.href, v.url).href }, layers: layers.map((l) => l.json) };
              this.build();
              this.dispatchEvent(new CustomEvent('load'));
            } catch (error) {
              if (token === this.token) this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
            }
          }
          teardown() {
            this.instance?.destroy();
            this.instance = undefined;
          }
          build() {
            this.teardown();
            if (!this.isConnected || !this._data) return;
            const edit = this.getAttribute('mode') === 'edit';
            const options = { ...this.options(), ...(edit && this.getAttribute('tool') ? { tool: this.getAttribute('tool') } : {}) };
            const instance = (this.instance = edit ? new TopoEditor(this.root, options) : new TopoViewer(this.root, options));
            for (const type of EVENTS) instance.addEventListener(type, (e) => this.dispatchEvent(new CustomEvent(type, { detail: e.detail })), { signal: instance.ac.signal });
            instance.setData(this._data);
          }
        }
        if (!customElements.get('climbio-topo')) customElements.define('climbio-topo', TopoElement);
        return TopoElement;
      })();
