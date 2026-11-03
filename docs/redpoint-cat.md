# 龍洞 × 紅點貓照片合作

合作頁：`/collaboration`，入口位於「我的」、「關於」與電腦版側欄。

## 目前流程

岩友登入既有 Google 帳號後，另外授權 `https://www.googleapis.com/auth/drive.file`。上傳前須同意公開分享與紅點貓的岩壁辨識學習用途。

每批照片在岩友自己的 Google Drive 建立新的「龍洞 × 紅點貓」資料夾，設定 `anyone / reader`、`allowFileDiscovery: false`。原始照片放進此資料夾，繼承分享權限；不更動其他 Drive 檔案。照片不經過 Firebase Storage，也不寫入本站資料庫。

照片可附上選填的 `properties.area`、`properties.sector`，內容為現有資料庫的區域／分區 ID。檔名與原始影像保留，包括原檔中可能存在的位置等拍照資料。每張照片分別呈現結果，重試時只傳未完成的照片。離開頁面會取消仍在進行的傳輸。

上傳後提供資料夾連結與複製按鈕。岩友可在 Google Drive 管理分享或刪除照片。頁面不保留 Drive OAuth 權杖到永久儲存空間。

## Google 設定與驗證範圍

沿用 Firebase 的 Google 登入用戶端，不需在前端加入新密鑰。正式使用前，管理員須確認該 OAuth 用戶端所屬 Google Cloud 專案已啟用 Google Drive API，並在 OAuth 同意畫面設定 `drive.file` 權限。Workspace 帳號仍可能受其組織禁止公開分享的政策限制。

`tests/collaborationDrive.test.ts` 驗證 Drive 請求與失敗處理。`scripts/e2e-collaboration.ts` 由既有 `scripts/e2e-edit.ts` 執行：登入走 Firebase 模擬器，另以路由補入假的 OAuth 權杖並模擬 Drive API，確認公開範圍、同意條件、照片內容、標籤、重試、分享遭拒與複製連結。這些測試不代表已對真人 Google Drive 執行上傳。

## 紅點貓對接

使用者提供的參考專案：<https://github.com/climb-io/climbio-internal>。目前環境無讀取權限，未確認其照片收件 API、資料格式或服務網址。

現階段完成個人 Drive 上傳與可提供給紅點貓的資料夾連結；不會把此連結自動送往未確認的端點，也不宣稱已啟動模型訓練。取得對接文件後，再接上連結提交／收件回應。未建立可供所有人列舉的公開資料夾索引。
