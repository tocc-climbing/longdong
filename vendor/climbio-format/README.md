# Climbio 公開格式（v2）

可分享的攀岩內容用的 JSON 格式：室內的牆面（照片、岩點、路線）和戶外的 Topo（岩壁照片上的路線線段、bolt）。任何 App 只照這份說明和 `climbio.schema.json` 就能讀、能寫，不需要 Climbio 的伺服器、帳號或 Firebase。

這個資料夾是 npm 套件 `@climbio/format`：JSON Schema（draft 2020-12）、驗證器、兩份樣本，沒有相依套件、沒有建置步驟。

> Climbio App 目前分享出去的仍是 v1（[docs/route-format.md](../docs/route-format.md)），之後改成輸出 v2。

## 用法

```bash
npm install @climbio/format
```

```js
import { validate, SCHEMA } from '@climbio/format';   // require('@climbio/format') 也可以
const errors = validate(doc);                          // [] 就是合格；否則每項是「欄位路徑：原因」
```

不用打包工具：瀏覽器 `<script src="format.js">`，掛在全域 `ClimbioFormat`。其他語言直接拿 `climbio.schema.json` 給自己的 JSON Schema 函式庫用；Schema 表達不了的檢查（見「驗證」）要自己做。

## 共用欄位

```json
{
  "climbio": 2, "kind": "wall", "id": "climbiodemo1", "name": "Climbio 示範牆",
  "author": "Climbio", "license": "CC-BY-SA-4.0", "t": 1790000000000,
  "photo": { "href": "photo.jpg", "w": 1379, "h": 2048, "mime": "image/jpeg", "sha256": "…",
             "license": "CC-BY-SA-4.0", "attribution": "Climbio", "origin": "self" }
}
```

| 欄位 | 內容 |
|---|---|
| `climbio` | 格式版本 `2`。不認得的版本不收；欄位意義或結構改了才升版 |
| `kind` | `wall`（室內）或 `topo`（戶外） |
| `id`、`name` | 見各自的說明 |
| `author` | 署名（可以沒有） |
| `license` | 這份標註的授權，用 SPDX 寫法；Climbio 的公開內容一律 `CC-BY-SA-4.0` |
| `t` | 最後修改時間（毫秒） |
| `derivedFrom` | 改編自哪一份：`{ url, id?, t? }`；原創就不寫 |
| `photo` | 照片，見下表 |

讀的人略過不認得的欄位。

### 照片 `photo`

| 欄位 | 內容 |
|---|---|
| `href` | 相對路徑（跟這份 JSON 放在同一個資料夾或 ZIP 裡，例如 `photo.jpg`、`media/a.jpg`；不能以 `/` 開頭、不能有 `..`）或 `https://` 網址 |
| `w`、`h` | 照片寬、高（像素）。所有標註的座標都以這個大小為準 |
| `mime` | `image/jpeg`、`image/png`、`image/webp` |
| `sha256` | 照片檔的 SHA-256（小寫十六進位），可以沒有；有的話讀的人用它檢查下載的檔案 |
| `license`、`attribution` | 照片的授權（SPDX）與署名，跟標註的授權分開寫 |
| `origin` | `self`（自己拍的）或 `authorized`（有權利人的授權）。紙本導覽頁、來源不明的照片與它們的衍生作品不出裝置，所以沒有這兩種值 |
| `camera` | 拍照資料，見下表；可以沒有 |

照片檔本身不帶 EXIF。拍照資料要公開就寫在 `camera`，跟標註一樣依 `license` 公開，所以只在作者同意公開拍照位置與方向時才寫。

#### 拍照資料 `photo.camera`

```json
"camera": { "position": [121.9232, 25.1041, 12], "accuracy": 5, "heading": 312, "pitch": 8,
            "t": 1761620000000, "focal": 26, "model": "iPhone 15" }
```

| 欄位 | 內容 |
|---|---|
| `position` | 拍照位置：GeoJSON 座標 `[經度, 緯度]` 或 `[經度, 緯度, 高度]`（WGS84，高度單位公尺）。必填 |
| `accuracy` | 水平誤差（公尺） |
| `heading` | 鏡頭朝向：從正北順時針的角度，`0` 以上、小於 `360` |
| `pitch` | 俯仰：水平為 `0`，往上為正，`-90` 到 `90` |
| `t` | 拍攝時間（毫秒） |
| `focal` | 等效 35mm 焦距（公釐） |
| `model` | 相機或手機型號 |

## 座標

- **照片上的標註**：照片像素，左上角是 `(0, 0)`，以 `photo.w`、`photo.h` 為準；小數可以有。實際圖檔大小不同（例如縮過）時，讀的人按比例換算。內部用比例或萬分比的 App，匯出時乘上 `w`、`h`。
- **地理位置**：GeoJSON（RFC 7946），**經度在前**。
- 兩種座標分開放，不混用。

## 室內：`kind: "wall"`

一面牆的照片、岩點和路線。`route.json`（一條路線的分享）也是這個格式，`routes` 只放那一條。

