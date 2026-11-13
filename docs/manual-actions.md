# GitHub Actions 手動操作與 ChatGPT 部署

快速迭代期間，CI、資料同步、Firebase 規則部署、網站部署都只在手動要求時執行。
一般推送 `main`、`release`、建立 PR，或時間排程都不自動執行。
GitHub Actions → CI／Data sync／Database rules／Deploy → Run workflow。

- 手動執行 Deploy，選 `main` 更新開發站 https://longdong-dev.web.app/。
- 手動執行 Deploy，選 `release` 更新正式站 https://longdong.web.app/（保留原版號標籤）。
- 手動執行 Database rules 時部署 `release` 規則，會立即影響正式站；須明確要求。
- 手動執行 Data sync 會建立／更新資料 PR，但不會自動再啟動 CI，也不會部署。
- 潮汐預報只在手動部署時重新抓取，不再每週自動更新。

## ChatGPT 一般對話的開發站部署

使用者明確說「部署龍洞開發站」或「部署 Longdong dev」時，可透過已連線的 GitHub 工具直接更新 `tocc-climbing/longdong` 的 `chatgpt-deploy` 分支 `deploy-requests/dev.json`。

1. `fetch_file` 讀取該檔 SHA，`update_file` 寫入 `{"action":"deploy","environment":"dev","requestedAt":"<新的 UTC ISO 時間>"}`；每次使用新時間形成新 commit。寫入專用分支，不更動 `main`。
2. 唯一允許的 push 觸發器位於 `.github/workflows/deploy.yml`，僅監聽 `chatgpt-deploy` 的 `deploy-requests/dev.json`。確認提交只改這個檔，`action=deploy` 才建置最新 `main` 並發布到開發站。
3. `action=check` 只測試指令通道，不能進行 Firebase 部署。
4. 以 GitHub Actions 的 run 與 job 步驟核對實際 Firebase Hosting 執行結果，不能僅看整體 run success 就宣稱網站已更新。
5. 正式版與 Database rules 不經 ChatGPT 專用指令啟動，必須另外明確手動操作。
