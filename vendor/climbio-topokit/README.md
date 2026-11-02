# TopoKit（`@climbio/topokit`）

戶外 Topo 的**看圖與編輯**：照片上的路線線段、bolt、編號牌，縮放、點路線；畫線、放 bolt、移動與刪除節點、分岔、復原／重做。

- 原生 SVG、純 ES module，**不用建置**、不用框架、不用 npm 也能跑（`<script type="module">` 直接 import）
- 資料是 [Climbio 公開格式 v2](../format/README.md)：**照片畫面（`kind: view`）加路線圖層（`kind: layer`）**，座標是照片像素；編輯的輸出也是圖層。不認萬分比或任何 App 的舊格式（轉換留在各 App）
- **不做任何上傳、不連任何後端**：資料提交、歷史版本由使用的 App 負責
- Apache-2.0（見 `LICENSE`、`NOTICE`；版面演算法移植自龍洞，MIT 聲明在 `NOTICE`）

## 試用

從 repo 根目錄開靜態伺服器，打開 `/topokit/demo.html`（載入 `format/examples` 的騙人的牆；不能用 `file://`）：

```bash
python3 -m http.server 8765
```

看圖、切到「編輯」畫線、放 bolt、拖曳、右鍵刪除、復原／重做；右下角的區塊是編輯後輸出的圖層。

## 用法

```html
<script type="module">
  import './topokit/element.js';   // 註冊 <climbio-topo>
</script>
<climbio-topo view="topo.json" layers="topo-routes.json" bolts style="height: 70vh"></climbio-topo>
```

或用 JS：

```js
import { TopoViewer, TopoEditor } from '@climbio/topokit';

const viewer = new TopoViewer(hostElement, { highlight: 'tdebo72up4xx11pe', bolts: true });
viewer.setData({ view, layers: [layer], nodes: setNodes });   // 不是 v2 照片畫面就丟錯
viewer.addEventListener('pick', (e) => console.log(e.detail.id));
viewer.destroy();                                               // 解除所有事件監聽、ResizeObserver、排程的重畫

const editor = new TopoEditor(hostElement, { editLayer: 0 });
editor.setData({ view, layers: [layer] });
editor.addEventListener('change', (e) => save(e.detail.layer)); // 輸出是圖層
editor.addRoute({ label: 9, name: '新路線', kind: 'sport' });
editor.setTool('line');                                         // 'select'、'line'、'bolt'
editor.undo();
```

型別在 `index.d.ts`（手寫）。

### 資料怎麼對應（詞彙見 [format/VOCABULARY.md](../format/VOCABULARY.md)）

| v2 | 畫成 |
|---|---|
| `type: route` 的節點，指向它的 `LineString` 標註 | 一條路線的線段（第一點是起攀點） |
| 線段標註的 `props.label` | 編號牌的文字 |
| 路線節點的 `props.style`（`sport` 藍色，其他紅色）、`name`、`props.grade` | 線的顏色；編號旁邊的難度與名稱（空間夠才顯示） |
| 線段標註的 `props.style.stroke` | 覆蓋線的顏色 |
| `type: bolt`／`anchor` 的節點（`parent` 是路線，`name` 是位置：`B01`…、`A01`…），指向它的 `Point` 標註 | bolt、anchor 的小牌子（`×`、`××`） |
| bolt 標註的 `props.label` | bolt 旁邊的材質說明 |
| 畫面的 `props.crop` | 顯示的範圍（標註的座標不受影響） |

路線的名稱、難度可以放在 `nodes`（例如組合檔 `set.json` 裡的路線節點），不用複製進圖層。

**共用線段**：v2 沒有共用線段，分岔是複製前段的點。兩端座標相同的線段視為共用，只畫一次、編號標在各自的岔線上；在共用的線段上加點、移動共用的點時，分岔的路線一起動，兩條線不會分開。

### 選項

`TopoViewer` 與 `TopoEditor` 的選項、方法、事件都寫在 `index.d.ts`。常用的：

| 選項 | 內容 |
|---|---|
| `highlight` | 亮色的路線 id |
| `bolts` | `true` 畫全部路線的 bolt，或路線 id 陣列；預設只畫 `highlight` 的 |
| `solo` | 路線卡片：`highlight` 標編號與說明，其他只標小的編號（配合 `crop` 與 `routeCrop()`） |
| `reveal` | 照片灰階，`highlight` 路線周圍是原色 |
| `zoom` | `false`：不能縮放、平移（路線卡片） |
| `swipe` | 左右滑（照片沒有跟著橫移時）發 `swipe` 事件，`detail.step` 是 `1`（下一條）或 `-1`（上一條） |
| `text` | 縮放按鈕的說明 `{ zoomIn, zoomOut, zoomFit }`（`aria-label`、`title`） |
| `lang`、`gradeSystems` | 名稱用哪個語言、難度用哪些系統（`yds`、`french`…） |
| `wheel` | `'ctrl'`（預設，Viewer：按著 Ctrl／⌘ 才縮放，頁面照常捲動）或 `'always'`（Editor 預設） |

顏色用 CSS 變數：`--tk-sport`、`--tk-sport-on`、`--tk-other`、`--tk-other-on`、`--tk-bolt`、`--tk-bg`。

### 編輯

- 畫線：點照片加點；點在線段中間就插進那一段，其他地方接在線尾。拖曳點移動（真的移動才記一次復原點）。`setLine(points)` 把整條換掉（例如從別處描來的線），一次復原。
- Bolt：`bolt` 工具點一下放下一個空的位置（`B01`、`B02`…，`setBoltPos('A01')` 放 anchor）。
- 刪除：右鍵、`Delete` 鍵或 `deletePicked()`；手指點在點旁邊選取，再按刪除。
- 分岔：新路線還沒畫線時 `fork()`，點別條路線的一個點，複製到那個點為止的前段。
- 復原／重做：`undo()`、`redo()`（`z`、`y`；Ctrl／⌘＋Z）；每個修改發 `change`（`detail.layer` 是編輯後的圖層）與 `history`。
- 手指：點一下加點，雙指縮放，放大後單指平移，點兩下回到整張（第一下若才加了點就收回）。
- 只改編輯圖層（`editLayer`）裡的路線；畫面或別的圖層的路線只能看、能選，改的時候丟錯。

## 測試

| 內容 | 在哪裡 |
|---|---|
| 版面跟龍洞的 `TopoLines` 逐項一致、v2 資料進出（輸出通過 `validate`）、共用線段、縮放 | `test/unit.test.mjs`（`npm run test:quick` 跑） |
| 外觀跟龍洞的截圖基準一致（`baseline/`）、demo 看圖與編輯、觸控、資源清理 | `tests/e2e/topokit.spec.mjs`、`topokit-demo.spec.mjs` |

`baseline/` 的場景（`*.scene.json`）、龍洞排出來的標記（`*.lines.svg`）與截圖（`*.png`）由龍洞的 `npm run test:topo-shots -- --update` 產生，這裡照抄。
