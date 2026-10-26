import { useTextEdits, currentText, type TextTarget } from './textEdits'

/**
 * 區域、路線說明：有岩友修改的版本就顯示最新的那一版，沒有修改時顯示原文（TOCC）；兩者都沒有就不顯示。
 * 誰、何時修改與 TOCC 原文在頁面上方的修改記錄（PageTools），編輯也從那裡進入。
 */
export function CommunityText({ target, original, title }: { target: TextTarget; original?: string; title: string }) {
  const text = currentText(useTextEdits()[target])?.text ?? original
  if (!text) return null
  return (
    <section className="route-block community-text">
      <h2>{title}</h2>
      <p className="pre">{text}</p>
    </section>
  )
}
