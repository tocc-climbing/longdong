# 詞彙

節點的 `type` 和 `props`、檔案與標註的 `props` 常用的寫法。詞彙是約定，不是格式本身：新增詞彙不改規格、不升版本，讀的人略過不認得的。同一件事請用這裡已有的詞，沒有就自己加（各站自己的資料用 `站名:欄位`，例如 `longdong:safety`），用的人多了再收進來。

## `type`

| 值 | 意思 |
|---|---|
| `area`、`crag`、`sector`、`wall` | 區域、岩場、分區、岩壁（戶外常見的層，不限定順序和層數） |
| `gym`、`room` | 岩館、岩館裡的區域 |
| `route` | 路線（抱石題、運動攀登、傳統攀登……） |
| `pitch` | 繩距（上層是一條路線） |
| `hold` | 岩點 |
| `bolt`、`anchor` | bolt、確保站 |
| `ascent` | 一次攀爬紀錄（通常不公開） |
| `poi` | 地圖上的其他地點，用 `props.kind` 分：`parking`、`toilet`、`rescue`、`trailhead`…… |

## 路線

| `props` | 內容 |
|---|---|
| `code` | 好讀的代號，例如 `longdong/jag38d` |
| `grade` | `{ 系統: 值 }`，可以同時寫多個：`yds`（5.11a）、`french`（6c）、`uiaa`、`british`、`v`（V3）、`font`（6A）；岩館自訂的用岩館自己的系統名稱，例如 `{"市民抱石": "藍"}` |
| `style` | `boulder`、`sport`、`trad`、`toprope`、`mixed`、`aid`、`ice`、`dws` |
| `length` | 長度（公尺） |
| `pitches` | 繩距數 |
| `holds` | 岩點 id → 角色：`s` 起攀、`h` 手點、`f` 腳點、`t` 完攀 |
| `seq` | 出手順序（岩點 id 陣列） |
| `setter`、`fa` | 定線者、首攀 |
| `set`、`removed` | 上線日、拆線日（`YYYY-MM-DD`） |
| `status` | `open`、`closed`、`removed` |
| `description` | 說明（字串或多語物件） |

## 岩點

| `props` | 內容 |
|---|---|
| `source` | `detect`（自動偵測）、`edited`（偵測後改過）、`manual`（手畫） |

## 岩壁、地點

| `props` | 內容 |
|---|---|
| `code` | 好讀的代號 |
| `aspect` | 岩壁朝向（度，從正北順時針） |

## 攀爬紀錄

| `props` | 內容 |
|---|---|
| `route` | 爬的路線（全域 id 或「檔案id#節點id」） |
| `date` | `YYYY-MM-DD` |
| `style` | `onsight`、`flash`、`redpoint`、`send`、`attempt`、`toprope` |
| `note` | 筆記 |

## 畫面

| `props` | 內容 |
|---|---|
| `crop` | 顯示的範圍 `{ x, y, w, h }`（畫面座標）；標註的座標不受影響 |
| `anchors` | 對位點：`[{ "at": [x, y], "geo": [經度, 緯度] }]`，把照片或向量圖放回地圖上 |
| `basemap` | 地圖畫面建議的底圖（說明文字或網址） |

## 標註

| `props` | 內容 |
|---|---|
| `style` | 畫法：`stroke`（顏色）、`width`、`dash`、`fill`、`icon` |
| `label` | 顯示的文字 |
