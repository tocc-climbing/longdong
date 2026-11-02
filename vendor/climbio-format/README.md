# Climbio 公開格式（v2）

分享攀岩資料用的 JSON 格式。以**畫面**為中心：一張照片、一張向量圖或一張地圖，上面畫著標註；路線、岩點、岩壁、岩場都只是指向畫面上某個形狀的**節點**。常變更的資料放在疊在畫面上的**圖層**，其他東西都是畫面的**組合**。任何 App 只照這份說明和 `climbio.schema.json` 就能讀、能寫，不需要 Climbio 的伺服器、帳號或 Firebase。

這個資料夾是 npm 套件 `@climbio/format`：JSON Schema（draft 2020-12）、驗證器、樣本，沒有相依套件、沒有建置步驟。節點的 `type` 和 `props` 用哪些詞彙另見 [VOCABULARY.md](VOCABULARY.md)。

> Climbio App 目前分享出去的仍是 v1（[docs/route-format.md](../docs/route-format.md)），之後改成輸出 v2。

## 設計原則

- **核心固定，詞彙開放**：本文件只規定結構（畫面、圖層、組合、節點、標註）。節點是什麼（`type`）、帶什麼資料（`props`）都是詞彙，增加詞彙不改規格、不改驗證器、不升版本。
- **以畫面為中心**：分享的最小單位是一個畫面，加上需要的圖層；岩館、岩場、導覽、站、總目錄都是組合，層數不限。
- **固定的和常變更的分開**：照片、岩點外框、岩壁線這類很少變的放在畫面，收下就能永久快取；路線、Topo 線段這類常改的放在圖層，改了只換圖層。
- **資料最小化**：每項資料只寫在一個地方，其他檔案用 id 引用，不複製。欄位只有必要的才是必填；拍照位置這類個人資料預設不寫。
- 讀的人略過不認得的欄位、`type` 和詞彙。

## 用法

```bash
npm install @climbio/format
```

```js
import { validate, SCHEMA } from '@climbio/format';   // require('@climbio/format') 也可以
const errors = validate(doc);                          // [] 就是合格；否則每項是「欄位路徑：原因」
```

不用打包工具：瀏覽器 `<script src="format.js">`，掛在全域 `ClimbioFormat`。其他語言直接拿 `climbio.schema.json` 給自己的 JSON Schema 函式庫用；Schema 表達不了的檢查（見「驗證」）要自己做。

## 三種檔案

| `kind` | 內容 |
|---|---|
| `view` 畫面 | 一個可以標註的平面：照片、向量圖或地圖，加上畫在上面的標註 |
| `layer` 圖層 | 疊在某個畫面上的節點和標註，座標用那個畫面的 |
| `set` 組合 | 把畫面、圖層、組合放在一起，可以再組合；組合自己也可以有節點 |

### 共用欄位

| 欄位 | 內容 |
|---|---|
| `climbio` | 格式版本 `2`。不認得的版本不收；只有核心結構改了才升版 |
| `kind` | `view`、`layer`、`set` |
| `id` | 檔案 id，見「id」 |
| `name` | 名稱：字串，或語言代碼 → 字串（`{ "zh-Hant": "後門", "en": "Back Door" }`），可以沒有 |
| `t` | 最後修改時間（毫秒） |
| `license` | 授權，SPDX 寫法；Climbio 的公開內容一律 `CC-BY-SA-4.0` |
| `attribution`、`author` | 署名、作者 |
| `source` | 資料從哪裡來：`{ url, version? }` |
| `derivedFrom` | 改編自哪一份：`{ url, id?, t? }`；原創就不寫 |
| `props` | 這個檔案的其他資料（詞彙） |
| `nodes` | 節點 |

### 畫面 `kind: "view"`

| 欄位 | 內容 |
|---|---|
| `surface` | `photo` 照片、`drawing` 向量圖、`map` 地圖 |
| `attribution` | 必填：畫面（照片、圖）的署名 |
| `origin` | 必填：`self`（自己的）或 `authorized`（有權利人的授權）。紙本導覽頁、來源不明的照片與它們的衍生作品不出裝置，所以沒有這兩種值；照著 Google 衛星圖或別人的導覽圖描出來的也一樣 |
| `marks` | 標註 |

