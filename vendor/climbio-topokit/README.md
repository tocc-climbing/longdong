# TopoKit（`@climbio/topokit`）

戶外 Topo 的**看圖與編輯**：照片上的路線線段、bolt、編號牌，縮放、點路線；畫線、放 bolt、移動與刪除節點、分岔、復原／重做。

- 原生 SVG、純 ES module，**不用建置**、不用框架、不用 npm 也能跑（`<script type="module">` 直接 import）
- 資料是 [Climbio 公開格式 v2](../format/README.md)：**照片畫面（`kind: view`）加路線圖層（`kind: layer`）**，座標是照片像素；編輯的輸出也是圖層。不認萬分比或任何 App 的舊格式（轉換留在各 App）
- **看圖和編輯只有一種樣子**：編輯時看到的就是最後的結果（編號帶難度、名稱、粗線、線頭線尾），只有正在編的那條頭尾照原樣、每個點有把手
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
editor.setTool('line');                                         // 'select'、'edit'（調整：點線換路線、點自己的線插點、拖點）、'line'、'bolt'
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
| `bolts` | `true` 畫全部路線的 bolt，或路線 id 陣列；`'zoom'` 放大 1.8 倍以上才畫全部；預設只畫 `highlight` 的 |
| `boltCodes` | bolt 牌子帶位置（`× B01`，有在管理 bolt 編號的岩場用），其他只標 `×` |
| `names` | `false`：不顯示路線名稱（預設顯示；元件屬性 `names="false"`） |
| `naturalEnds` | 畫了 bolt 時線尾不畫圓點、停在確保站的牌子前（預設開，`false` 關；編輯時正在編的那條照原樣，每個點都有把手）。線的頭尾一律照資料畫，不自動修掉彎勾、不自動接到確保站 |
| `gradePill` | 編號牌直接帶難度（預設開，`false` 關）：左段路線色底的編號、右段白色小膠囊裡的難度（沒有編號就只有難度），編號照一般路線書放在路線最下面（起點下方；分岔出去的路線標在自己岔出去的線上、靠近分岔點；起點相同但沒有共用線段的一個接一個往下排；放不下才沿線往上），旁邊的說明只剩名稱（優先放在牌子下面）；路線多時自動精簡：原尺寸的編號牌合計佔整張照片放進畫面時面積的 10% 以上就縮成 0.8 倍，20% 以上只留編號不帶難度（沒有編號的路線照樣標難度；路線卡片 `solo` 不受影響）。精簡的程度看整張照片（`densityK`），放大縮小時不變；編號牌記得上次放在哪個位置（`memo`），還放得下就沿用，縮放時不跑來跑去；排版優先順序：編號難度＞名稱＞bolt（元件屬性 `grade-pill="false"` 關） |
| `solo` | 路線卡片：`highlight` 標編號與說明，其他只標小的編號（配合 `crop` 與 `routeCrop()`） |
| `reveal` | 照片灰階，`highlight` 路線周圍是原色 |
| `zoom` | `false`：不能縮放、平移（路線卡片） |
| `swipe` | 左右滑（照片沒有跟著橫移時）發 `swipe` 事件，`detail.step` 是 `1`（下一條）或 `-1`（上一條）；`'page'`（元件 `swipe="page"`）只有一條路線也發，給換前後一張照片用 |
| `text` | 縮放按鈕的說明 `{ zoomIn, zoomOut, zoomFit }`（`aria-label`、`title`） |
| `lang`、`gradeSystems` | 名稱用哪個語言、難度用哪些系統（`yds`、`french`…） |
| `wheel` | `'ctrl'`（預設，Viewer：按著 Ctrl／⌘ 才縮放，頁面照常捲動）或 `'always'`（Editor 預設） |

顏色用 CSS 變數：`--tk-sport`、`--tk-sport-on`、`--tk-other`、`--tk-other-on`、`--tk-bolt`、`--tk-bg`。字型固定（系統字），不跟 App 的字型走；App 對所有 `svg` 設的全域樣式（例如圖示的 `stroke`）不會套到路線圖上。

