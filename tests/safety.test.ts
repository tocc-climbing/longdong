import { describe, expect, it } from 'vitest'
import { parseSafetyHtml } from '../scripts/lib/safety'

const dots = (a: string, b: string, c: string) =>
  `<td class="s24" rowspan="3"><span style="color:${a};">●</span><span style="color:${b};">●</span><span style="color:${c};">●</span></td>`
const tr = (row: number, cells: string) =>
  `<tr style="height: 19px"><th id="123R${row}" style="height: 19px;"><div>${row + 1}</div></th><td># 1</td>${cells}</tr>`

describe('parseSafetyHtml', () => {
  it('以亮起的燈判斷評級，灰色為尚未評級', () => {
    const html = [
      tr(2, dots('#ffe3e3', '#fff2cc', '#6aa84f')),
      tr(3, '<td>B01</td>'),
      tr(5, dots('#ffe3e3', '#f1c232', '#d9ead3')),
      tr(8, dots('#CC0000', '#fff2cc', '#d9ead3')),
      tr(11, '<td class="s79" rowspan="3">●●●</td>'),
    ].join('')
    expect([...parseSafetyHtml(html, '123', 'back-door')]).toEqual([
      [2, 'green'],
      [5, 'yellow'],
      [8, 'red'],
      [11, null],
    ])
  })

  it('亮燈不是剛好一顆時停止匯入，列出這些列（Sheet 的列號）', () => {
    const html = [
      tr(2, dots('#ffe3e3', '#fff2cc', '#6aa84f')),
      tr(14, dots('#cc0000', '#f1c232', '#d9ead3')),
      tr(17, dots('#ffe3e3', '#fff2cc', '#d9ead3')),
    ].join('')
    expect(() => parseSafetyHtml(html, '123', 'back-door')).toThrow('[back-door] 第 15、18 列：安全評級燈號無法判讀')
  })

  it('只讀指定分頁的列', () => {
    expect(parseSafetyHtml(tr(2, dots('#ffe3e3', '#fff2cc', '#6aa84f')), '999', 'back-door').size).toBe(0)
  })
})

import { parseTitleColor } from '../scripts/lib/safety'

describe('parseTitleColor', () => {
  it('讀出標題列儲存格的底色', () => {
    const html =
      '<style>.ritz .waffle .s0{border:1px;background-color:#CC0000;color:#fff;}.ritz .waffle .s6{background-color:#ffffff;}</style>' +
      '<tr><th id="123R0"><div>1</div></th><td class="s0">後門</td></tr><tr><th id="123R1"></th><td class="s6">分區</td></tr>'
    expect(parseTitleColor(html, '123')).toBe('#cc0000')
    expect(parseTitleColor(html, '999')).toBeUndefined()
  })
})
