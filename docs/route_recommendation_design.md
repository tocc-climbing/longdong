# `longdong-coach`（龍洞攀岩教練／制霸攻略）獨立 Web App 架構與設計

## 一、目的與結論

將**「個人能力評估、路線推薦、一日行程規劃與爬完龍洞（制霸進度）」**獨立打造為專屬的 Web App —— **`longdong-coach`（龍洞攀岩教練／攻略）**，與現有的 `tocc-climbing/longdong`（龍洞攀岩資料庫）形成雙應用互補生態：

1. **產品定位分離，體驗更純粹**：
   - **`longdong`（主資料庫）**：維持極簡、零干擾的**「岩場現場安全字典與工具書」**，專注於查詢路線、逐顆 Bolt 材質與拉測履歷、離線救援定位。
   - **`longdong-coach`（攀岩教練與破關攻略）**：專注於**「行前規劃、能力分析、智慧推薦與全區清台追蹤」**，整個介面圍繞個人日誌與破關進度展開，不受限於主站「我的」頁面的單一欄寬。
2. **資料與帳號 100% 無縫互通（零重複輸入、零維護負擔）**：
   - **路線資料共用**：直接同步讀取主站發布的 `longdong.json`（共用永久固定的路線 ID `longdong/<6碼>` 與紅黃綠安全燈號）。
   - **個人紀錄與雲端同步共用**：連接同一個 Firebase 專案（`longdong`）的 `/v2/personal/<uid>` 與 `/v2/ratings`。使用者在兩邊用同一個 Google／Facebook 帳號登入，攀登紀錄（Ticks）與收藏（Favorites）即自動雙向同步。
   - **支援外部日誌匯入**：內建 **Mountain Project 個人 Tick List CSV 匯入工具**，一鍵將過往累積的攀登紀錄轉換為標準 `Tick` 格式並同步上雲端。

---

## 二、雙站協作與資料流架構

```mermaid
flowchart LR
    subgraph TOCC 主資料庫 (tocc-climbing/longdong)
        GS["Google Sheet\n(TOCC 固定點更新計畫)"] --> JSON["longdong.json\n(625 條路線 + 安全燈號)"]
        MainApp["龍洞攀岩資料庫 PWA\n(現場查 Bolt / 離線救援)"]
        JSON --> MainApp
    end

    subgraph 共用雲端與本機儲存
        FB["Firebase Realtime DB\n• /v2/personal/<uid> (紀錄/收藏)\n• /v2/ratings (星等/體感難度)"]
        MP_CSV["Mountain Project\n個人 Tick List (.csv)"]
    end

    subgraph 獨立新應用 (longdong-coach)
        CoachApp["龍洞攀岩教練 PWA"]
        Engine["本機推薦與訓練引擎\n• 個人能力模型 (Working / Max Grade)\n• 四大推薦維度\n• 一日行程產生器 (Session Builder)\n• 9 大區域 × 難度破關矩陣"]
        CoachApp --- Engine
    end

    JSON == "1. 自動讀取最新路線與安全燈號" ==> CoachApp
    MainApp <== "2. 雙向即時同步 (同帳號登入)" ==> FB
    FB <== "2. 雙向即時同步 (LWW 合併)" ==> CoachApp
    MP_CSV -. "3. 首次一鍵匯入歷史完攀" .-> CoachApp
    CoachApp -- "4. Deep Link 跳轉查看逐顆 Bolt 履歷" --> MainApp
```

### 2.1 跨站認證與安全邊界
- **Firebase Auth 網域白名單**：只要在 Firebase Console（`Authentication → Settings → Authorized domains`）將 `longdong-coach` 的部署網域加入白名單，即可直接使用相同的 Google / Facebook 登入流程。
- **資料庫規則零修改**：`longdong-coach` 寫入的 `Favorite` 與 `Tick` 結構完全遵循主站 [`src/personal/model.ts`](../src/personal/model.ts) 與 [`firebase/database.rules.json`](../firebase/database.rules.json) 的規範，透過相同的 `reconcile()`（以 `updatedAt` 較新者為準＋Tombstone 軟刪除）合併，不會破壞任何既有資料。

---

## 三、核心演算法：能力模型與推薦引擎

