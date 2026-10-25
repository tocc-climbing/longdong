import { LOCALES, useLang } from '../i18n'
import { href } from '../router'
import { displayName, useSocial } from '../social/store'
import { currentText, useTextEdits, type TextTarget } from './textEdits'

/**
 * 區域、路線說明：有岩友修改的版本就顯示最新的那一版，標明誰、何時修改，原文（TOCC）可以展開；
 * 沒有修改時顯示原文。「修改說明」開修改模式的這個項目。沒有原文也沒有修改時只顯示撰寫的連結（compact）。
 */
export function CommunityText({ target, original, title }: { target: TextTarget; original?: string; title: string }) {
  const { lang, t } = useLang()
  const versions = useTextEdits()
  const { profiles } = useSocial()
  const edited = currentText(versions[target])
  const editLink = (
    <a className="small community-edit" href={href.edit('text', target)}>
      {t(edited || original ? 'text.edit' : 'text.write')}
    </a>
  )
  if (!edited && !original) return <p className="community-empty">{editLink}</p>
  return (
    <section className="route-block community-text">
      <h2>
        {title}
        {editLink}
      </h2>
      <p className="pre">{edited?.text ?? original}</p>
      {edited && (
        <p className="muted small">
          {t('text.editedBy', { name: displayName(profiles, edited.uid), date: new Date(edited.createdAt).toLocaleDateString(LOCALES[lang]) })}
        </p>
      )}
      {edited && original && (
        <details className="community-original">
          <summary className="small">{t('text.original')}</summary>
          <p className="pre small">{original}</p>
        </details>
      )}
    </section>
  )
}
