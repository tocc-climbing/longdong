# Mountain Project (MP) 路線對照與安全資訊同步系統設計

## 一、目的與結論

將 TOCC 龍洞攀岩資料庫（[`public/data/longdong.json`](../public/data/longdong.json)）的**最新固定點材質、拉測日期與紅黃綠安全評級**同步至 [Mountain Project — Long Dong](https://www.mountainproject.com/area/106594934/long-dong-dragon-cave)：
1. **獨立對照檔（`public/data/mp-map.json`）**：在 repo 內維護 TOCC 路線 ID 與 MP 路線網址／ID 的對照關係，不改動 Google Sheet 版面。
2. **前端路線頁輔助（`RoutePage`）**：在路線頁顯示對應的 Mountain Project 連結，並提供「複製 MP 英文安全摘要」按鈕，讓岩友或志工可隨時一鍵複製最新 Bolt 履歷貼到 MP。
3. **CLI 差異分析與 Playwright 批量更新工具（`scripts/mp-sync.ts` & `scripts/mp-submit.ts`）**：自動比對雙方差異，支援三種批量動作：
   - **發表最新安全／更新留言（Post Comment）**：針對紅燈危險、封閉或剛完成 Rebolt 的路線，直接留言警示（免審核、立即可見）。
   - **提交 Protection 欄位修改（Improve This Page）**：更新 MP 路線本體的固定點材質、數量、安裝與拉測日期。
   - **新增缺漏路線（Add Route）**：將 TOCC 有、但 MP 尚未建檔的路線（約 385 條）依分區補充至 MP。

---

## 二、背景：實地爬取與比對數據（2026-10 實測）

經實際爬取 Mountain Project `Long Dong (Dragon Cave)`（Area ID `106594934`）全部子區域與路線，並與本專案 [`public/data/longdong.json`](../public/data/longdong.json)（625 條攀登路線）進行自動化比對，結果如下：

### 2.1 整體覆蓋率與對齊統計

| 指標 | 數量 | 比例 / 說明 |
|---|---:|---|
| TOCC 實際攀登路線總數 | **625 條** | 不含 7 筆 `isFixture` 固定點設施 |
| Mountain Project 現有路線總數 | **268 條** | 分佈於 10 個子區域（多出 `Above the Waves`，實為黃金谷的貓屋／伸展台／浪之外） |
| **自動名稱＋區域成功對齊數** | **240 條** | **佔 MP 現有路線 89.6%**（精確對齊 199 條、正規化／包含對齊 41 條） |
| MP 待人工確認對齊路線 | **28 條** | 多為自創英文別名（如 `Can of Cum`、`Good Guy Alang`、`SSRN Seaview`）或拼法差異 |
| **MP 尚未收錄的 TOCC 路線** | **約 385 條** | **佔龍洞總路線 61.6%**（MP 完全找不到這些路線） |

### 2.2 各大區域路線數對照表

| TOCC 區域 | MP 對應 Area ID | TOCC 路線數 | MP 路線數 | 自動對齊數 | MP 缺漏路線數 |
|---|---|---:|---:|---:|---:|
| 後門 (`back-door`) | `107145175` | 105 | 38 | 31 | 74 |
| 黃金谷 (`golden-valley`) | `106598118` + `107684434` *(Above the Waves)* | 100 | 57 | 50 | 50 |
| 第二洞 (`second-cave`) | `107763496` | 50 | 10 | 14 *(含跨區)* | 36 |
| 第一洞 (`first-cave`) | `107763031` | 73 | 32 | 19 | 54 |
| 大禮堂 (`grand-auditorium`) | `107394344` | 42 | 17 | 12 | 30 |
| 音樂廳 (`music-hall`) | `106740839` | 103 | 36 | 31 | 72 |
| 長巷 (`long-lane`) | `107073210` | 47 | 28 | 28 | 19 |
| 鐘塔 (`clocktower`) | `106988155` | 54 | 24 | 22 | 32 |
| 校門口 (`school-gate`) | `106596753` | 51 | 26 | 25 | 26 |

### 2.3 🚨 實測發現的嚴重安全資訊落差（急需優先同步！）

在已對齊的路線中，有 **116 條**在 TOCC 已有明確的「已拉測（78 條）」或「已更新 Rebolted（38 條）」紀錄，更有 **4 條紅燈危險／封閉路線**在 MP 上存在嚴重誤導或缺乏警告：

1. **`#295 阿草 (Grass, 5.10a)` — 嚴重誤導（極度危險！）**
   - **TOCC 現況**：🔴 **紅燈危險（`safety: red`）、待更新（`status: needs-rebolt`）**。路線說明明確標示「路線仍使用 304 錨栓」，`B01`～`B09` 共 9 顆皆為 2004～2005 年安裝的 `304-FX`（海邊服役已逾 21 年，未拉測）。
   - **MP 現況**（[`route/109850966/grass`](https://www.mountainproject.com/route/109850966/grass)）：Protection 欄位竟寫著：
     > *`Bring 17 quick-draws + anchors. Titanium lead bolts (2020?) and anchors (2014)`*
   - **風險**：國外或看英文的岩友會誤以為整條路線已在 2020 年換成鈦合金 Bolt 而放心攀爬！
2. **`#73 寄居蟹 (Hermit Crab, 5.8)` — 缺乏紅燈警告**
   - **TOCC 現況**：🔴 **紅燈危險（`safety: red`）**。
   - **MP 現況**（[`route/107836769/hermit-crab`](https://www.mountainproject.com/route/107836769/hermit-crab)）：僅寫 `Protection: 316 steel (2007)`，無任何危險提示。
3. **`#319 登峰造極 (Topout, 5.8)` — 缺乏紅燈警告**
   - **TOCC 現況**：🔴 **紅燈危險（`safety: red`）**。
   - **MP 現況**（[`route/108036538/topout`](https://www.mountainproject.com/route/108036538/topout)）：僅寫 `Protection: Gear to 2"`，無紅燈提示。
4. **10 條黃燈注意（`safety: yellow`）與 10 條待拉測（`needs-test`）路線**：在 MP 上均無對應的固定點狀態說明。

---

## 三、系統架構與資料設計

```mermaid
flowchart TD
    TOCC["public/data/longdong.json\n(625 條路線 + Bolt 履歷)"]
    MPMap["public/data/mp-map.json\n(獨立對照檔：Area & Route Mapping)"]
    MPWeb["Mountain Project 網站\n(268 條現有路線)"]

    subgraph 1. 對照與差異檢查腳本 (scripts/mp-sync.ts)
        Crawl["爬取 MP 最新目錄與 Protection 內文"]
        Align["名稱/區域自動對齊 + 人工覆寫表"]
        Report["產出差異報告 (Red/Yellow 警示、Rebolt 更新、缺漏路線)"]
    end

    subgraph 2. 前端路線頁整合 (src/pages/RoutePage.tsx)
        Badge["顯示 Mountain Project 外部連結"]
        CopyBtn["「複製 MP 英文更新摘要」按鈕"]
    end

    subgraph 3. Playwright 半自動批量提交 (scripts/mp-submit.ts)
        Comment["動作 A：發表最新安全/Rebolt 留言 (立即可見)"]
        EditProt["動作 B：提交 Improve This Page -> Protection 修改"]
        AddRoute["動作 C：在對應 Area 新增 MP 缺漏路線"]
    end

    MPWeb --> Crawl --> Align --> MPMap
    TOCC --> Align
    MPMap --> Report
    MPMap --> Badge
    TOCC --> CopyBtn
    Report --> Comment & EditProt & AddRoute
```

### 3.1 獨立對照檔結構（`public/data/mp-map.json`）

不修改 Google Sheet 與 `longdong.json` 的 schema，獨立維護一份輕量的 [`public/data/mp-map.json`](../public/data/mp-map.json)：

```json
{
  "updatedAt": "2026-10-17T18:30:00Z",
  "areas": {
    "longdong/back-door": "https://www.mountainproject.com/area/107145175/backdoor",
    "longdong/golden-valley": "https://www.mountainproject.com/area/106598118/golden-valley",
    "longdong/second-cave": "https://www.mountainproject.com/area/107763496/second-cave",
    "longdong/first-cave": "https://www.mountainproject.com/area/107763031/first-cave",
    "longdong/grand-auditorium": "https://www.mountainproject.com/area/107394344/grand-auditorium",
    "longdong/music-hall": "https://www.mountainproject.com/area/106740839/music-hall",
    "longdong/long-lane": "https://www.mountainproject.com/area/107073210/long-lane",
    "longdong/clocktower": "https://www.mountainproject.com/area/106988155/clocktower",
    "longdong/school-gate": "https://www.mountainproject.com/area/106596753/school-gate"
  },
  "routes": {
    "longdong/hc9tas": {
      "mpId": "109850966",
      "url": "https://www.mountainproject.com/route/109850966/grass",
      "name": "Grass",
      "lastSyncedVersion": "a1b2c3d4"
    }
  }
}
```
- `lastSyncedVersion`：記錄上次成功同步到 MP 時，該條路線在 TOCC 的保護資訊雜湊（由 `safety`、`status`、`bolts`、`anchors`、`lastTested` 算出）。當 Google Sheet 未來更新了某條路線的拉測日期或 Bolt 材質時，`scripts/mp-sync.ts` 就能精準抓出「自上次同步後有變動的路線」！

### 3.2 標準英文更新摘要產生器（`src/mpSummary.ts`）

將「由 `Route` 產生 Mountain Project 英文安全與固定點摘要」寫成純函式，供前端路線頁與後端批量腳本共用：

#### 範例 A：紅燈／待更新路線（如 `#295 阿草 Grass`）
```text
[TOCC Rebolting Project Update — 2026-10]
⚠️ SAFETY WARNING: Rated RED (Danger) / Needs Rebolt.
- Status: Needs rebolt (still uses old 304 expansion bolts from 2004–2005 on B01–B09)
- Lead bolts: 9× 304-FX (2004–2005), 2× Ti-ETN (B10–B11)
- Anchors: 2× Ti-ETN (installed 2014-08-07)
- Quickdraws needed: ~14
- Full bolt-by-bolt log & offline topo: https://tocc-climbing.github.io/longdong/route/longdong/hc9tas/
```

#### 範例 B：綠燈／已更新或已拉測路線
```text
[TOCC Rebolting Project Update — 2026-10]
- Safety: OK (Green) · Status: Rebolted / Pull-tested (last tested: 2025-11)
- Lead bolts: 8× Ti-U (installed 2024-05)
- Anchors: 2× Ti-U (installed 2024-05)
- Quickdraws needed: 10
- Full bolt-by-bolt log & offline topo: https://tocc-climbing.github.io/longdong/route/longdong/7kq2mx/
```

---

## 四、三大模組實作細節

### 4.1 階段一：對照與差異分析腳本（`scripts/mp-sync.ts`）
- **指令**：`npm run mp:sync`
- **功能**：
  1. 爬取 MP Long Dong 10 個區域的路線清單，透過正規化規則（忽略冠詞 `, The`、移除 `X -` 前綴、移除 `| P1` 繩距後綴、比對漢字與羅馬字 `I/II` ↔ `1/2`）自動更新 `public/data/mp-map.json`。
  2. 針對已對齊路線，比對 TOCC 目前的固定點雜湊與 `lastSyncedVersion`（或直接抓取 MP 頁面的 `Protection` 文字比對）。
  3. 在終端機與報表輸出三份清單：
     - **🚨 P0 緊急安全落差**：TOCC 為 `red` / `closed` / `to-remove` / `needs-rebolt`，但 MP 未標示警告的路線。
     - **🔄 P1 固定點資訊待更新**：TOCC 有 `bolts` / `anchors` / `lastTested` 履歷，且與 MP `Protection` 欄位不一致的路線。
     - **➕ P2 MP 缺漏路線**：TOCC 有、但 MP 尚未建立的路線清單。

### 4.2 階段二：前端路線頁整合（`src/pages/RoutePage.tsx`）
- 在路線頁底部（或路線資訊區塊）：
  - 若該路線在 `mp-map.json` 有對應網址，顯示 **「Mountain Project 路線頁 ↗」** 連結（若無對應路線，則連往該大區域的 MP 頁面）。
  - 提供 **「複製 MP 英文更新摘要」** 按鈕（複用 `CopyButton`），方便任何熱心岩友或維護者在 MP 點選 `Improve This Page` 或留 Comment 時直接貼上。

### 4.3 階段三：Playwright 半自動／批量提交工具（`scripts/mp-submit.ts`）
- **指令**：
  - `npm run mp:submit -- --mode=comment --filter=red`（針對紅燈／封閉路線發表警示留言）
  - `npm run mp:submit -- --mode=protection --route=longdong/hc9tas`（提交特定或批量路線的 Protection 修改）
  - `npm run mp:submit -- --mode=add --area=longdong/long-lane`（在指定區域批量新增 MP 缺漏路線）
- **安全與防呆機制**：
  1. **復用本機登入狀態**：首次執行時開啟 headed Chromium 讓使用者手動登入 Mountain Project，並將 session 存於本機 `.mp-session/`（列入 `.gitignore`，絕不進版控）。
  2. **預設 Dry-run / 互動確認（Interactive Confirm）**：腳本自動打開 MP 表單並填好所有欄位（如 Route Name、Grade、Height in ft、Type、Description、Protection），預設停在送出按鈕前讓使用者目視確認（或加上 `--yes` 才自動送出），並在每次請求間加入合理延遲（Rate limit），避免觸發網站防護。
  3. **更新成功後自動寫回 `lastSyncedVersion`**：避免重複留言或重複提交相同的修改。

---

## 五、討論與待確認事項

1. **那 28 條名稱對不上的 MP 路線**：
   - 其中有幾條是拼字或別名差異（例如 MP 的 `Long Lane Loose` 對應 TOCC `#445 長巷裂隙 Long Lang Loose`、MP 的 `Puro Filipino` 對應 TOCC `#315 Puro Filippino`、MP 的 `Stephen's Size 13 Shoes` 對應 `#183 Stephan’s Size 13 Shoes`），這些我們可以直接寫進 `mp-sync.ts` 的手動對照字典（Alias Map）裡解決。
   - 另外約 15 條是外國岩友自己取名上傳、指南書未收錄的路線（例如第一洞的 `Jabba the Hutt 赫特族的賈霸`、`Shark Attack 鯊魚攻擊`、`Poopee 便便噓噓`），這些在 `mp-map.json` 中標記為 `unlisted` 即可。
2. **第一波優先測試對象**：
   - 建議我們實作完腳本後，第一波先針對 **4 條紅燈路線（特別是 `#295 阿草 Grass`）** 測試發表 Comment 與提交 Protection 更新！
