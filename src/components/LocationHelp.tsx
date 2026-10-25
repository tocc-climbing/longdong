import { useState } from 'react'
import { useLang } from '../i18n'
import { Sheet } from './Sheet'

/** 定位被拒絕時的「怎麼開啟」：按鈕開啟步驟面板（iPhone、Android 各三步） */
export function LocationHelp() {
  const { t } = useLang()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="action loc-help-button" onClick={() => setOpen(true)}>
        {t('locHelp.open')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('locHelp.title')}>
        <h3>iPhone</h3>
        <ol className="loc-help-steps">
          <li>{t('locHelp.ios1')}</li>
          <li>{t('locHelp.ios2')}</li>
          <li>{t('locHelp.reload')}</li>
        </ol>
        <h3>Android</h3>
        <ol className="loc-help-steps">
          <li>{t('locHelp.android1')}</li>
          <li>{t('locHelp.android2')}</li>
          <li>{t('locHelp.reload')}</li>
        </ol>
        <div className="actions">
          <button type="button" className="action primary" onClick={() => setOpen(false)}>
            {t('locHelp.close')}
          </button>
        </div>
      </Sheet>
    </>
  )
}
