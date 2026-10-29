import { navigate } from '../router'
import { useTextEdits, currentText, type TextTarget } from './textEdits'
import { useLongPress } from './useLongPress'

/**
 * 區域、路線說明：有岩友修改的版本就顯示最新的那一版，沒有修改時顯示原文（TOCC）；兩者都沒有就不顯示。
 * 誰、何時修改與 TOCC 原文在頁面上方的修改記錄（PageTools），編輯也從那裡進入。
 * editTo（手機版的路線頁）：點一下或長按整段就進入編輯。
 */
export function CommunityText({ target, original, title, editTo }: { target: TextTarget; original?: string; title: string; editTo?: string }) {
  const text = currentText(useTextEdits()[target])?.text ?? original
  const press = useLongPress(() => editTo && navigate(editTo))
  if (!text) return null
  const body = (
    <>
      <h2>{title}</h2>
      <p className="pre">{text}</p>
    </>
  )
  return editTo ? (
    <section className="route-block community-text">
      <a className="community-edit" href={editTo} {...press}>
        {body}
      </a>
    </section>
  ) : (
    <section className="route-block community-text">{body}</section>
  )
}
