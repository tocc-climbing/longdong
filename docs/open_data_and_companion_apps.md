# TOCC 開放資料與第三方應用（Companion App）串接指南

本文件說明外部社群工具或第三方應用（Companion App）如何讀取 TOCC 龍洞攀岩資料庫的開放資料，以及雙方資料格式的對齊規範。

## 一、 核心原則與權責分工

1. **TOCC 主站定位**：專注於維護客觀、高可靠度的「現場路線字典與固定點安全紀錄」，包含路線資訊、逐顆 Bolt / Anchor 材質與拉測紀錄，以及離線救援資訊。主站不經手外部社交或複雜推薦邏輯，保持架構極簡與零維護負擔。
2. **以主站公開資料為權威來源**：第三方應用直接讀取主站發布的 `public/data/longdong.json`，共用固定的路線 ID（`longdong/<6碼>`）與安全燈號（紅、黃、綠燈），避免資料分歧。
3. **安全資訊一致與回連標註**：第三方應用若涉及路線安全或狀態，需忠實呈現 TOCC 官方評級，並在介面上標註資料來源（TOCC 台灣戶外攀岩協會）與提供連回主站查看 Bolt 履歷的連結。

## 二、 資料串接架構

第三方應用透過公開檔案讀取資料，若有個人紀錄需互通，則依照本專案既有的匯出／匯入格式處理：

```mermaid
flowchart LR
    subgraph TOCC 官方資料
        JSON["public/data/longdong.json\n(625 條路線與安全燈號)"]
        MainApp["TOCC 官方網站 / PWA\n(現場查 Bolt / 離線救援)"]
    end

    subgraph 資料互通規格
        Schema["longdong-personal (v1)\n(標準 JSON 匯入／匯出格式)"]
    end

    subgraph 第三方應用 (例如 Climber Buddy)
        App["第三方 Web App / 工具"]
    end

    JSON -->|讀取公開路線與安全資料| App
    App <-->|支援匯出／匯入| Schema
    Schema <-->|個人紀錄備份與匯入| MainApp
    App -.->|附帶連結引導回主站查看完整 Bolt 履歷| MainApp
```

## 三、 個人攀登紀錄格式對齊（Data Portability）

TOCC 採用 Local-First 架構，尊重使用者的個人資料自主權。若第三方應用希望讓使用者把攀登紀錄帶回 TOCC 主站，請遵循 [`src/personal/model.ts`](../src/personal/model.ts) 的 `PersonalExport` (v1) 格式：

### 3.1 資料結構
```typescript
export type TickStyle = 'onsight' | 'flash' | 'redpoint' | 'follow' | 'toprope' | 'attempt';

export interface Tick {
  id: string;              // 唯一識別碼
  routeId: string;         // TOCC 標準路線 ID (例如 longdong/school-gate-woodchip)
  date: string;            // YYYY-MM-DD
  style: TickStyle;        // 對齊 TOCC 6 種風格
  note?: string;           // 個人筆記
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  deleted?: boolean;       // 刪除標記 (Tombstone)
}

export interface PersonalExport {
  format: 'longdong-personal';
  version: 1;
  exportedAt: string;
  favorites: { routeId: string; createdAt: string; updatedAt: string }[];
  ticks: Tick[];
}
```

### 3.2 雙向同步與衝突處理
處理個人紀錄的匯入與合併時，請遵循 TOCC 內建的 `mergeRecords` 邏輯：
- **以最後寫入為準（Last-Write-Wins）**：相同 ID 的紀錄以 `updatedAt` 較新者為準。
- **保留刪除標記（Tombstone）**：若使用者刪除紀錄，應標記 `deleted: true`，避免雙向合併時已刪除的舊紀錄被錯誤復原。

### 3.3 Mountain Project (MP) 紀錄轉換
若第三方應用提供 Mountain Project 的 `ticks.csv` 匯入功能，建議將攀登風格對應至 TOCC 標準：
- `Lead + Onsight` ➔ `onsight`
- `Lead + Flash` ➔ `flash`
- `Lead + Redpoint / Pinkpoint` ➔ `redpoint`
- `Lead + Fell/Hung` ➔ `attempt`
- `Follow` ➔ `follow`
- `Toprope` ➔ `toprope`

## 四、 第三方應用安全規範

為確保岩友現場安全，串接 TOCC 資料的第三方應用需注意：

1. **排除危險與封閉路線**：任何路線推薦或清單，應自動過濾紅燈危險路線（`safety === 'red'`）、封閉路線（`status === 'closed'`）以及待更換固定點路線（`status === 'needs-rebolt'` / `'to-remove'`）。
2. **忠實呈現官方安全紀錄**：涉及固定點材質、更換日期與拉測數據時，應以 TOCC 資料庫為準，不自行臆測或修改警示內容。
3. **提供官方連結**：在路線資訊旁提供連回 TOCC 主站的連結（`https://longdong.web.app/route/<ID>/`），方便岩友核對逐顆 Bolt 履歷並支持固定點更換計畫。
