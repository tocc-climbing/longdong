import { useLang } from '../i18n'
import { href } from '../router'
import { usePullTests, useVolunteer } from './store'

/** 拉測回報的圖示：寫字板上打勾 */
function Icon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4h6v3H9zM9 5H6v16h12V5h-3" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  )
}

/** 還沒上傳的出勤數（顯示在入口上）；沒有時不顯示 */
function DraftCount() {
  const n = usePullTests().outings.filter((o) => !o.uploadedAt).length
  return n > 0 ? <span className="pulltest-count">{n}</span> : null
}

/** 手機版頂欄右上（救援按鈕左邊）：拉測志工才有 */
export function PullTestButton({ active }: { active: boolean }) {
  const { t } = useLang()
  if (!useVolunteer()) return null
  return (
    <a className="pulltest-button" href={href.pulltest()} aria-current={active ? 'page' : undefined} aria-label={t('pulltest.title')} title={t('pulltest.title')}>
      <Icon size={24} />
      <DraftCount />
    </a>
  )
}

/** 電腦版側欄（編輯模式下面）：拉測志工才有 */
export function PullTestNav({ active }: { active: boolean }) {
  const { t } = useLang()
  if (!useVolunteer()) return null
  return (
    <a href={href.pulltest()} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
      <Icon size={20} />
      {t('pulltest.title')}
      <DraftCount />
    </a>
  )
}