### 3.1 安全與有效性過濾（Climbable Pool）
经盤點 [`public/data/longdong.json`](../public/data/longdong.json) 全部 632 筆項目：
- 排除非攀登項目（`isFixture: true`，共 7 筆）後，共 **625 條攀登路線**（運攀 208、傳攀 329、抱石 44、上方架繩 42、混合 2）。
- **推薦安全池（共 590 條）**：自動排除 `isFixture: true`、`status === 'closed'`（5 條）、`status === 'to-remove'`（5 條）與 `safety === 'red'`（28 條）的路線，確保**絕不推薦封閉或紅燈危險路線**。
- *註：使用者過往已完攀的路線，即使後來變更為紅燈或封閉，仍保留於個人的歷史完攀統計中，不抹煞既有成就。*

### 3.2 個人攀登能力評估模型（Ability Profile）
可依攀登類型（**全部** ／ **運攀 Sport** ／ **傳攀與其他 Trad & Other**）分別或綜合計算：

1. **完攀集合（`sentRoutes`）**：`isSent(tick.style) === true`（包含 `onsight`、`flash`、`redpoint`、`follow`、`toprope`）。
   - **進階權重區分**：計算「突破挑戰」時，可選擇以**先鋒完攀（Lead：`onsight` / `flash` / `redpoint`）**為主，避免單次 Top-rope 或 Follow 高難度路線拉高先鋒推薦難度。
2. **最高完攀難度（`maxGrade`）**：已完攀路線中的最大 `gradeValue`。
3. **穩定工作難度（`workingGrade`）**：
   - 取已完攀路線依 `gradeValue` 由高至低排列的**第 3 難**路線數值（若完攀僅 1～2 條則取最低者）。
   - 能有效濾除單一偶發高難度紀錄（Outlier），反映目前穩定發揮的舒適圈上限。

### 3.3 四大智慧推薦維度（互斥不重複）

同一分類內的排序優先級（Tie-Breaker）：**綠燈（`safety === 'green'`） → 已更新／已拉測（`rebolted` / `tested`） → 社群星等（`rating.average`）＋體感難度（`feel`） → 官方路線編號**。

| 維度 | 對象與篩選規則 | 推薦理由標示範例 |
|---|---|---|
| **1. 🎯 完攀未竟**<br>*(Projects)* | 曾有 `attempt`（嘗試未完攀）紀錄、或已加入 `favorites`（收藏），但尚未完攀的路線。<br>依「近期嘗試日期 → 嘗試次數 → 難度接近 `workingGrade`」排序。 | `曾嘗試 2 次（最近：14 天前）`<br>`已收藏 · 符合你目前的穩定難度` |
| **2. 💪 鞏固與熱身**<br>*(Solidify / 入門)* | • **有完攀紀錄**：難度落在 `[workingGrade - 2, workingGrade]`（例如穩定爬 `5.10c`，推薦 `5.10a`～`5.10c`）的未爬路線。<br>• **新手（0 完攀）**：推薦 `5.6`～`5.9`（`gradeValue <= 36`）的綠燈高評分經典路線。 | `鞏固 5.10b · 綠燈已更新 · ★ 4.6`<br>`體感偏軟（適合熱身或首條同級先鋒）` |
| **3. 🚀 突破挑戰**<br>*(Step Up)* | 難度落在 `(workingGrade, maxGrade + 2]`（比穩定難度高 1～2 小級，例如最高爬過 `5.10b`，推薦 `5.10c`～`5.10d`）。<br>優先挑選**綠燈、已更新（Rebolted）、體感偏軟（Soft）或剛好（Fair）**的高評分路線作為破級首選！ | `挑戰下一級 5.10c · 體感偏軟 · 10 快扣` |
| **4. 🗺️ 區域清台**<br>*(Sector Clear)* | 找出使用者已爬過 $\ge 1$ 條、尚未 100% 清台，且剩餘路線難度在可及範圍（$\le maxGrade + 2$）內完成度最高的分區（Sector）。 | `音樂廳 · 正面 已完成 8/10（差 2 條清台！）` |

---

## 四、`longdong-coach` 四大核心頁面與功能設計

獨立成專屬 Web App 後，採用底部導覽列（手機）／左側導覽欄（電腦）切換四個主要視圖：

