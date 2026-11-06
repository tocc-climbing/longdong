# mapkit（`@climbio/mapkit`）

岩場的**向量地圖**：岩壁、步道、道路、區域、地名、救援點，標籤自動避讓、比例尺、羅盤；拖曳平移、雙指縮放與旋轉；底圖圖磚（OpenStreetMap、航照、等高線）可以開關。**編輯**：畫線、移動與增減頂點、岩壁面朝向、復原／重做，輸出圖層。

- 原生 SVG、純 ES module，**不用建置**、不用框架、不用 npm 也能跑（`<script type="module">` 直接 import）
- 資料是 [Climbio 公開格式 v2](../format/README.md)：**地圖畫面（`kind: view`、`surface: map`，經緯度、經度在前）加圖層（`kind: layer`）**；編輯的輸出也是圖層
- **不做任何上傳、不連任何後端**（圖磚除外）：定位、資料提交、歷史版本由使用的 App 負責
- Apache-2.0（見 `LICENSE`、`NOTICE`；投影、畫面、標籤避讓、畫法、手勢與編輯移植自龍洞，MIT 聲明在 `NOTICE`）

## 試用

從 repo 根目錄開靜態伺服器，打開 `/mapkit/demo.html`（載入 `baseline/longdong-map.json` 的龍洞地圖；不能用 `file://`）：

```bash
python3 -m http.server 8765
```

拖曳、滾輪、點兩下、右鍵區域；上方開關底圖；選一個分區改它的岩壁：拖曳頂點、按邊上的中點加頂點、右鍵刪頂點、「畫線」點地圖再「完成」、「反過來」、復原／重做；下方是輸出的圖層。

## 用法

```html
<script type="module">
  import './mapkit/element.js';   // 註冊 <climbio-map>
</script>
<climbio-map view="map.json" layers="walls.json" lang="zh" basemap="ortho" style="height: 70vh"></climbio-map>
```

或用 JS：

```js
import { MapViewer, MapEditor } from '@climbio/mapkit';

const viewer = new MapViewer(hostElement, { lang: 'en', dim: areaNodeId, basemap: { ortho: true } });
viewer.setData({ view, layers: [layer], nodes: setNodes });   // 不是 v2 地圖畫面就丟錯
viewer.focus({ node: sectorNodeId, tight: true });
viewer.addEventListener('pick', (e) => console.log(e.detail.node));     // 點到岩壁
viewer.addEventListener('tap', (e) => console.log(e.detail.at));        // 點地圖：[經度, 緯度]
viewer.destroy();                                                       // 解除所有事件監聽、ResizeObserver、計時器

const editor = new MapEditor(hostElement, { layer: previousLayer });
editor.setData({ view, layers: [previousLayer] });
editor.edit({ node: sectorNodeId });                                    // 改這個分區的岩壁
editor.addEventListener('change', (e) => save(e.detail.layer));        // 輸出是圖層
editor.draw(); /* 點地圖加點 */ editor.finish();
editor.flip();                                                          // 岩壁面換到另一側
editor.undo();
```

型別在 `index.d.ts`（手寫）。

### 資料怎麼對應（詞彙見 [format/VOCABULARY.md](../format/VOCABULARY.md) 的「地圖」）

| v2 | 畫成 |
|---|---|
| 沒有節點、`props.kind` 是 `land`、`building`、`parking` 的多邊形 | 陸地、建物、停車場（底下是海的顏色） |
| 沒有節點、`props.kind` 是 `highway`、`tunnel`、`road`、`trail` 的線 | 道路（至少畫成實際寬度）、隧道（虛線）、步道（虛線） |
| 沒有節點、`props.kind` 是 `route` 的線 | 建議的行進路線（例如單向繞一圈的車道）：疊在道路上的粗線（顏色 `--mk-route`），沿線的箭頭指向畫線的方向 |
| `type: area`、`crag` 節點的多邊形，標註的 `props.style`（`fill`、`stroke`）、`props.labelAt`（名稱的位置 `[經度, 緯度]`；沒指定時在重心，重心壓到石頭就在分區裡找離石塊和石頭名稱最遠的空地） | 區域與區域名稱（面積大的先排） |
| `type: sector`、`wall` 節點的多邊形 | 石頭（抱石、矮牆）：一顆一顆的石塊，名稱寫在下面，點裡面發 `pick` |
| `type: sector`、`wall` 節點的線，標註的 `props.style.stroke` | 岩壁（沿著牆底），放大後標分區名稱；畫線方向決定岩壁面朝向（右手邊） |
| `type: poi` 節點的 `Point`，`props.kind`：`rescue`、`parking`、`first-aid`、`boat`、`helicopter`、`hazard`、`place`、`line-name` | 救援點（`props.label` 是編號）、停車場、急救器材、船艇接駁點、直升機吊掛點、危險地形、地名（`props.tone`）、沿線排的道路名稱（`props.line` 是哪一種線） |
| 畫面的 `props.bounds`、`extent`、`home`（`[西, 南, 東, 北]`） | 移動範圍、底圖資料的範圍（畫面最寬到這裡）、一開始的畫面 |