| `surface` | 座標 | 欄位 |
|---|---|---|
| `photo` | 照片像素，左上角是 `(0, 0)` | `href`、`w`、`h`、`mime`（`image/jpeg`、`image/png`、`image/webp`）必填；`sha256`、`camera` 可以沒有 |
| `drawing` | 圖自己的座標，`w`、`h` 跟 SVG 的 viewBox 一樣 | `w`、`h` 必填；底圖 `href`、`mime`（加上 `image/svg+xml`）、`sha256` 可以沒有，沒有底圖就全靠標註畫 |
| `map` | 經緯度（WGS84），**經度在前** | 不附底圖，讀的人用自己的地圖 |

- `href`：相對路徑（跟這份 JSON 放在同一個資料夾或 ZIP 裡；不能以 `/` 開頭、不能有 `..`）或 `https://` 網址。實際圖檔大小不同（例如縮過）時，讀的人按比例換算座標。
- `sha256`：圖檔的 SHA-256（小寫十六進位）。讀的人用它檢查下載的檔案，也用它認出兩個畫面是同一張照片。
- 照片檔本身不帶 EXIF。拍照資料要公開就寫在 `camera`，跟其他內容一樣依 `license` 公開，所以只在作者同意公開拍照位置與方向時才寫：

```json
"camera": { "position": [121.9232, 25.1041, 12], "accuracy": 5, "heading": 312, "pitch": 8,
            "t": 1761620000000, "focal": 26, "model": "iPhone 15" }
```

| `camera` | 內容 |
|---|---|
| `position` | 必填：`[經度, 緯度]` 或 `[經度, 緯度, 高度（公尺）]` |
| `accuracy` | 水平誤差（公尺） |
| `heading` | 鏡頭朝向：從正北順時針，`0` 以上、小於 `360` |
| `pitch` | 俯仰：水平為 `0`，往上為正，`-90` 到 `90` |
| `t` | 拍攝時間（毫秒） |
| `focal` | 等效 35mm 焦距（公釐） |
| `model` | 相機或手機型號 |

### 圖層 `kind: "layer"`

| 欄位 | 內容 |
|---|---|
| `on` | 必填：疊在哪個畫面上（畫面的 `id`） |
| `href` | 那個畫面在哪裡（相對路徑或網址），可以沒有 |
| `marks` | 標註，座標用 `on` 那個畫面的 |

圖層裡的本地 id 如果不在圖層自己的 `nodes` 裡，指的是底下那個畫面的節點。所以路線圖層可以直接寫畫面上的岩點 id。

### 組合 `kind: "set"`

| 欄位 | 內容 |
|---|---|
| `type` | 這是什麼組合（自由字串，例如 `gym`、`area`、`guidebook`、`site`、`directory`） |
| `items` | `{ href, id?, name?, t? }`：放進來的畫面、圖層或組合 |

## 節點與標註

**節點**是任何東西：路線、岩點、bolt、岩壁、分區、岩場、岩館……

```json
{ "id": "tdebo72up4xx11pe", "type": "route", "parent": "s0d2kq8mxv71ph3a", "name": { "zh-Hant": "Z字" },
  "props": { "code": "longdong/jag38d", "grade": { "yds": "5.11a" }, "style": "sport" } }
```

| 欄位 | 內容 |
|---|---|
| `id` | 必填，見「id」 |
| `type` | 自由字串（詞彙） |
| `name` | 名稱 |
| `parent` | 上層節點：這個檔案的 id、全域 id，或「檔案id#節點id」。層數不限，不能繞回自己 |
| `geo` | 地理位置：GeoJSON 幾何，經緯度 |
| `author`、`t`、`license` | 寫在節點上的優先於檔案的 |
| `props` | 其他資料（詞彙） |

**標註**是畫在畫面上的一個形狀：`{ node?, geometry, props? }`。