```
┌─────────────────────────────────────────────────────────────┐
│  [🎯 教練推薦]   [📅 一日行程]   [🗺️ 制霸龍洞]   [📓 日誌與匯入]  │
└─────────────────────────────────────────────────────────────┘
```

### 頁面 1：🎯 教練推薦（Coach Dashboard）
- **頂部個人能力摘要卡**：
  - 顯示目前類型切換（`全部`｜`運攀`｜`傳攀/其他`）。
  - 顯示個人能力指標：**「穩定工作難度：`5.10b` · 最高完攀：`5.10d` · 已完攀：`42 / 190` 條（22%）」**。
- **四大推薦清單卡片**：
  - 依序呈現 **🎯 完攀未竟**、**💪 鞏固與熱身**、**🚀 突破挑戰**、**🗺️ 區域清台**。
  - 每張路線卡片顯示：路線編號、中英名稱、所屬區域／分區、難度膠囊、快扣數、安全燈號、社群星等／體感難度，以及**專屬推薦標籤（Why this route）**。
  - 點擊可展開路線描述、直接「＋ 記錄攀登」或點「在龍洞資料庫查看逐顆 Bolt 履歷 ↗」。

### 頁面 2：📅 一日岩場行程產生器（Session Builder）
解決岩友週末出發前「今天去哪一區？要爬哪幾條？」的痛點：
1. **選擇目標**：
   - **指定區域**（例如：「今天想去『後門』或『長巷』」）或 **「幫我挑最適合我的分區」**（自動選出符合使用者難度且未爬綠燈路線最多的分區）。
   - **選擇今日強度**：`輕鬆熱身刷量` ｜ `標準訓練（熱身 + 鞏固 + 挑戰）` ｜ `全力磕 Project`。
2. **自動生成一日攀登菜單（5 條同區域／相鄰分區路線，免跑遠路）**：
   - 🔥 **第 1～2 條（熱身 Warm-up）**：該區 `workingGrade - 3 ~ -2` 的綠燈路線。
   - 💪 **第 3～4 條（主力鞏固 Working）**：該區 `workingGrade - 1 ~ workingGrade` 的未完攀路線。
   - 🚀 **第 5 條（今日壓軸 Project / Step Up）**：該區已收藏／曾嘗試的 Project，或 `workingGrade + 1` 的突破路線。
3. **一鍵打卡完攀**：在岩場爬完可直接勾選記錄 `Onsight / Flash / Redpoint / Attempt`。

### 頁面 3：🗺️ 制霸龍洞（Completion Tracker & Matrix）
將「爬完龍洞」遊戲化、視覺化：
1. **全區清台地圖與進度榜（Area & Sector Mastery）**：
   - 列出龍洞 **9 大區域（後門、黃金谷、第二洞、第一洞、大禮堂、音樂廳、長巷、鐘塔、校門口）** 與 **54 個分區** 的完攀進度條与完成率（例如 `長巷 18 / 28 (64%)`）。
   - 100% 爬完的分區獲得 **「🏆 分區制霸（Sector Cleared）」** 標章。
2. **難度破關矩陣（Grade Grid Matrix）**：
   - 依難度（`5.6`、`5.7`、`5.8`、`5.9`、`5.10a`、`5.10b`…）分組，每一條路線顯示為一個帶編號的小方格（如 `#425`）：
     - 🟩 **綠色**：已先鋒完攀（Onsight / Flash / Redpoint）
     - 🟦 **青色**：已完攀（Follow / Top-rope）
     - 🟧 **橘色**：Project（曾 Attempt 或已收藏）
     - ⬜ **灰色**：尚未攀爬
   - 讓使用者清楚看到「我的 `5.9` 還差哪 3 條就全制霸了！」

### 頁面 4：📓 日誌與匯入（Logbook & Mountain Project Importer）
1. **完整攀登時間軸與難度金字塔**：支援搜尋個人紀錄、依攀登方式（OS / FL / RP / TR / Attempt）篩選。
2. **Mountain Project Tick List CSV 匯入器**：
   - 使用者從 Mountain Project 網站匯出 `ticks.csv` 後直接拖曳上傳。
   - 透過內建的 `mp-map.json`（240+ 條已對齊的 MP URL / Route ID ↔ TOCC Route ID 對照表）自動配對路線、轉換日期與攀登方式（`Lead / Onsight` → `onsight`、`Lead / Fell/Hung` → `attempt` 等）。
   - 匯入前顯示預覽清單確認，確認後寫入 IndexedDB 並自動同步至 Firebase `/v2/personal/<uid>`，回到主站 `longdong` 也能立刻看到匯入的紀錄！

