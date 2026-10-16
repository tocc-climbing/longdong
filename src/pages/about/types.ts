/** 關於頁的說明文字（每種語言一個檔案，切換語言時才載入） */
export interface AboutTextProps {
  /** 路線資料的維護單位與網址（TOCC 固定點更新計畫） */
  projectUrl: string
  /** 中文的單位名稱（資料檔裡的 attribution） */
  attribution: string
  /** Google Sheet 的網址 */
  sheetUrl: string
}