名稱依 `lang` 取（沒有就用中文、英文）；可以放在 `nodes`（例如組合檔裡的區域、分區），不用複製進畫面。圖層裡有標註的節點，以最後一個圖層的形狀為準（改過的岩壁蓋掉原本的）。

### 選項

`MapViewer` 與 `MapEditor` 的選項、方法、事件都寫在 `index.d.ts`。常用的：

| 選項 | 內容 |
|---|---|
| `lang` | 名稱與介面文字的語言（`zh`、`en`、`ja`） |
| `dim` | 區域節點 id：其他區域變淡 |
| `walls`、`sectorLabels` | 畫岩壁、放大後標分區名稱（預設都是 `true`） |
| `basemap` | `{ osm, ortho, contours }`：OpenStreetMap、國土測繪中心的航照、1/5000 地形圖的等高線與海岸線 |
| `marks`、`here`、`pin`、`draft` | 回報的位置（圓點、菱形、虛線）、目前位置與誤差圈、圖釘、正在畫的線 |
| `attribution` | 右下角的版權標示（預設是畫面的 `attribution`） |
| `controls` | `false`：不放指北針、縮放鈕、比例尺（元件屬性 `controls="false"`；看全景、不需要量距離的地圖） |
| `dblclick` | `'home'`：點兩下回到一開始的畫面（`home()`），預設是放大（元件屬性 `dblclick="home"`） |
| `locate` | 「回到我的位置」按鈕：按了發 `locate`，定位由 App 做、結果放 `here` |

顏色用 CSS 變數：`--mk-brand`（正在畫、編輯中的線）、`--mk-sea`、`--mk-land`、`--mk-route`（建議路線），設在 `<climbio-map>`（或 `.mk`）上；沒設的用預設值。岩場地圖這種沒有海的，`--mk-sea` 和 `--mk-land` 設一樣，就不會看到一塊方形的陸地。

### 編輯

- 一次改一個節點：`edit({ node })`，多邊形（區域）或線（岩壁）看節點原本的標註。
- 點一塊選它；拖曳頂點移動、按邊上的中點加一個頂點並拖曳（真的移動才記一次復原點）、右鍵或 `removeVertex()` 刪頂點（多邊形至少三點、線兩點）。
- 畫新的一塊：`draw()` 後點地圖加點，`finish()`（Enter）完成、`cancel()`（Esc）放棄；新的岩壁預設朝向最近的步道。
- `flip()` 把線反過來，`removeRing()` 刪一塊；復原／重做：`undo()`、`redo()`（Ctrl／⌘＋Z、Ctrl／⌘＋Y）。每個修改發 `change`（`detail.layer` 是圖層）與 `history`。

## 測試

| 內容 | 在哪裡 |
|---|---|
| 版面（區域、分區、地名、道路名稱、圖示、編輯把手）跟龍洞 `ScaleMap` 畫出來的 SVG 逐項一致、v2 資料讀取、圖層蓋掉舊形狀、畫面縮放、岩壁朝向 | `test/unit.test.mjs`（`npm run test:quick` 跑） |
| 外觀跟龍洞的截圖基準一致（`baseline/`）、demo 看圖與編輯、底圖圖磚、資源清理 | `tests/e2e/mapkit.spec.mjs`、`mapkit-demo.spec.mjs` |

`baseline/` 的地圖畫面（`longdong-map.json`）、場景（`*.scene.json`）、龍洞畫出來的 SVG（`*.map.svg`）與截圖（`*.png`）由龍洞的 `npm run test:map-shots -- --update` 產生，這裡照抄。`longdong-map.json` 的底圖含 OpenStreetMap 的資料（ODbL），只用在測試與 demo。
