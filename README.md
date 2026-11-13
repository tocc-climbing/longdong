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
| `v2/comments/<路線>/<id>` | 留言、回覆（`parent` 指向被回覆的留言，只有一層） | 公開 | 新增：本人；刪除：本人；不可修改 |
| `v2/likes/<路線>/<留言 id>/<uid>` | 對留言按讚（`true`） | 公開 | 本人（留言要存在） |
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

岩場站出口：`npm run build` 最後把路線資料、Topo（照片＋線段）與岩場地圖（底圖、區域、岩壁、地點）輸出成 [Climbio 公開格式 v2](vendor/climbio-format/README.md)，放在 `dist/climbio/`（`scripts/gen-climbio.ts`）。入口是 `/climbio/longdong.json`，不用登入、回 `Access-Control-Allow-Origin: *`；Topo 與地圖是部署當時資料庫的最新版本。為了讓紅點貓用網址一次匯入：Topo 照片長邊縮到 1600（`vendor/climbio-sourcekit`，網站上存的原圖不動）；入口的 `props.preview` 指到 `preview.jpg`（合成預覽圖：入口照片加每張照片的小圖，匯入前先看、下載時小圖一格格亮起），`props.pack` 指到 `pack.json`（入口以外的所有文件合成一個檔，一個請求讀完）。地圖只有龍洞自己產生的，不含 OpenStreetMap 的部分，要不要疊由用的人決定。

## 介面語言

中文、English、日本語。預設依系統語言，可在「我的」設定切換。語言包分開打包（`src/i18n/<語言>.ts`），只載入目前使用的那一個；關於頁的長篇說明也依語言分檔（`src/pages/about/`）。

- 新增語言：見 `src/i18n/index.ts` 開頭的說明；新語言包的型別為 `Messages`，key 和中文不一致時型別檢查會失敗
- 用詞：區域（area）、分區（sector）；按鈕、標題與單句訊息不加句號，兩句以上的說明才加
- `npm run check:text`：用瀏覽器打開各語言 × 手機與電腦寬度 × 主要頁面，檢查文字有沒有超出元件或把按鈕擠成兩行

## 救援資訊

