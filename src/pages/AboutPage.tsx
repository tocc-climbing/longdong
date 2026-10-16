import { lazy, Suspense } from 'react'
import type { LoadedData } from '../data/dataset'
import { SafetyLight } from '../components/SafetyLight'
import type { Safety } from '../data/schema'
import { formatDate } from '../format'
import { useLang, type Lang } from '../i18n'

/** 關於頁的長篇說明每種語言一個檔案，用到時才載入；資料表、圖例共用 */
const ABOUT_TEXT: Record<Lang, ReturnType<typeof lazy<typeof import('./about/zh').default>>> = {
  zh: lazy(() => import('./about/zh')),
  en: lazy(() => import('./about/en')),
  ja: lazy(() => import('./about/ja')),
}

export function AboutPage({ data }: { data: LoadedData }) {
  const { lang, t } = useLang()
  const { dataset } = data
  const AboutText = ABOUT_TEXT[lang]

  return (
    <article className="prose">
      <h1>{t('about.title')}</h1>

      <Suspense fallback={<p className="muted">{t('app.loading')}</p>}>
        <AboutText projectUrl={dataset.source.projectUrl} attribution={dataset.source.attribution} sheetUrl={dataset.source.url} />
      </Suspense>

      <dl className="kv">
        <dt>{t('about.dataUpdated')}</dt>
        <dd>{formatDate(dataset.updatedAt.slice(0, 10))}</dd>
        <dt>{t('about.dataVersion')}</dt>
        <dd className="mono">{dataset.version}</dd>
        <dt>{t('about.dataLicense')}</dt>
        <dd>{dataset.license}</dd>
        <dt>{t('about.codeLicense')}</dt>
        <dd>MIT</dd>
      </dl>

      <h2>{t('about.safety')}</h2>
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

      <h2>{t('about.materials')}</h2>
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