- `geometry` 是 GeoJSON 的幾何寫法：`Point`、`MultiPoint`、`LineString`、`MultiLineString`、`Polygon`、`MultiPolygon`。座標用畫面的座標系。
- 多邊形的第一點和最後一點要相同（跟 GeoJSON 一樣）。
- `node` 是這個檔案的節點 id，或直接寫全域 id（不用為了引用再寫一份節點）。

地圖畫面的標註就是 GeoJSON 的 Feature，GIS 軟體和地圖函式庫可以直接用。

## id

| 種類 | 規則 |
|---|---|
| 檔案 id（畫面、圖層、組合） | 隨機產生，`[0-9a-z]` 至少 12 碼；**新產生的用 16 碼**。不需要任何人登記；16 碼就算有一億個檔案，撞號機率也只有十億分之一左右 |
| 全域節點 id（跨檔案共用，例如岩場站的路線） | 跟檔案 id 同樣的規則 |
| 本地節點 id（只在一個檔案裡，例如岩點、bolt） | `[0-9a-z][0-9a-z_-]*`，檔案內唯一。從外面引用寫「檔案id#節點id」 |

- 只用小寫：id 常拿來當檔名，有些檔案系統不分大小寫。
- 好讀的代號（例如 `longdong/jag38d`）放 `props.code`，不當 id：短名稱沒有人登記就不保證唯一，網域會搬家。
- id 一樣但來源不同（作者、`source` 不同）時，不覆蓋，各存一份。

## 合併

- 同一個檔案 id 就是同一份；同一個全域節點 id 就是同一個東西，資料以 `t` 較新的為準。
- 圖層疊在畫面上：畫面的節點加上圖層的節點。同一個畫面可以有很多圖層（每個人的路線、每個版本的 Topo）。
- 收下就存成自己的一份，之後不回頭查。

## 驗證

`validate` 先照 Schema 檢查，合格再檢查 Schema 表達不了的：

- 節點 id 不重複；`parent` 找得到（或是全域 id）、不繞回自己。
- 畫面的標註指向的節點存在（或是全域 id）。
- 座標在畫面範圍內（地圖、節點的 `geo`、`camera` 在經緯度範圍內）；多邊形封閉。
- 常用詞彙：路線的 `holds` 角色、`holds` 在畫面上找得到、`seq` 是這條路線的岩點；`props.crop` 不超出畫面。
- 組合不放自己、圖層不疊在自己上面。

收別人的檔案時另外做：只收 `https`；圖檔下載後檢查大小、類型（和 `sha256`，有的話）；不顯示對方的任何 HTML；SVG 底圖當圖片顯示，不嵌進頁面。

## 放在哪裡

- **靜態網址**：`GET` 不用登入、回 `Access-Control-Allow-Origin: *`；圖檔網址也一樣。
- **資料夾／ZIP**：JSON 和圖檔放在一起，`href` 用相對路徑；整個資料夾放上任何靜態網站，或打包成 ZIP 傳給別人都能讀。

## 樣本

| 檔案 | 內容 |
|---|---|
| `examples/wall.json` | 室內畫面：Climbio 示範牆的照片和 94 顆岩點（固定） |
| `examples/wall-routes.json` | 疊在示範牆上的圖層：兩條路線（常變更） |
| `examples/topo.json` | 戶外畫面：龍洞騙人的牆的照片，只有照片和顯示範圍 |
| `examples/topo-routes.json` | 疊在騙人的牆上的圖層：路線線段和 bolt，直接指向全域路線 id |
| `examples/map.json` | 地圖畫面：龍洞校門口各分區的岩壁線 |
| `examples/set.json` | 組合：校門口，包含上面三個戶外檔案，加上岩場、分區、路線的節點 |

照片與資料的授權見各檔案的 `license`、`attribution`：示範牆照片 Climbio、騙人的牆照片 KK、路線與岩壁線臺灣戶外攀岩協會（TOCC）固定點更新計畫，都是 CC BY-SA 4.0。

## 授權

Apache-2.0（見 LICENSE）。樣本裡的照片不在本資料夾，各自依檔案裡的授權。