| 欄位 | 內容 |
|---|---|
| `id` | 照片編號（`[0-9a-z]{8,40}`）：同一張照片在每個站、每支手機都是同一個 id，收到時有這面牆就只加路線 |
| `gym` | 岩館（可以沒有） |
| `thumb` | 縮圖（`data:image/…` 網址，長邊 480），可以是空字串 |
| `holds` | 岩點：`{ id, poly: [[x, y], …], source?, t? }`，`poly` 至少 3 點；`source` 是 `detect`（自動偵測）、`edited`（偵測後改過）、`manual`（手畫）。同 holdkit 的岩點資料包 |
| `routes` | 路線，見下表 |

| 路線欄位 | 內容 |
|---|---|
| `id` | `[0-9a-z]{1,40}`，牆內唯一 |
| `holds` | 岩點 id → 角色：`s` 起攀、`h` 手點、`f` 腳點、`t` 完攀，至少一顆 |
| `seq` | 出手順序（岩點 id 陣列），可以沒有 |
| `shapes` | 路線自帶的岩點外框（岩點 id → 岩點）：牆上沒有那顆岩點也畫得出來 |
| `name`、`grade`、`author`、`t` | 名稱、難度、定線者、修改時間 |

## 戶外：`kind: "topo"`

一張岩壁照片上的路線線段和 bolt 位置。路線本身的資料（名稱、難度、bolt 清單、安全資訊）由岩場站管理，Topo 用岩場站的路線 id 引用，另外帶一份顯示用的名稱和難度。

```json
{
  "climbio": 2, "kind": "topo", "id": "-P4xMGWX39F7Iokg754u", "name": "騙人的牆",
  "author": "KK", "license": "CC-BY-SA-4.0", "t": 1761620000000,
  "source": { "url": "https://longdong.web.app/data/longdong.json", "version": "f8e35c2a05d5" },
  "sector": "longdong/school-gate-4wnzar",
  "photo": { "href": "photo.webp", "w": 2560, "h": 1711, "mime": "image/webp", "license": "CC-BY-SA-4.0", "attribution": "KK", "origin": "self" },
  "crop": { "x": 557, "y": 0, "w": 1389, "h": 1276 },
  "routes": {
    "longdong/jag38d": { "name": "Z字", "grade": "5.11a", "line": [[1512, 1125], [1580, 845]], "bolts": { "B01": [1529, 841] } }
  },
  "geo": { "wall": { "type": "LineString", "coordinates": [[121.9231, 25.1043], [121.923, 25.1044]] } }
}
```

| 欄位 | 內容 |
|---|---|
| `id` | 照片的 id（岩場站自己定，不能是空字串） |
| `source` | 路線資料從哪裡來：`{ url, version? }`，可以沒有（全是個人路線時） |
| `sector` | 岩場站的分區 id（可以沒有） |
| `crop` | 顯示照片的哪一塊（像素）；標註的座標不受影響，沒有就是整張 |
| `routes` | 路線 id → `{ name?, grade?, line?, bolts? }`。有來源的路線用岩場站的 id（例如 `longdong/jag38d`）；個人路線用自己的亂數 id。`line` 至少 2 點，第一點是起攀點；`bolts` 是 bolt 代號（`B01`、`A01`…，跟來源資料一樣）→ 位置 |
| `geo.wall` | 牆底折線：GeoJSON 的 `LineString` 或 `MultiLineString`（可以沒有） |

## 驗證

`validate` 先照 Schema 檢查，合格再檢查 Schema 表達不了的：

- 室內：岩點 id、路線 id 不重複；路線的 `holds` 在 `holds` 或這條路線的 `shapes` 裡；`seq` 都是這條路線的岩點。
- 座標（岩點外框、路線外框、線段、bolt）都在照片範圍內；`crop` 不超出照片。
- `photo.camera.position` 的經度在 ±180、緯度在 ±90 以內。

收別人的檔案時另外做：只收 `https`；照片下載後檢查大小、類型（和 `sha256`，有的話）；不顯示對方的任何 HTML。

## 放在哪裡、怎麼讀

- **靜態網址**：`GET` 不用登入、回 `Access-Control-Allow-Origin: *`；照片網址也一樣。
- **資料夾／ZIP**：JSON 和照片放在一起，`photo.href` 用相對路徑；整個資料夾放上任何靜態網站，或打包成 ZIP 傳給別人都能讀。
- 收下就存成自己的一份，之後不回頭查。

## 樣本

- `examples/wall.json`：Climbio 示範牆（照片：Climbio，CC BY-SA 4.0）。
- `examples/topo.json`：龍洞騙人的牆的 Topo，路線 id 和名稱來自龍洞攀岩資料庫（TOCC，CC BY-SA 4.0）（照片：KK，CC BY-SA 4.0）。

## 授權

Apache-2.0（見 LICENSE）。樣本裡的照片不在本資料夾，各自依檔案裡 `photo` 的授權。
