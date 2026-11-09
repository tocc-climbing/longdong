import { HANGER, HangerIcon } from '../components/HangerIcon'
import { useLang } from '../i18n'
import { href } from '../router'
import { usePullTests, useVolunteer } from './store'

/** 頂欄的圖示：和救援按鈕同一種樣式（實心圓角方塊＋白色圖形），圖形是掛片 */
function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path className="pulltest-glyph" d={HANGER} fillRule="evenodd" transform="translate(3.64 2.24) scale(0.08)" />
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
      <BoxIcon />
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
      <HangerIcon />
      {t('pulltest.title')}
      <DraftCount />
    </a>
  )
}
