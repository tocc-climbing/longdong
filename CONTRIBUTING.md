# 貢獻指南

謝謝你願意改善龍洞攀岩資料庫。這份文件說明程式改動如何從分支走到上線。

> **路線資料（難度、Bolt、拉測等）不在這裡改**：它由臺灣戶外攀岩協會固定點更新計畫維護於 Google Sheet，每天自動同步。發現資料有誤，請聯絡協會。

## 流程

1. 從最新的 `main` 開分支：`feat/…`、`fix/…`、`docs/…`、`chore/…`。
2. 改動、在本機驗證（見下方「驗證」）。
3. 推上分支，開 PR 到 `main`，依範本填寫。
4. CI（`ci`：型別檢查、測試、build）必須通過。
5. 依[審查與實作規範](docs/review_and_implementation_protocol.md)審查，可以請 Claude Code 跑 `/code-review`。
6. 以 **Squash and merge** 合併。合併後自動部署到開發站 https://longdong-dev.web.app/ 。
7. 在開發站確認後**發布**：把 `release` 快轉到 `main`（`git push origin main:release`），自動部署到正式站 https://longdong.web.app/ 並打上版號標籤。

`main` 受保護：不能直接推送、不能強制推送，只能經由 CI 通過的 PR 合併。目前不強制核准人數。

## Commit 與 PR

- **語言**：commit message 與 PR 描述使用**繁體中文**。
- **commit 標題**：一句話說明這次改了什麼，不加句號，例如「路線頁加上快扣數」。內文需要時再說明原因。
- **PR 標題**：會成為 squash 後的 commit 標題，寫法同上。
- **PR 描述**：依範本，採「目的 → 背景 → 改動 → 影響與風險 → 驗證」；微小修訂或純文件更新簡明扼要說明即可，符合比例原則，不拘泥於形式。
- **一個 PR 一件事**。重構（輸出不該變）和新行為（輸出會變）分開成不同 PR——混在一起時，重構的「零差異」證明就失效了（規範 7.5）。

## 驗證

| 改動 | 必跑 |
|---|---|
| 任何程式碼 | `npm run typecheck`、`npm test` |
| 匯入程式、Sheet 解析 | `npm run import -- --check`，看警告清單與各區路線數 |
| 介面 | `npm run build` 後以瀏覽器實際檢查：手機寬度、淺色與深色、各語言；`npm run check:text`（CI 也會跑）檢查各語言的文字沒有超出元件 |
| 需要登入的畫面、管理頁 | `npm run shots -- --login=信箱 --seed /checklist /admin`：在 Firebase 模擬器上登入、放測試資料，拍手機與電腦、淺色與深色的截圖到 `shots/`（選項見 `scripts/shots.ts`，需要 Java） |
| 資料庫規則 | `npm run test:rules`（Database 模擬器，需要 Java；CI 也會跑）；`firebase deploy --only database --dry-run`；PR 描述附上與線上規則的差異 |
| 登入後的功能、資料庫的讀寫、修改模式 | `npm run test:e2e`（Firebase 模擬器、Chrome 或 Edge，需要 Java；CI 也會跑）：新功能的流程補進 `scripts/e2e-edit.ts` |
| 離線行為 | 以 build 結果測試：載入後斷網、重新整理，頁面與資料仍可用 |

**所有修改都要能自動驗證，不靠使用者手動試**：新功能、修正都要有會失敗的自動檢查——純邏輯寫單元測試（`npm test`）、資料庫規則寫規則測試、要登入或操作畫面的寫進端對端測試（`npm run test:e2e`：Firebase 模擬器上登入，檢查資料庫真的收到什麼、畫面真的出現什麼；`scripts/e2e-report.ts`、`scripts/e2e-edit.ts`，CI 也會跑）。寫完後破壞一次被測的行為，確認測試真的會失敗。實在無法自動驗證的（例如真機的手勢），PR 描述明講沒驗證什麼，不要寫成已驗證。

PR 描述的「驗證」寫實際做了什麼、結果如何；沒做的寫沒做。

## 審查

審查者依[審查與實作規範](docs/review_and_implementation_protocol.md)判斷，重點：

- 每一筆意見都要指出**由真實入口到達問題的路徑**（使用者操作、Sheet 內容、資料庫規則允許的寫入⋯），指不出來就不是缺陷。
- 先看**這個性質歸哪一層負責**（規範 1.5 分派表），不要求在錯的層加檢查。
- 優先**讓錯誤狀態不可表示**，其次才是加檢查；**不接受靜默修復**（夾取、補值、回退預設）。

## 每日資料同步

每天台灣時間 03:00，GitHub Actions 從 Google Sheet 匯入：

- 資料沒變：什麼都不做（之前開的同步 PR 已無差異會自動關閉）。
- 資料有變：在 `data-sync` 分支開（或更新）一個「資料同步」PR，並觸發 CI。PR 描述會列出被刪除的路線。
- 匯入檢查未通過（Sheet 版面變了、路線ID 被改等）：不開 PR，Actions 會失敗並寄通知給管理員，網站維持上一版資料。

維護者確認同步 PR 後合併，網站才會更新；路線資料不必等發布，合併後正式站與開發站都會更新（新資料要符合正式版程式的資料格式）。急著上線時，可以到 Actions 頁面手動執行「Data sync」。

## 在本機開發

```bash
npm install
npm run dev
```

需要 Node.js 20 以上。更多說明見 [README](README.md)。