首頁與各區域頁的「救援」按鈕進入救援資訊（`/rescue`、`/rescue/<大區域>`）：緊急電話、通報群組、救援地圖、我的位置、救援點 GPS 座標、急救器材位置，全部在離線快取裡。資料來自 [TOCC 龍洞岩場救援計畫](https://www.tocc-climbing.org/ems-project)，寫在 `src/data/rescue.ts`。

- **救援地圖**在救援頁（`/rescue`）直接顯示，沿用比例尺地圖（`src/map/KitMap.tsx`），標示救援點與急救器材；準確定位在龍洞時聚焦附近，其他情況顯示全區。底部分頁的「地圖」（`/map`）另有位置回報功能。
- **我的位置**用手機 GPS 取得目前座標（可唸給 119），並列出最近的救援點、距離與方位（`src/geo.ts`）；地圖上同時標出目前位置。GPS 不需要網路。

### 比例尺地圖（測試中）

救援資訊圖是示意圖，不是照比例尺畫的：以救援點比對，整張圖最多偏約 60 公尺，所以不能直接在上面畫 GPS 位置。
`npm run scale-map -- <救援資訊圖.ai>` 讀出圖上的向量圖形（陸地、建物、道路），以救援點當控制點、用薄板樣條拉到實際位置，產生：

- `public/rescue/scale-map.geojson`：陸地、建物、道路、步道，以及停車場、急救器材、船艇接駁點、直升機吊掛點、危險地形、圖上的文字（地名、道路、步道、海面、海巡署；中英日三種語言，依原圖分顏色，寫在 `scripts/gen-scale-map.ts` 的 `PLACES`，產生時檢查原圖該位置有同顏色的文字）

大區域範圍、分區岩壁與步道不是產生的，是編輯模式修改後整理成的原始版（之後的修改存在資料庫，見 `src/map/shapes.ts`）：

- `public/rescue/areas.geojson`：9 個大區域的範圍
- `public/rescue/walls.geojson`：各分區的岩壁（沿著牆底的折線）
- 步道：在 `scale-map.geojson` 裡，重新產生時沿用現有的

**校正來源**：控制點是 13 個救援點（完全通過）。另外用 OpenStreetMap 校正岩場以外的地方，以參考點的方式加入，允許一點偏差：
- 12 個對應點：隧道兩端、3 個停車場、台二線的轉彎
- 沿台二線與海岸線（南邊海灣、北邊漁港）自動對應的取樣點

OpenStreetMap 的資料存在 `scripts/data/osm-reference.json`（© OpenStreetMap contributors，ODbL），地圖左下會標示出處。救援資訊圖沒有畫到的地方（到 `src/map/extent.ts` 的資料範圍）直接用 OpenStreetMap 的陸地、建物、道路與步道補上（`scripts/data/osm-extent.json`，`npx tsx scripts/fetch-osm-extent.ts` 下載）。成果用內政部國土測繪中心的正射影像目視核對過；影像只用來核對，沒有從影像取資料。

畫面由 mapkit（`vendor/climbio-mapkit/`，React 外殼在 `src/map/KitMap.tsx`）畫。底圖（陸地、建物、停車場、頁框外 OpenStreetMap 的線、地點）建置時先合併成 `public/rescue/kitbase.json`；上面的 geojson 改了要跑 `npm run kit-base` 重新產生（`npm test` 會檢查是不是最新的）。區域、岩壁與步道由 App 套上編輯模式的最新版本後組上去（`src/map/mapkitView.ts`）。外觀基準：`npm run test:map-shots`。

控制點上完全吻合，控制點之間可能還有幾十公尺的誤差。底部分頁的「地圖」（`/map`）顯示這張圖，操作像 Google 地圖（拖曳、雙指縮放與旋轉、羅盤回到北方朝上），手機打開就開始定位（電腦版不定位）；
第一次使用會說明地圖還在校正、可能有誤差。左上「回報」依目前位置列出附近的區域、救援點與標示（`src/map/reportOptions.ts`）；網頁在背景或螢幕關閉時無法定位，所以不記錄軌跡。
記錄先存在手機上，連上網路時在背景自動上傳（`src/map/calibration.ts`，不必停在地圖頁）：登入的上傳到 `v2/calibration/<uid>`（本人與管理員讀得到），沒登入的上傳到 `v2/anonReports/<裝置代號>`（只有管理員讀得到）。管理員（`/role` 名單）在「我的 → 設定」有「回報紀錄」（`/reports`），地圖上標出所有人的回報、下面依使用者列出說明、座標、誤差與時間。校正點加進 `scripts/gen-scale-map.ts` 的 `FIELD_POINTS` 後重跑即可。

### 立體標題圖（試作）

3D 地圖與 2D 共用地面座標與縮放值，南北畫面長度依傾角縮短；投影後不再額外放大填滿視窗，切換時保留中心與縮放值。預設視野由 `kitbase.props.home` 的平面 `fitRectView` 決定，縮放與移動使用 `clampView`；背景高程資料維持完整裁切。右下縮放／定位沿用 mapkit 樣式，觸控裝置與 2D 同樣隱藏縮放按鈕。危險圖示的驚嘆號使用置中的 SVG 圖形。

互動地圖預設傾角 30°，平地南北長度保留約 87%；雙指同向上下滑調整 0～60°，雙指張合維持縮放。手勢方向鎖定後不互相切換。線段高程只在資料改變時取樣，傾角變更時重投影標示、岩壁與道路；手勢中直接以 WebGL 畫布更新，不逐幀編碼 PNG，結束後才回到高解析靜態影像。航照使用同一傾角，手勢中沿用已載入的全圖圖磚，停止後才更新細圖。`Home` 恢復預設視野與 30°。標題圖維持既有構圖。

色塊模式也保留完整 DTM 範圍的地形影像鋪底，平移不重畫底圖；局部高解析影像完成載入後才移除上一張，避免移動露白或換圖閃爍。兩層共用既有地形資料，不增加地形下載檔案。

九區的遠端坡面以連續距離權重混色，並平滑約 6m 的色階；坡度光照由每個像素的三次內插高程梯度計算，避免粗網格明暗的方塊感，海岸透明遮罩保持原位。步道與隧道虛線先在地面座標分段，再貼地投影，調角時分段位置不變。3D 隧道入口只接合 15m 內既有道路的製圖間隙，2D 共用原始資料保持不變。

3D 與航照可同時開啟：國土測繪中心 PHOTO2 依 WMTS 原始像素對位，使用 CPU 雙精度計算 UV，再貼到相同 DTM 網格；海岸、岩壁與標示共用投影，切換航照不改視野。細圖只載可見地形所需的圖磚，最多 64 張、2048×2048 像素；另以最多 16 張、1024×1024 像素的全圖低解析航照固定鋪底，六路下載；沿用既有航照快取，過期請求會取消，下載失敗顯示錯誤。拖曳中沿用已繪製的影像，停止後再更新；新細圖觸發 load 前保留舊影像，縮小後新露出的範圍由全圖航照補上，航照模式不繪製下方分區色塊。校門口等陸側顯色外框以 12m 過渡接回山坡，西側界線與精細海岸位置不變。

首頁、9 個區域與分區／路線的標題圖使用[內政部地政司 2025 年版 Taiwan DTM 20m](https://data.gov.tw/dataset/176927)，© 內政部地政司，依[政府資料開放授權條款第 1 版](https://data.gov.tw/license)利用。一般地圖可切換 3D；救援地圖沿用平面版。

- `public/rescue/terrain-20m.json`：只裁切龍洞周邊，TWD97 / TM2 121（EPSG:3826）、TWVD2001 高程，量化至 0.1m。原始下載網址、SHA-256 與圖幅編號存在檔頭；原始 ZIP 不放進網站。
- 海陸以區域編輯器同來源的 B5000 海岸線判讀，僅處理其明確涵蓋範圍。原本有效的 DTM 高程全部保留；1,223 個海面缺值以 0m 作為展示基準（不是海底水深），5 個陸上缺值以 80m 內最多 8 個原始實測點及海岸零高程做反距離平方加權內插。連通缺口最多 9 格、長寬各最多 3 格，超過限制或缺乏約束就保留空缺；不以先補出的點繼續外推。
- 補零位置以 `seaRuns` 壓縮記錄，陸上估算位置記在 `interpolated`，海陸分類記在 `waterRuns`，B5000 擷取的海岸多邊形以 0.1m 座標量化記在 `coast`；因此可區分實測與推估，還原原始缺值。`reconstruction` 記錄方法、半徑、海岸來源、來源雜湊與授權。海岸並非由 DTM 推測，也不是示意圖灰色底色；B5000 圖幅測製日期未確認，不宣稱測量級精度。
- 20m 是地形解析度，不是攀岩岩壁模型；不推測岩壁垂直面或懸岩。岩壁線與區界依補值後的網格內插，仍無資料處斷線。座標在龍洞小範圍內以局部仿射轉為既有地圖公尺座標。
- 正投影不誇張高程；單調三次曲面內插保留原始高程點與平台，避免新增超出原始高低界的山峰。共用一個原生 WebGL2 離屏畫布，按螢幕像素細分網格（頂點上限 18 萬）。小圖至少 2 倍超取樣，高密度螢幕最高 3 倍，並以約 160 萬輸出像素限制大圖的記憶體；桌面較寬的圖另提高顯色紋理細節。光照逐像素內插，海岸邊緣按像素抗鋸齒，區域色彩過渡收窄以避免首頁發糊。岩壁線仍由 SVG 畫，每 1m 貼合曲面；地形資料仍是 20m 精度。
- 3D 使用全部區域輪廓與岩壁共同形成的一個連續外框，顯色鋪滿範圍後，由 GPU 在地面座標依獨立約 2m 的 B5000 主岸遮罩裁切，避免粗顯色遮罩露底，以及投影後平面遮罩自交造成缺口；移除灰色背景層，不從 20m 海陸格反推輪廓，岩壁補色帶也不覆蓋海灣；保留熟悉的整張龍洞地圖。各區只以顏色區分，不各自淡出或切成獨立色帶；區域間的連接坡面延續最近岩壁區域的顏色。顯色紋理依目前區域與岩壁資料產生並快取；主岸遮罩用 R8 紋理（約 1.8MB 記憶體）只建立一次，島礁以精細 SVG 獨立著色，既有 2D 資料不變。瀏覽器檢查海岸內的岩壁每 5m 取樣顯色涵蓋率至少 95%（不同圖層有數公尺落差，岸外牆線仍獨立顯示，不據此擴張海岸），共同外框內陸地顯色涵蓋率至少 99%，避免再出現透明斷段。
- 南北端部另外補上與原範圍交疊的海岸延伸，不重新計算全域凸包，保留原本西側邊界。校門口延至北側岬角；後門向南涵蓋小半島，西側不再向海灣外擴，移除後門左上多帶到的細小突出，外緣仍沿 B5000 自然海岸裁切。
- 島礁改取 B5000 的實際獨立輪廓，在原區域輪廓 100m 內保留 20 塊，依最近區域延續顏色，依使用者圈選圖，鐘塔下方外海六塊輪廓歸鐘塔，長巷下方近岸礁歸長巷；明確指定的歸屬不受最近距離分類覆蓋；不再只畫原圖的三塊，也不以描邊挖大水道。島礁以 DTM 投影，20m DTM 無法解析的細部不補造高度。背景地形仍裁切在攀岩範圍內。
- 裁切、海陸補值在建置前處理，平滑地形與光照在瀏覽器首次取景時由 GPU 繪製，輸出為記憶體中的靜態 PNG。相同資料與取景重用上一張影像，只在資料／取景／容器尺寸變化時重繪；沒有持續動畫或大型 3D 引擎。標題圖在裝置無 WebGL2 時改用向量版並標示 `data-renderer="svg"`；互動 3D 地圖顯示載入錯誤，仍可切回 2D。測試明確確認平滑版使用 GPU。
- 海岸重製：`npm run terrain:coast` 下載／重用 `.cache/b5000/` 的 66 張 z18 PNG，保留藍色海岸線，以 4px 半徑（約 2.2m）閉合筆畫線隙、從東側外海填充後，再同尺寸侵蝕還原邊界；沿像素邊緣取環，以最多 2px（約 1.1m）簡化。這是由圖磚擷取的輪廓，並非官方原生向量。`scripts/data/coast-b5000.json` 記錄範圍、方法、授權、每張圖磚 SHA-256 與查閱日期；原圖磚不隨網站發布。`npm run terrain:crop` 再將海岸與高程整合。
- 重製：從 JSON 的 `source` 下載 ZIP 到 `.cache/dtm/new-taipei.zip`，執行 `npm run terrain:crop`；亦可 `python scripts/terrain/crop-dtm.py <ZIP 路徑>`。
- 地圖頁左上「3D」切換可調傾角的地形視圖（`/map?view=3d` 可直接查看）：支援拖曳、雙指／滾輪／按鈕縮放、Home 回到預設視野、分區資料與區域入口。平移／縮放手勢中同步更新 SVG 視窗與圖示的反向縮放，讓圖示、文字、定位點與步道線寬維持螢幕尺寸；停止 120ms 後才重排標示與重繪高解析度影像；回報選點使用平面地圖，航照可疊在 3D 地形上。長巷 3D 統一改用較明亮的藍色 `#287fc0`，包含主岸與指定礁岩，避免原深藍疊上陰影後近似黑塊。既有 2D 配色與資料不變。
- 互動 3D 地圖的頂點上限為 9 萬，標題圖維持 18 萬；放大後依目前視窗重新細分，光照仍逐像素平滑內插。互動圖只編碼東西方向實際顯色帶內的像素，省去兩側透明留白的編碼成本，保留 40m 邊緣餘量以免裁掉顯色暈邊。
- 全圖模式另用 `terrain-map-20m.json`（98,254 bytes，gzip 31,166 bytes），涵蓋原向量圖 `EXTENT_LATLNG`，含龍洞街、和美村、台二線與周邊山坡。以原圖海陸多邊形接上已核對的 B5000 攀岩岸段，不讓背景擴張改動原本九區的顯色範圍；重疊的有效 DTM 實測點保持原值。`npm run terrain:map` 從既有圖資與本機 DTM ZIP 重製，原本標題圖資料不變。
- 一般伺服器模式的效能預算：4 倍 CPU 節流下，全範圍地圖首次顯示 3 秒內、標題圖 2 秒內，操作期間 p95 幀時間低於 50ms；全圖首次建立的周邊地形與標記比原本攀岩色帶視圖多，不沿用小圖的首次顯示預算。`--offline-preview` 的 Playwright 回應攔截會停用 HTTP 快取，首次顯示時間只記錄、不與一般模式的門檻混用；操作幀時間門檻仍保留。
- 60 個原圖地點／線名、9 區名稱與 57 分區共用螢幕避讓，救援、急救優先；圖示釘在實際位置，不畫位置與名稱的連接線；名稱只在錨點旁排，空間不足的標示隨放大展開。所有可見圖示與文字共用佔位，也避讓定位圓點、回報點與工具列。道路／隧道／步道、建物、停車場、定位誤差與回報連線均貼合高程顯示。
- 步道與隧道虛線固定在地圖座標分段，不使用 `non-scaling-stroke` 重新按螢幕像素切虛線；線寬依目前比例尺調整。道路、建物直接使用地表高程，不額外抬高。3D 地圖不把原 2D 岩壁示意線畫成真實崖形，改以分區名稱查詢，不再顯示大量藍色定位點；原始線仍提供點選查詢範圍。20m DTM 不足以還原每段攀岩崖面，原 2D 資料保留。滑鼠點選不顯示預設焦點框，鍵盤焦點提示保留。
- 若執行環境不允許瀏覽器連本機伺服器，可執行 `node --import tsx scripts/terrain-map-check.ts --offline-preview`，由本機 production 檔案攔截回應，驗證真實 Chrome 的互動、48 組版面、碰撞、雙指縮放與拖曳效能；此模式明確不執行、不宣稱 Service Worker 離線重載檢查。
- 傾角效能：`node --import tsx scripts/terrain-tilt-performance.ts --offline-preview` 以正式建置測量區域圖與航照的雙指調角，4 倍 CPU 節流下 p95 低於 50ms；記錄在 `shots/terrain/tilt-performance.json`。不帶旗標則使用實際圖磚；不以 React 開發模式衡量成品效能。
- 驗證：`npm run test:terrain-data && npm run build && npm run test:terrain && npm run test:terrain-map`。Python 測試檢查海面補零、陸上內插、保留實測點與拒絕過大缺口；瀏覽器檢查所有區域與分區、8 組尺寸 × 3 種語言 × 深淺色、檔案大小上限、4 倍 CPU 節流下的捲動／拖曳幀時間與離線重新整理。3D 地圖另驗證真實滑鼠與雙指手勢、切換、縮放後重繪、岩壁點選與區域導覽；同一互動流程也整合進 `scripts/e2e-edit.ts`。截圖和結果在 `shots/terrain/`，瀏覽器節流不代表實體低階手機實測。

## 舊網址

- `longdong.climbio.org`（CNAME 指向 `longdong.firebaseapp.com`）：在 Firebase Console 的 Hosting 網域設定 301 轉到 longdong.web.app（保留路徑）。
- 舊的 `#/…` 網址、`?route=` 分享連結、早期的路線 ID 已不再支援（2026-10-18 移除）。

## 授權

- 程式碼：[MIT](LICENSE)
- TOCC 標誌與由其產生的 App 圖示（`assets/`、`public/icons/`）：屬臺灣戶外攀岩協會所有，不適用 MIT
- 龍洞岩場救援資訊圖、救援資訊（`src/data/rescue.ts`）：來自 TOCC 龍洞岩場救援計畫，屬臺灣戶外攀岩協會所有，不適用 MIT
- DTM 地形（`public/rescue/terrain-20m.json`）：© 內政部地政司，[政府資料開放授權條款第 1 版](https://data.gov.tw/license)
- 由救援資訊圖產生的地圖資料（`public/rescue/`，不含 `terrain-20m.json`，含岩場站出口的岩場地圖與救援點位置）：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，© 臺灣戶外攀岩協會（TOCC）龍洞岩場救援資訊圖
- 比例尺地圖的道路與海岸校正參考（`scripts/data/osm-reference.json`）、救援資訊圖範圍外的陸地、建物、道路與步道（`scripts/data/osm-extent.json`）：© OpenStreetMap contributors，[ODbL](https://opendatacommons.org/licenses/odbl/)
- 路線資料（`public/data/`）：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，© 臺灣戶外攀岩協會（TOCC）固定點更新計畫
