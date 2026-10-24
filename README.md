# 龍洞攀岩資料庫

**👉 網站：https://longdong.web.app/**（開發版：https://longdong-dev.web.app/）

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
網站（Firebase Hosting，https://longdong.web.app/）
   │  Service Worker 預先快取 App 與完整資料
   ▼
手機：離線瀏覽、搜尋
```

- 路線資料是靜態檔案，不經過資料庫；評分、留言、暱稱、個人紀錄的雲端同步、地圖回報存在 Firebase Realtime Database（見「帳號、紀錄與社群功能」）。
- `.github/workflows/sync.yml` 每天台灣時間 03:00 匯入；資料有變動就開（或更新）`data-sync` 分支的 PR，合併後直接更新正式站與開發站。也可以在 Actions 頁面手動執行。
- `.github/workflows/ci.yml` 是 PR 的必要檢查；`.github/workflows/deploy.yml` 部署開發站與正式站（見「部署」）。
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
- **路線清單**（「我的 → 路線清單」，`/checklist`，`src/pages/ChecklistPage.tsx`）：像指南書最後的路線表，依區域、分區列出全部路線，每條直接點選最佳攀登方式（OS／FL／RP／TR，不記日期）與星等評分。最佳攀登方式每條路線一筆（`best`，本機 IndexedDB 版本 2 新增，雲端 `v2/personal/<uid>/best/<路線 key>`）；完攀路線數、難度金字塔、路線清單上的完攀標記都會算進去。
- 評分、留言、暱稱以 REST 讀取（不需載入 Firebase SDK），Service Worker 快取最後一次讀到的內容；寫入需登入（`src/social/`）。
- Firebase SDK 只在登入過的裝置載入。
- 舊站的節點（`comments`、`tags`、`topos`、`tests`、`tasks`、`routes`）保留為公開唯讀。
- 管理員（`role` 底下的帳號）只能從網頁端讀取檢舉，不能讀寫別人的私人資料；審核（例如隱藏不當留言，設 `hidden: true`）在 Firebase 主控台進行，主控台不受規則限制。
- 規則測試：`npm run test:rules`（在 Database 模擬器上跑 `tests/rules/`，需要 Java；CI 也會跑）。

## 開發

需要 Node.js 24.12 以上（CI 使用 `.nvmrc` 指定的 24）。

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

網站在 Firebase Hosting，開發版與正式版分開（`.github/workflows/deploy.yml`）：

| 分支 | 網站 | 何時更新 |
|---|---|---|
| `main` | 開發站（站台 `longdong-dev`，https://longdong-dev.web.app/） | PR 合併後自動部署 |
| `release` | 正式站（站台 `longdong`，https://longdong.web.app/） | 發布時 |

- **發布**：在開發站確認後，把 `release` 快轉到 `main` 的同一個 commit（`git push origin main:release`，只能快轉）。部署後自動打上版號標籤（例如 `v1.0.98`），開發站與正式站同一個 commit 的版號相同。
- **路線資料不等發布**：路線資料（`public/data`，每日同步 PR）合併到 `main` 後，正式站也直接更新——用 `release` 的程式加上 `main` 的最新資料建置。資料要先通過正式版程式的資料格式驗證（`scripts/validate-data.ts`），對不上（例如 `main` 改了資料格式）就不更新正式站並顯示警告，等發布時一起上線。
- **開發站的標示**：建置時 `VITE_CHANNEL=dev`，品牌名稱旁顯示「開發版」，安裝後的名稱是「龍洞開發版」，並加上 `noindex` 不讓搜尋引擎收錄。開發站與正式站**共用同一個資料庫**：在開發站的紀錄、評分、回報都是真的資料；資料庫規則或資料格式的改動先用本機模擬器驗證（`npm run test:e2e`、`npm run test:rules`）。
- `main` 受保護，改動經由 PR 合併，流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。`release` 也受保護（ruleset「release 保護」）：只能快轉，不能強制推送或刪除。

- 部署金鑰：Firebase 服務帳號的金鑰存在 repo 的 Secrets（`FIREBASE_SERVICE_ACCOUNT_PROJECT_2803619783974357321`），由專案管理者以 `firebase init hosting:github` 建立。
- 快取：`firebase.json` 設定 `assets/`（檔名含雜湊）可長期快取；頁面（`/`、`/area/…`、`/route/…` 等不帶副檔名的網址，以 `regex` 列出）、HTML、JSON、Service Worker 每次都向伺服器確認，新版上線後不會拿到舊頁面、找不到已刪除的舊檔案。

**版號**是「主.次.提交數」（例如 `1.0.65 (0968ddc)`），建置時自動產生（`scripts/lib/appVersion.ts`）：主、次版號寫在 `package.json`，大改版時手動調；最後一碼是 commit 的提交數，main 每合併一個 PR 自動加一；發布是把 `release` 快轉到同一個 commit，所以正式站的版號就是開發站上確認過的那一版。
版號顯示在關於頁、「我的 → 設定」最下方，以及「有新版本」的提示（讀 `version.json`，不在離線快取裡）。版號需要完整的 git 歷史，workflow 的 checkout 都設了 `fetch-depth: 0`。

網址不帶 `#`（`/area/…`、`/route/…`、`/map`）：`firebase.json` 把所有路徑交給 `index.html`，站內連結由 `src/router.ts` 換頁。

分享路線的網址就是路線頁（`/route/<路線ID>`）：`npm run build` 最後替每條路線產生 `dist/route/<路線ID>.html`（`scripts/gen-share-pages.ts`），內容是 `index.html` 換上這條路線的預覽資訊，Facebook、LINE 的預覽卡片才看得到路線；`firebase.json` 的 `cleanUrls` 讓網址不帶 `.html`。頁面裡的完整網址來自 `scripts/sheet.config.ts` 的 `SITE_URL`，換網域時要一併修改。

