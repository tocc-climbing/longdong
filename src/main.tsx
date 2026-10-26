// 必須最早載入：瀏覽器的安裝事件可能在畫面出現前就發出
import './install'
import './theme'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initI18n } from './i18n'
import { startCloud } from './personal/sync'
import { startCalibrationSync } from './map/calibration'
import './styles.css'

// 網站是 App 模式，畫面不能縮放（index.html 的 viewport）：iOS Safari 忽略 user-scalable=no，另外擋掉雙指縮放手勢；
// 地圖自己處理雙指縮放（src/map/useMapGestures.ts，pointer 事件），不受影響
document.addEventListener('gesturestart', (e) => e.preventDefault())

// 請瀏覽器把離線資料標為持久保存，降低被系統清除的機會（iOS 需先加入主畫面）
navigator.storage?.persist?.().catch(() => {})

// 曾經登入過的裝置，自動恢復雲端同步（沒登入過的不會載入 Firebase）
startCloud()
// 回報在背景上傳，不必停在地圖頁
startCalibrationSync()

// 先載入目前語言的語言包再顯示畫面（語言包分開打包，只載入用到的那一個）
void initI18n().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