### 頁面 5：📡 今日誰在龍洞（熟人好友動態雷達 Crag Radar）
解決龍洞部分岩場（如黃金谷、第一洞）手機訊號不佳，朋友臨時想會合卻聯絡不上的痛點：
1. **兩階段一鍵打卡／預報**：
   - **出發前／在和美 7-11 有訊號時**：一鍵預報「🗓️ 預計前往：黃金谷（13:00–17:30）」，並填寫攜帶裝備（如 `70m 繩 · 14 把快扣`）與今日目標路線。
   - **抵達岩場或換區時**：點選「🟢 已在岩場」或「換區 → 長巷」，朋友打開雷達即可看到你在哪個大區域、哪個分區，甚至正在哪一條路線（`routeId`）下方。
2. **一鍵「🤝 +1 我也在這區」與合體選線**：
   - 點擊好友卡片上的「+1 會合」，自動將自己的位置同步標記至該區，並跳轉至「一日行程產生器」配出該區適合兩人一起爬的路線。

---

## 五、熟人位置回報（Crag Radar）資料庫與隱私規則設計

在無後端伺服器（Serverless，僅使用 **Firebase Realtime Database + `database.rules.json`**）的前提下，為了兼顧**「熟人好友圈可見、陌生人無法窺探或列舉、隔日自動過期不留垃圾、離線可排隊送出」**，資料庫結構設計如下：

### 5.1 資料庫節點結構（`/v2/circles` 與 `/v2/presence`）

```text
/v2
 ├── profiles/<uid>                       # (既有) 公開暱稱 { name, updatedAt }
 ├── personal/<uid>                       # (既有) 個人收藏與完攀紀錄
 │
 ├── circles/<uid>                        # [新增] 個人熟人好友圈
 │    ├── friends/<friendUid>: true       # 我認可的好友 UID（只有名單內的好友能讀我的位置）
 │    └── invites/<token>: true           # 我產生的好友邀請連結通行碼
 │
 └── presence/<YYYY-MM-DD>/<uid>          # [新增] 當日位置回報（一人一天一筆，換區直接覆寫 Upsert）
      ├── status: "at-crag" | "going"     # 已在岩場現場 | 預計前往
      ├── areaId: "longdong/music-hall"   # 所在大區域 ID
      ├── sectorId: "longdong/..."        # 所在分區 ID (選填)
      ├── routeId: "longdong/..."         # 目前正在哪一條路線下方 (選填，方便現場直接找人)
      ├── timeRange: "09:00-16:30"        # 預計停留時段
      ├── visibility: "friends" | "public"# 權限：僅熟人好友可見 (預設) | 公開給岩友
      ├── gear: "70m繩 · 14快扣"           # 攜帶裝備備註 (選填，限 60 字)
      ├── message: "在正面熱身中"           # 狀態留言 (選填，限 100 字)
      ├── routes: ["longdong/...", ...]   # 今日目標路線 ID 陣列 (選填)
      └── updatedAt: "2026-10-18T09:15:00.000Z" # 最後更新時間 (ISO 8601)
```

### 5.2 核心設計決策

1. **以日期 `YYYY-MM-DD` 分層實現「零伺服器自動過期」**：
   - 路徑設為 `/v2/presence/<YYYY-MM-DD>/<uid>`，前端只訂閱「今日（與本週末預報）」的日期鍵。
   - **一人一天一筆（Upsert）**：同一天內從「預計前往」改為「已在現場」、或下午從「黃金谷」換區到「長巷」，皆直接覆寫同一個 `/v2/presence/<YYYY-MM-DD>/<uid>` 節點，不會出現一人同時在兩區的幽靈狀態；按「離開岩場」即設為 `null` 刪除。隔天一到，前一日的打卡自動在畫面上歸零，無須排程伺服器清理。
