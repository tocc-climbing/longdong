# 龍洞攀岩資料庫

**👉 網站：https://tocc-climbing.github.io/longdong/**

龍洞攀岩路線與 Bolt 資訊的離線優先 Web App（PWA）。龍洞很多岩場沒有手機訊號，所以 App 和全部路線資料會在第一次開啟時存到手機上，之後不用網路也能查詢。

路線與 Bolt 資料由 [臺灣戶外攀岩協會（TOCC）固定點更新計畫](https://www.tocc-climbing.org/rebolting-project) 維護於 [Google Sheet](https://docs.google.com/spreadsheets/d/1QHFNQSPgKgQrTNnYn246wfotOYqOkzHjLltZ26keBgg/edit)，每天自動檢查並開成同步 PR，確認後上線。

> 資料僅供參考。岩壁與固定點狀況隨時可能改變，攀登前請自行檢查現場。

## 架構

```
Google Sheet（TOCC 固定點更新計畫編輯）
   │  scripts/import-sheet.ts：下載各區域分頁 CSV → 解析 → schema 驗證
   ▼
public/data/longdong.json（commit 進 repo，每次變動都有 diff 可查）
   │  vite build + vite-plugin-pwa
   ▼
靜態網站（GitHub Pages）
   │  Service Worker 預先快取 App 與完整資料
   ▼
手機：離線瀏覽、搜尋
```

- 沒有後端、沒有資料庫，只有靜態檔案。
- `.github/workflows/sync.yml` 每天台灣時間 03:00 匯入；資料有變動就開（或更新）`data-sync` 分支的 PR，合併後才部署。也可以在 Actions 頁面手動執行。
- `.github/workflows/ci.yml` 是 PR 的必要檢查；`.github/workflows/deploy.yml` 在合併進 `main` 後部署。
- 資料內容沒變時 `version` 和 `updatedAt` 不會改，不會產生多餘的 commit。

## 路線 ID

使用者的收藏與攀登紀錄以路線 ID 指向路線，**ID 發布後不可再改**。

- 路線：`<岩場>/<路線ID>`，例如 `longdong/7kq2mx`。「路線ID」是 Sheet 上的一欄，由 [Apps Script](apps-script/README.md) 自動產生，改名、改編號都不會變。
- 區域：`<岩場>/<區域>`，例如 `longdong/back-door`。
- Sheet 還沒有「路線ID」欄時，暫用路線編號產生（`longdong/523`），資料檔的 `idSource` 為 `legacy`。

匯入程式的防呆（見 `scripts/lib/ids.ts`）：缺 ID、ID 重複、同一條路線的 ID 被改掉，都會停止匯入，網站維持上一版資料。
在 Sheet 刪除路線會自動放行並記在 commit 訊息；一次刪超過 10 條視為誤刪，需在 `scripts/retired-ids.ts` 確認。

## 帳號、紀錄與社群功能

使用舊站的 Firebase 專案（`longdong`），新資料都在 `/v2` 底下，與舊站的路徑分開；規則見 [`firebase/database.rules.json`](firebase/database.rules.json)，以 `firebase deploy --only database` 部署。

| 路徑 | 內容 | 讀取 | 寫入 |
|---|---|---|---|
| `v2/personal/<uid>` | 收藏、攀登紀錄 | 本人 | 本人 |
| `v2/profiles/<uid>` | 暱稱 | 公開 | 本人 |
| `v2/names/<暱稱 key>` | 暱稱登記（不重複；不分大小寫、全形半形與多餘空白視為相同） | 公開 | 本人登記目前的暱稱、釋放自己的 |
| `v2/ratings/<路線>/<uid>` | 1–5 星、體感難度 | 公開 | 本人 |
| `v2/comments/<路線>/<id>` | 留言 | 公開 | 新增：本人；刪除：本人；不可修改 |
| `v2/reports/<id>` | 檢舉 | 管理員 | 登入者新增 |

- 收藏與攀登紀錄需要登入。本機（IndexedDB）是主要資料來源，離線也能記錄；連上雲端時雙向合併，同一筆以 `updatedAt` 較新者為準（`src/personal/`）。登出會清除裝置上的副本。
- 評分、留言、暱稱以 REST 讀取（不需載入 Firebase SDK），Service Worker 快取最後一次讀到的內容；寫入需登入（`src/social/`）。
- Firebase SDK 只在登入過的裝置載入。
- 舊站的節點（`comments`、`tags`、`topos`、`tests`、`tasks`、`routes`）保留為公開唯讀。
- 管理員（`role` 底下的帳號）只能從網頁端讀取檢舉，不能讀寫別人的私人資料；審核（例如隱藏不當留言，設 `hidden: true`）在 Firebase 主控台進行，主控台不受規則限制。
- 規則測試：`npm run test:rules`（在 Database 模擬器上跑 `tests/rules/`，需要 Java；CI 也會跑）。

## 開發

需要 Node.js 20 以上（CI 使用 `.nvmrc` 指定的 22）。

```bash
npm install
npm run dev          # 開發伺服器（Service Worker 只在 build 後啟用）
npm run import       # 從 Google Sheet 重新匯入資料
npm test             # 匯入程式的單元測試
npm run build        # 產出 dist/
npm run preview      # 預覽 build 結果，可測試離線
```

### 目錄

| 路徑 | 內容 |
|---|---|
| `scripts/sheet.config.ts` | Sheet ID 與各區域分頁的 gid |
| `scripts/lib/parse.ts` | Sheet 版面解析（說明見檔案開頭註解） |
| `scripts/lib/normalize.ts` | 文字正規化、日期、難度、狀態對照 |
| `src/data/schema.ts` | 資料格式（zod），匯入時驗證，前端共用型別 |
| `src/search.ts` | 本機全文搜尋（中文以單字＋雙字切詞） |
| `src/pages/` | 首頁、區域、路線、關於 |

### Sheet 版面變動時

匯入程式會在以下情況失敗或提出警告，同步就不會開 PR，網站維持上一版資料：

- 分頁標題和 `sheet.config.ts` 的區域名稱對不上（gid 錯了）
- 找不到必要欄位（欄位被改名）
- 難度無法判讀、路線編號重複
- 輸出不符合 `src/data/schema.ts`

新增區域分頁時，在 `scripts/sheet.config.ts` 的 `AREA_TABS` 加上一筆。

## 開發規範

- [`CONTRIBUTING.md`](CONTRIBUTING.md)：貢獻流程——分支、commit 與 PR、驗證、審查、每日資料同步。
- [`CLAUDE.md`](CLAUDE.md)：開發原則、提交方式與各類改動的驗證清單（也是 Claude Code 在本 repo 的指示）。
- [`docs/review_and_implementation_protocol.md`](docs/review_and_implementation_protocol.md)：審查與實作規範——權責分界、檢查與回報的成立條件、判定順序、審查時機。

## 部署

1. 在 GitHub repo 的 **Settings → Pages** 把 Source 設為 **GitHub Actions**。
2. `main` 受保護，改動經由 PR 合併；合併後自動 build 並部署。流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。

網址用相對路徑、路由用 hash，所以放在 GitHub Pages 子路徑或自訂網域都可以。

**版號**是「主.次.提交數」（例如 `1.0.65 (0968ddc)`），建置時自動產生（`scripts/lib/appVersion.ts`）：主、次版號寫在 `package.json`，大改版時手動調；最後一碼是 commit 的提交數，main 每合併一個 PR 自動加一。
版號顯示在關於頁、「我的 → 設定」最下方，以及「有新版本」的提示（讀 `version.json`，不在離線快取裡）。版號需要完整的 git 歷史，workflow 的 checkout 都設了 `fetch-depth: 0`。

分享路線用的網址是 `route/<路線ID>/`：`npm run build` 最後替每條路線產生一個小頁面（`scripts/gen-share-pages.ts`），帶有這條路線的預覽資訊（Facebook、LINE 的預覽卡片），開啟時轉到 App 的路線頁。頁面裡的完整網址來自 `scripts/sheet.config.ts` 的 `SITE_URL`，換網域時要一併修改。

## 救援資訊

首頁與各區域頁的「救援」按鈕進入救援資訊（`#/rescue`、`#/rescue/<大區域>`）：緊急電話、通報群組、該區的救援局部圖與就近救援點、整張救援資訊圖、救援點 GPS 座標、急救器材位置，全部在離線快取裡。「我的位置」用手機 GPS 取得目前座標（可複製唸給 119），並列出最近的救援點、距離與方位（`src/geo.ts`）；GPS 不需要網路。資料來自 [TOCC 龍洞岩場救援計畫](https://www.tocc-climbing.org/ems-project)，寫在 `src/data/rescue.ts`。

救援資訊圖改版時，用新的 `.ai`（或 `.pdf`）重新產生圖片（需要 Node.js 22 以上）：

```bash
npm run rescue-map -- <救援資訊圖.ai>
```

版面若有變動，腳本會停下來，調整 `scripts/gen-rescue-map.ts` 裡各大區域的裁切範圍；救援點座標改了要一併更新 `src/data/rescue.ts`。

### 比例尺地圖（測試中）

救援資訊圖是示意圖，不是照比例尺畫的：以救援點比對，整張圖最多偏約 60 公尺，所以不能直接在上面畫 GPS 位置。
`npm run scale-map -- <救援資訊圖.ai>` 讀出圖上的向量圖形（陸地、建物、道路、步道、9 個大區域），以救援點當控制點、用薄板樣條拉到實際位置，產生：

- `public/rescue/scale-map.geojson`：陸地、建物、道路、步道，以及停車場、急救器材、船艇接駁點、直升機吊掛點、地名
- `public/rescue/areas.geojson`：9 個大區域的範圍（之後也可用在路線分區的介面）

控制點上完全吻合，控制點之間可能還有幾十公尺的誤差。現場校正頁 `#/calibrate`（沒有放在選單裡）在這張圖上顯示 GPS 位置，可在明確的地點記下座標與說明、記錄步道軌跡，匯出 GeoJSON 傳回；
校正點加進 `scripts/gen-scale-map.ts` 的 `FIELD_POINTS` 後重跑即可。

## 舊網址轉址

舊站 `longdong.web.app` 與 `longdong.climbio.org`（CNAME 指向 `longdong.firebaseapp.com`）都在舊 Firebase 專案的 Hosting 上，
以 `firebase.json` 的 `hosting.redirects` 全部 301 轉到新網址；`firebase/redirect/` 是保底頁面。
Firebase 保留路徑（`/__/auth/handler` 等）不受影響，登入照常運作。修改後以 `firebase deploy --only hosting` 部署。

## 授權

- 程式碼：[MIT](LICENSE)
- TOCC 標誌與由其產生的 App 圖示（`assets/`、`public/icons/`）：屬臺灣戶外攀岩協會所有，不適用 MIT
- 龍洞岩場救援資訊圖與由其產生的圖片（`public/rescue/`）、救援資訊（`src/data/rescue.ts`）：來自 TOCC 龍洞岩場救援計畫，屬臺灣戶外攀岩協會所有，不適用 MIT
- 路線資料（`public/data/`）：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，© 臺灣戶外攀岩協會（TOCC）固定點更新計畫
