import { useIsAdmin } from '../admin'
import { DesktopView } from '../admin/DesktopView'
import { MobileView } from '../admin/MobileView'
import { useAdminModel, type AdminSection } from '../admin/useAdminModel'
import { SignInPrompt } from '../components/SignInPrompt'
import type { LoadedData } from '../data/dataset'
import { useLang } from '../i18n'
import { useWide } from '../layout'
import { useCloud } from '../personal/sync'
import './AdminPage.css'

export type AdminTab = AdminSection

/**
 * 管理（/admin）：使用者輸入的所有資料——待處理的檢舉、留言與評分、Topo／地圖／說明／岩壁的修改、使用者、地圖回報。
 * 電腦版與手機版是兩種版面（src/admin/DesktopView.tsx、MobileView.tsx），資料與操作共用（useAdminModel）。
 * 入口只顯示給管理員（src/admin.ts）；讀取與刪除的權限由資料庫規則把關。
 */
export function AdminPage({ data, initialTab = 'all' }: { data: LoadedData; initialTab?: AdminTab }) {
  const { t } = useLang()
  const cloud = useCloud()
  const admin = useIsAdmin()
  const wide = useWide()
  const m = useAdminModel(data, !!admin, initialTab)

  return (
    <article className={`admin ${wide ? 'wide' : 'narrow'}${m.section === 'map' ? ' admin-map' : ''}`}>
      <h1>{t('admin.title')}</h1>
      {cloud.status !== 'signed-in' ? (
        <SignInPrompt message={t('reports.signIn')} />
      ) : admin === undefined ? (
        <p className="muted">{t('app.loading')}</p>
      ) : !admin ? (
        <p className="muted">{t('reports.notAdmin')}</p>
      ) : (
        <>
          {m.error && (
            <p className="error" role="alert">
              {t('reports.loadFailed', { error: m.error })}
            </p>
          )}
          {!m.error && !m.raw && m.section !== 'map' && <p className="muted">{t('app.loading')}</p>}
          {wide ? <DesktopView m={m} data={data} /> : <MobileView m={m} data={data} />}
        </>
      )}
    </article>
  )
}