2. **防止陌生人全區掃描（Rule Cascade 與點名訂閱）**：
   - 在 Firebase Realtime Database 中，若對 `/v2/presence/$date` 開放 `.read`，任何人都可一次撈出全龍洞所有人的行蹤。
   - 因此 **不在 `$date` 層開放 `.read`**，而是將 `.read` 設在單人節點 `/v2/presence/$date/$uid`：
     ```json
     "presence": {
       "$date": {
         "$uid": {
           ".read": "auth != null && (auth.uid === $uid || data.child('visibility').val() === 'public' || root.child('v2/circles/' + $uid + '/friends/' + auth.uid).val() === true)",
           ".write": "auth != null && auth.uid === $uid",
           ".validate": "!newData.exists() || (newData.hasChildren(['status', 'areaId', 'visibility', 'updatedAt']) && (newData.child('status').val() === 'at-crag' || newData.child('status').val() === 'going') && (newData.child('visibility').val() === 'friends' || newData.child('visibility').val() === 'public'))"
         }
       }
     }
     ```
   - **前端讀取方式**：前端先讀取自己的熟人好友清單（例如 5～15 位固定繩伴的 `friendUid`），再針對每位好友並發監聽 `/v2/presence/<today>/<friendUid>`。這樣陌生人就算打開 DevTools 也無法列舉非好友的位置，隱私 100% 受資料庫規則保護。
3. **免搜尋的熟人互加機制（LINE 邀請連結）**：
   - 使用者在 App 點選「➕ 邀請固定繩伴」，產生帶有一次性或個人 `token` 的邀請網址（`https://longdong-coach.web.app/#invite?from=<uid>&token=<token>`）貼給 LINE 好友。
   - 好友點開連結後，雙方即在 `/v2/circles/` 互為好友，未來在龍洞打卡即可互相看見。

---

## 六、技術棧與專案結構（`longdong-coach`）

👉 **互動 Prototype 線上預覽：https://longdong-coach.web.app**

為確保兩個專案的開發體驗一致、元件與型別可直接複用，採用與主站完全相同的輕量技術棧：
- **核心框架**：Vite + React 19 + TypeScript + `vite-plugin-pwa`（支援離線使用）
- **本機與雲端同步**：`idb`（IndexedDB）+ `firebase`（共用 `/v2/personal/<uid>`、`/v2/presence` 與 REST `/v2/ratings`）
- **實景照片整合**：透過 `public/data/mp-map.json` 外連 Mountain Project 240+ 條對齊路線的公開圖片 URL 與星等評分（不將外部照片檔案存入 repo）
- **測試框架**：`vitest`（針對能力評估、推薦排序、一日行程生成與 MP CSV 解析撰寫完整單元測試）

```text
longdong-coach/
├── public/
│   └── data/
│       └── mp-map.json          # MP Route ID / URL / Photo URL ↔ TOCC Route ID 對照表
├── src/
│   ├── schema.ts                # 與主站共用的 Dataset / Route 型別
│   ├── loader.ts                # 載入並快取主站 longdong.json 與 mp-map.json
│   ├── engine/
│   │   ├── recommend.ts         # 個人能力模型、四大推薦維度與一日岩場行程產生器
│   │   ├── radar.ts             # 熟人好友動態雷達與區域位置回報模型
│   │   └── mpImport.ts          # Mountain Project Tick CSV 解析與對齊
│   ├── personal/                # 與主站相容的 IndexedDB store + Firebase sync
│   └── App.tsx
└── tests/
    └── recommend.test.ts
```

---

## 七、討論與確認事項

1. **Firebase 授權網域（Authorized Domains）**：
   - 若部署於 `https://tocc-climbing.github.io/longdong-coach/`，因為網域同樣是 `tocc-climbing.github.io`，連 Firebase 設定都不用改，直接就能共用 Google 登入！
   - 若使用獨立的 `https://longdong-coach.web.app`，只需在 Firebase Console 的 Authorized domains 加入 `longdong-coach.web.app` 即可。
2. **主站與教練站的互相連結**：
   - 未來 `longdong-coach` 上線後，主站 `tocc-climbing/longdong` 的「我的」頁面只需要加一個小連結（例如：「前往『龍洞攀岩教練』查看路線推薦、好友雷達與制霸進度 ↗」），就能讓主站保持極簡，同時提供超完整的進階訓練與熟人約爬體驗！
