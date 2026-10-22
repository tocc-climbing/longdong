import type { LoadedData } from '../data/dataset'
import type { Bolt } from '../data/schema'
import { formatDate, yearsSince } from '../format'
import { useLang } from '../i18n'

/** 路線的 Bolt 或 Anchor：位置、材質、安裝日期（幾年前）、最近一次拉測 */
export function BoltTable({ title, bolts, data }: { title: string; bolts: Bolt[]; data: LoadedData }) {
  const { t } = useLang()
  return (
    <section>
      <h2>{title}</h2>
      <div className="table-wrap">
        <table className="bolts">
          <thead>
            <tr>
              <th>{t('bolt.position')}</th>
              <th>{t('bolt.material')}</th>
              <th>{t('bolt.installed')}</th>
              <th>{t('bolt.lastTest')}</th>
            </tr>
          </thead>
          <tbody>
            {bolts.map((b) => {
              const desc = data.hardwareByCode.get(b.material)
              const years = yearsSince(b.installed)
              return (
                <tr key={b.position} className={desc ? '' : 'muted'}>
                  <td className="mono">{b.position}</td>
                  <td>
                    {b.material}
                    {desc && <span className="sub">{desc}</span>}
                  </td>
                  <td>
                    {b.installed ? formatDate(b.installed) : '—'}
                    {years !== undefined && <span className="sub">{t('time.years', { n: years })}</span>}
                  </td>
                  <td>{b.tests[0] ? formatDate(b.tests[0]) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
