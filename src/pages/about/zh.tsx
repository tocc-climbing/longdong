import type { AboutTextProps } from './types'

export default function AboutText({ projectUrl, attribution, sheetUrl }: AboutTextProps) {
  return (
    <>
      <p className="alert">本站資料僅供參考。岩壁與固定點隨時可能改變，攀登前請自行確認現場，並為自己的安全負責。</p>

      <h2>離線使用</h2>
      <p>第一次開啟後，App 與全部路線資料會存在手機上，沒有訊號也能用。iPhone 請「加入主畫面」，離線資料才不會被清除。</p>

      <h2>帳號與隱私</h2>
      <p>
        使用 Google 帳號登入。收藏與攀登紀錄只有你自己看得到；留言會公開並顯示你的暱稱；評分在畫面上只顯示平均與人數。Email
        不會公開。資料存放在臺灣戶外攀岩協會的 Firebase 專案。不當留言請按「檢舉」，由管理員處理。詳見
        <a href="./terms.html">服務條款</a>與<a href="./privacy.html">隱私權政策</a>；要刪除帳號與所有資料，請到「我的」頁的設定。
      </p>

      <h2>資料來源</h2>
      <p>
        路線與 Bolt 資料由
        <a href={projectUrl} target="_blank" rel="noreferrer">
          {attribution}
        </a>
        維護於
        <a href={sheetUrl} target="_blank" rel="noreferrer">
          Google Sheet
        </a>
        ，本站每天檢查更新，確認後上線。發現資料有誤，請聯絡協會更正。
      </p>
    </>
  )
}