## 介面語言

中文、English、日本語。預設依系統語言，可在「我的」設定切換。語言包分開打包（`src/i18n/<語言>.ts`），只載入目前使用的那一個；關於頁的長篇說明也依語言分檔（`src/pages/about/`）。

- 新增語言：見 `src/i18n/index.ts` 開頭的說明；新語言包的型別為 `Messages`，key 和中文不一致時型別檢查會失敗
- 用詞：區域（area）、分區（sector）；按鈕、標題與單句訊息不加句號，兩句以上的說明才加
- `npm run check:text`：用瀏覽器打開各語言 × 手機與電腦寬度 × 主要頁面，檢查文字有沒有超出元件或把按鈕擠成兩行

## 救援資訊

首頁與各區域頁的「救援」按鈕進入救援資訊（`/rescue`、`/rescue/<大區域>`）：緊急電話、通報群組、救援地圖、我的位置、救援點 GPS 座標、急救器材位置，全部在離線快取裡。資料來自 [TOCC 龍洞岩場救援計畫](https://www.tocc-climbing.org/ems-project)，寫在 `src/data/rescue.ts`。

- **救援地圖**用下面的比例尺地圖（`src/map/RescueMap.tsx`），不再放救援資訊圖的圖片：從區域頁進來時聚焦在該區與就近救援點（其他區域變淡）；點地圖上的救援點、或清單的「看地圖」，地圖下方顯示座標（可複製、開 Google 地圖）。地圖的聚焦、選中、點救援點由 `ScaleMap` 的 `focus`、`selected`、`onPointPress` 控制。
- **我的位置**用手機 GPS 取得目前座標（可複製唸給 119），並列出最近的救援點、距離與方位（`src/geo.ts`）；地圖上同時標出目前位置。GPS 不需要網路。

### 比例尺地圖（測試中）

救援資訊圖是示意圖，不是照比例尺畫的：以救援點比對，整張圖最多偏約 60 公尺，所以不能直接在上面畫 GPS 位置。
`npm run scale-map -- <救援資訊圖.ai>` 讀出圖上的向量圖形（陸地、建物、道路、步道、9 個大區域），以救援點當控制點、用薄板樣條拉到實際位置，產生：

- `public/rescue/scale-map.geojson`：陸地、建物、道路、步道，以及停車場、急救器材、船艇接駁點、直升機吊掛點、危險地形、圖上的文字（地名、道路、步道、海面、海巡署；中英日三種語言，依原圖分顏色，寫在 `scripts/gen-scale-map.ts` 的 `PLACES`，產生時檢查原圖該位置有同顏色的文字）
- `public/rescue/areas.geojson`：9 個大區域的範圍（之後也可用在路線分區的介面）

**校正來源**：控制點是 13 個救援點（完全通過）。另外用 OpenStreetMap 校正岩場以外的地方，以參考點的方式加入，允許一點偏差：
- 12 個對應點：隧道兩端、3 個停車場、台二線的轉彎
- 沿台二線與海岸線（南邊海灣、北邊漁港）自動對應的取樣點

OpenStreetMap 的資料存在 `scripts/data/osm-reference.json`（© OpenStreetMap contributors，ODbL），地圖右上會標示出處。成果用內政部國土測繪中心的正射影像目視核對過；影像只用來核對，沒有從影像取資料。

控制點上完全吻合，控制點之間可能還有幾十公尺的誤差。底部分頁的「地圖」（`/map`）顯示這張圖，操作像 Google 地圖（拖曳、雙指縮放與旋轉、羅盤回到北方朝上），打開就開始定位；
第一次使用會說明地圖還在校正、可能有誤差。左上「回報」依目前位置列出附近的區域、救援點與標示（`src/map/reportOptions.ts`）；網頁在背景或螢幕關閉時無法定位，所以不記錄軌跡。
記錄先存在手機上，連上網路時在背景自動上傳（`src/map/calibration.ts`，不必停在地圖頁）：登入的上傳到 `v2/calibration/<uid>`（本人與管理員讀得到），沒登入的上傳到 `v2/anonReports/<裝置代號>`（只有管理員讀得到）。管理員（`/role` 名單）在「我的 → 設定」有「回報紀錄」（`/reports`），地圖上標出所有人的回報、下面依使用者列出說明、座標、誤差與時間。校正點加進 `scripts/gen-scale-map.ts` 的 `FIELD_POINTS` 後重跑即可。

## 舊網址

- `longdong.climbio.org`（CNAME 指向 `longdong.firebaseapp.com`）：在 Firebase Console 的 Hosting 網域設定 301 轉到 longdong.web.app（保留路徑）。
- 舊的 `#/…` 網址、`?route=` 分享連結、早期的路線 ID 已不再支援（2026-10-18 移除）。

## 授權

- 程式碼：[MIT](LICENSE)
- TOCC 標誌與由其產生的 App 圖示（`assets/`、`public/icons/`）：屬臺灣戶外攀岩協會所有，不適用 MIT
- 龍洞岩場救援資訊圖、由其產生的地圖資料（`public/rescue/`）、救援資訊（`src/data/rescue.ts`）：來自 TOCC 龍洞岩場救援計畫，屬臺灣戶外攀岩協會所有，不適用 MIT
- 比例尺地圖的道路與海岸校正參考（`scripts/data/osm-reference.json`）：© OpenStreetMap contributors，[ODbL](https://opendatacommons.org/licenses/odbl/)
- 路線資料（`public/data/`）：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，© 臺灣戶外攀岩協會（TOCC）固定點更新計畫