### 編輯

- 畫線：點照片加點；點在線段中間就插進那一段，其他地方接在線尾。拖曳點移動（真的移動才記一次復原點）。換線重畫前，忽略目前路線已不存在的舊把手。`setLine(points)` 把整條換掉（例如從別處描來的線），一次復原。
- Bolt：`bolt` 工具點一下放下一個空的位置（`B01`、`B02`…，`setBoltPos('A01')` 放 anchor）。
- 刪除：右鍵、`Delete` 鍵或 `deletePicked()`；手指點在點旁邊選取，再按刪除。
- 分岔：新路線還沒畫線時 `fork()`，點別條路線的一個點，複製到那個點為止的前段。
- 復原／重做：`undo()`、`redo()`（`z`、`y`；Ctrl／⌘＋Z）；每個修改發 `change`（`detail.layer` 是編輯後的圖層）與 `history`。
- 手指：點一下加點，雙指縮放，放大後單指平移，點兩下回到整張（第一下若才加了點就收回）。
- 裁切：`crop` 工具（`c`）顯示整張照片與裁切框，拖曳框內移動、拖曳邊或角調整大小，`Enter` 結束；結果在 `cropRect`，改了發 `crop` 事件（拖曳完、`setCrop()`、復原重做），裁切也在復原紀錄裡。
- 平移：手指在放大後的空白處拖曳；滑鼠按住不動一下再拖曳、空白鍵或中鍵拖曳、縮放按鈕旁的「移動」（`setHand()`）。host 的 CSS `scroll-padding-top`／`bottom` 是上下浮著的按鈕高度，照片的上下緣可以拖到按鈕外面。
- 手機：`aim` 開著時手指按住不動一下出現放大鏡，滑動對準，放開才放點；拖曳點時也顯示放大鏡。選取工具下手指點在點旁邊選那個點。
- 自動縮放：`zoomToRect(rect, { keepZoom })` 平滑地縮放到照片上的一塊（已經看得到就不動）；目前倍率在 host 的 `data-scale`。
- App 的資料規則：`positions(routeId)` 決定 bolt 能放哪些位置（放完自動換下一個空位），`transform(routes, before, id)` 在每次修改寫進圖層前改寫路線（例如共用的 bolt 讓另一條路線跟著動），`setLayer()` 換掉整個編輯圖層（可以復原），`keys: { window, modifiers, backspace }` 調整鍵盤。
- 只改編輯圖層（`editLayer`）裡的路線；畫面或別的圖層的路線只能看、能選，改的時候丟錯。

## 測試

| 內容 | 在哪裡 |
|---|---|
| 版面跟龍洞的 `TopoLines` 逐項一致、v2 資料進出（輸出通過 `validate`）、共用線段、縮放 | `test/unit.test.mjs`（`npm run test:quick` 跑） |
| 外觀跟龍洞的截圖基準一致（`baseline/`，兩邊用同一份 TopoKit）、demo 看圖與編輯、觸控、資源清理 | `tests/e2e/topokit.spec.mjs`、`topokit-demo.spec.mjs` |

`baseline/` 的場景（`*.scene.json`）與截圖（`*.png`）由龍洞的 `npm run test:topo-shots -- --update` 產生，這裡照抄。

Web Component 可設 `controls="false"` 隱藏縮放工具，保留雙指與點兩下縮放；不設定時照常顯示。舞台尺寸取未變形的版面尺寸，祖先的換頁縮放動畫不會改變照片與路線圖層的比例。

`fit="cover"` 等比鋪滿舞台，照片與路線圖層同步縮放；預設 `contain` 完整顯示。`swipe` 屬性會轉出 `swipe` 事件；多條路線在起始視角留給左右換線，放大後拖曳照片，編輯時不換線。

`fit="width"` 以舞台寬度等比顯示照片並垂直置中，適合相簿式看圖；照片與路線圖層共用縮放，不因舞台高度裁掉照片左右。
