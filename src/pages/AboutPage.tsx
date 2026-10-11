import type { LoadedData } from '../data/dataset'
import { SafetyLight } from '../components/SafetyLight'
import type { Safety } from '../data/schema'
import { formatDate } from '../format'
import { useLang } from '../i18n'

/** 關於頁：說明文字較長，中英文各寫一份；圖例與資料表共用 */
export function AboutPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const { dataset } = data
  const zh = lang === 'zh'
  const source = (
    <a href={dataset.source.projectUrl} target="_blank" rel="noreferrer">
      {zh ? dataset.source.attribution : "TOCC (Taiwan Outdoor Climbers' Coalition) Rebolting Project"}
    </a>
  )
  const sheet = (
    <a href={dataset.source.url} target="_blank" rel="noreferrer">
      Google Sheet
    </a>
  )
  const legal = zh ? (
    <>
      詳見<a href="./terms.html">服務條款</a>與<a href="./privacy.html">隱私權政策</a>；要刪除帳號與所有資料，請到「我的」頁的設定。
    </>
  ) : (
    <>
      See the <a href="./terms.html">Terms of Service</a> and <a href="./privacy.html">Privacy Policy</a>. To delete your account and all
      data, open settings on the Me tab.
    </>
  )

  return (
    <article className="prose">
      <h1>{t('about.title')}</h1>

      {zh ? (
        <>
          <p className="alert">本站資料僅供參考。岩壁與固定點狀況隨時可能改變，攀登前請自行檢查現場，並為自己的安全負責。</p>

          <h2>離線使用</h2>
          <p>
            第一次開啟後，App 與全部路線資料就會存在手機上，在龍洞沒有訊號的地方也能查詢。
            建議用瀏覽器的「加入主畫面」安裝，iOS 上才不會被系統清掉離線資料。
          </p>

          <h2>帳號與隱私</h2>
          <p>
            登入使用 Google 帳號。收藏和攀登紀錄只有你自己看得到；評分和留言會公開，顯示你設定的暱稱，Email 不會公開。
            資料存放在臺灣戶外攀岩協會的 Firebase 專案。不當留言可以按「檢舉」，由管理員處理。{legal}
          </p>

          <h2>資料來源</h2>
          <p>
            路線與 Bolt 資料由{source}維護於{sheet}，本站每天檢查更新，經確認後上線。發現資料有誤，請聯絡協會更正。
          </p>
        </>
      ) : (
        <>
          <p className="alert">
            This information is for reference only. Rock and anchors can change at any time — inspect everything on site and climb at your
            own risk.
          </p>

          <h2>Offline use</h2>
          <p>
            After your first visit, the app and all route data are stored on your phone, so it works in the many parts of Long Dong without
            signal. Add it to your home screen (Share → Add to Home Screen on iPhone) so the offline data isn't cleared.
          </p>

          <h2>Account & privacy</h2>
          <p>
            Sign in with Google. Your climb log and favorites are private; ratings and comments are public under your nickname, and your
            email is never shown. Data is stored in TOCC's Firebase project. Use “Report” on inappropriate comments and a moderator will
            review them. {legal}
          </p>

          <h2>Data source</h2>
          <p>
            Route and bolt data are maintained by the {source} in a {sheet} and checked for updates daily, then published after review. Report errors to TOCC. Route descriptions
            and notes are available in Chinese only.
          </p>
        </>
      )}

      <dl className="kv">
        <dt>{zh ? '資料更新' : 'Data updated'}</dt>
        <dd>{formatDate(dataset.updatedAt.slice(0, 10))}</dd>
        <dt>{zh ? '資料版本' : 'Data version'}</dt>
        <dd className="mono">{dataset.version}</dd>
        <dt>{zh ? '資料授權' : 'Data license'}</dt>
        <dd>{dataset.license}</dd>
        <dt>{zh ? '程式授權' : 'Code license'}</dt>
        <dd>MIT</dd>
      </dl>

      <h2>{zh ? '安全評級' : 'Safety rating'}</h2>
      <dl className="kv legend">
        {(['green', 'yellow', 'red'] as Safety[]).map((s) => (
          <div key={s} className="kv-row">
            <dt>
              <SafetyLight safety={s} />
            </dt>
            <dd>{t(`safety.${s}`)}</dd>
          </div>
        ))}
        <div className="kv-row">
          <dt>
            <SafetyLight />
          </dt>
          <dd>{t('safety.unrated')}</dd>
        </div>
      </dl>

      <h2>{zh ? '材質代號' : 'Bolt material codes'}</h2>
      <dl className="kv">
        {dataset.hardware.map((h) => (
          <div key={h.code} className="kv-row">
            <dt className="mono">{h.code}</dt>
            <dd>{h.description}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}
