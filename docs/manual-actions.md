# GitHub Actions 手動操作與 ChatGPT 部署

快速迭代期間，一般程式碼 push、PR、規則與正式版發布都不自動執行。
**唯一保留的自動流程**：每天台灣時間 03:00 從 Google Sheet 同步路線資料。若有變更，建立／更新 `data-sync` PR，並自動跑該 PR 的 CI；由維護者合併後，僅當 `main` 的此次提交只有 `public/data/**` 資料更動時，自動部署開發站與正式站（正式站仍以 `release` 程式套用新版資料並驗證）。沒有資料變更不建立新部署。
GitHub Actions → CI／Data sync／Database rules／Deploy → Run workflow。

- 手動執行 Deploy，選 `main` 更新開發站 https://longdong-dev.web.app/。
- 手動執行 Deploy，選 `release` 更新正式站 https://longdong.web.app/（保留原版號標籤）。
- 手動執行 Database rules 時部署 `release` 規則，會立即影響正式站；須明確要求。
- Data sync 每天自動檢查，也支援手動執行。資料變動時建立／更新 PR 並跑 CI；**PR 經合併後**自動部署資料，不會自行合併 PR。
- 潮汐預報只在手動部署時重新抓取，不再每週自動更新。

## ChatGPT 一般對話的開發站部署

使用者明確說「部署龍洞開發站」或「部署 Longdong dev」時，可透過已連線的 GitHub 工具直接更新 `tocc-climbing/longdong` 的 `chatgpt-deploy` 分支 `deploy-requests/dev.json`。

1. `fetch_file` 讀取該檔 SHA，`update_file` 寫入 `{"action":"deploy","environment":"dev","requestedAt":"<新的 UTC ISO 時間>"}`；每次使用新時間形成新 commit。寫入專用分支，不更動 `main`。
2. ChatGPT 指令的 push 觸發器位於 `.github/workflows/deploy.yml`，監聽 `chatgpt-deploy` 的 `deploy-requests/dev.json`；另一個例外是 `main` 的 `public/data/**` 同步資料提交。確認提交只改這個檔，`action=deploy` 才建置最新 `main` 並發布到開發站。
3. `action=check` 只測試指令通道，不能進行 Firebase 部署。
4. 以 GitHub Actions 的 run 與 job 步驟核對實際 Firebase Hosting 執行結果，不能僅看整體 run success 就宣稱網站已更新。
5. 正式版與 Database rules 不經 ChatGPT 專用指令啟動，必須另外明確手動操作。
