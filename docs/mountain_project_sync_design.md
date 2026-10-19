# Mountain Project (MP) 路線對照與安全資訊整合設計

## 一、 目的與規劃摘要

為改善國外岩友常用的 [Mountain Project (MP)](https://www.mountainproject.com/area/106594934/long-dong-dragon-cave) 與 TOCC 資料庫的安全資訊落差，本文件規劃路線對照與資訊連通機制：

1. **官方對照檔（`public/data/mp-map.json`）**：在專案內維護一份輕量靜態 JSON，記錄 TOCC 路線 ID 與 MP 路線網址／ID 的對照，不變動現有的 Google Sheet 版面。
2. **前端路線頁外連與摘要（`RoutePage`）**：在路線頁顯示對應的 Mountain Project 連結，並提供「複製英文安全摘要」按鈕，方便岩友手動協助更新 MP 頁面。

---

## 二、 背景：實測比對數據（2026-10 統計）

經比對 Mountain Project 龍洞區域現有路線，並與本專案 [`public/data/longdong.json`](../public/data/longdong.json)（625 條路線）進行對照，結果如下：

### 2.1 涵蓋率統計

| 指標 | 數量 | 比例 / 說明 |
|---|---:|---|
| TOCC 實際攀登路線總數 | **625 條** | 不含 7 筆 `isFixture` 固定點設施 |
| Mountain Project 現有路線總數 | **268 條** | 分佈於 10 個子區域 |
| **名稱與區域對齊成功** | **240 條** | **佔 MP 現有路線 89.6%**（完全一致 199 條、正規化對齊 41 條） |
| MP 待確認路線 | **28 條** | 多為英文別名或拼法差異 |
| **MP 未收錄的 TOCC 路線** | **約 385 條** | **佔龍洞總路線 61.6%** |

### 2.2 重大安全資訊落差範例

在已對齊的路線中，發現部分路線在 MP 上缺乏安全警告或有嚴重誤植：

1. **`#295 阿草 (Grass, 5.10a)` — 資訊誤植**
   - **TOCC 紀錄**：🔴 **紅燈（`safety: red`）、待更換（`status: needs-rebolt`）**。路線說明註記「仍使用 304 錨栓」，`B01`～`B09` 共 9 顆皆為 2004～2005 年安裝的舊膨脹螺栓（海邊服役逾 20 年，未拉測）。
   - **MP 頁面**：Protection 欄位誤寫為：
     > *`Bring 17 quick-draws + anchors. Titanium lead bolts (2020?) and anchors (2014)`*
   - **風險**：國外岩友可能誤以為整條路線已更換為鈦合金 Bolt。
2. **`#73 寄居蟹 (Hermit Crab, 5.8)`**：TOCC 為紅燈危險路線，MP 僅寫 `Protection: 316 steel (2007)`，無危險提示。
3. **`#319 登峰造極 (Topout, 5.8)`**：TOCC 為紅燈危險路線，MP 僅寫 `Protection: Gear to 2"`，無紅燈提示。

---

## 三、 資料設計

### 3.1 獨立對照檔（`public/data/mp-map.json`）

獨立維護輕量的對照檔，不變更主資料結構：

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

### 3.2 英文安全摘要格式

由 `Route` 資料產生標準英文摘要，方便岩友或志工手動至 MP 更新：

#### 範例：紅燈／待更換路線（如 `#295 阿草 Grass`）
```text
[TOCC Rebolting Project Update — 2026-10]
⚠️ SAFETY WARNING: Rated RED (Danger) / Needs Rebolt.
- Status: Needs rebolt (still uses old 304 expansion bolts from 2004–2005 on B01–B09)
- Lead bolts: 9× 304-FX (2004–2005), 2× Ti-ETN (B10–B11)
- Anchors: 2× Ti-ETN (installed 2014-08-07)
- Quickdraws needed: ~14
- Full bolt-by-bolt log & offline topo: https://longdong.web.app/route/longdong/hc9tas/
```

---

## 四、 實作規劃

1. **對照檔維護**：建立 `public/data/mp-map.json`，收錄已完成比對的 240 條路線對應關係。
2. **前端外連按鈕**：在 `RoutePage` 顯示連往 Mountain Project 的連結（若無該路線則連往對應區域頁），並附帶「複製英文安全摘要」按鈕，方便岩友手動回報。

---

## 五、 待確認事項

1. **名稱未對齊的 28 條路線**：部分為拼字差異（如 `Long Lane Loose` 對應 `#445 長巷裂隙 Long Lang Loose`），可在對照表補上別名解決；其餘若為私人自訂路線，標記為 `unlisted` 即可。
2. **優先同步對象**：建議優先修正 4 條紅燈路線（特別是 `#295 阿草 Grass`）在 MP 上的 Protection 描述。
