import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { gradeValue, parseDate, splitName, cleanText } from '../scripts/lib/normalize'
import { attachLegacySectorIds, parseAreaSheet, parseHardwareSheet, sectorId } from '../scripts/lib/parse'
import type { Area } from '../src/data/schema'

const HEADER = ['分區', '路線編號', '路線名稱', '難度', '路線種類', '高度', '首攀', '首攀日期', '路線資訊描述', '安全評級',
  'B01', 'B02', 'A01', 'A02', 'Anchor 配件', '', 'Bolt 統計', '路線狀態', '日期', '備註']

/** 用欄位名稱組出一列，其餘欄位留空 */
function row(cells: Record<string, string>): string[] {
  const used = new Map<string, number>()
  return HEADER.map((h) => {
    const key = h === '' ? `_${(used.get('') ?? 0) + 1}` : h
    if (h === '') used.set('', (used.get('') ?? 0) + 1)
    return cells[key] ?? ''
  })
}

function sheet(rows: string[][]): string {
  return Papa.unparse([['  後門\n  Back Door', '4', '支 Bolt', '2', '條攀登路線'], HEADER, ...rows])
}

describe('normalize', () => {
  it('把康熙部首字元轉成一般漢字', () => {
    expect(cleanText('⽯克偉')).toBe('石克偉')
  })

  it('拆出中英文名稱', () => {
    expect(splitName('別撈過界\nDon\'t Cross the Line')).toEqual({ zh: '別撈過界', en: "Don't Cross the Line" })
    expect(splitName('第一洞內\n南面\nInterior\nSouth End')).toEqual({ zh: '第一洞內 南面', en: 'Interior South End' })
    expect(splitName('Verdon 在台灣\nVerdon du Taiwan')).toEqual({ zh: 'Verdon 在台灣', en: 'Verdon du Taiwan' })
  })

  it('解析各種日期格式', () => {
    expect(parseDate('2018 / 04 / 14 (週六)')).toBe('2018-04-14')
    expect(parseDate('1991 / 06')).toBe('1991-06')
    expect(parseDate('2004')).toBe('2004')
    expect(parseDate('20260712')).toBe('2026-07-12')
    expect(parseDate('44192')).toBe('2020-12-27')
    expect(parseDate('20 年')).toBeUndefined()
  })

  it('難度數值可排序', () => {
    expect(gradeValue('5.9')).toBeLessThan(gradeValue('5.10a')!)
    expect(gradeValue('5.10a/b')).toBe(40.5)
    expect(gradeValue('5.10? R')).toBe(41.5)
    expect(gradeValue('5.??')).toBeUndefined()
  })
})

describe('parseAreaSheet', () => {
  const csv = sheet([
    row({ 分區: '地下一樓\nB1', 路線編號: '# 1', 路線名稱: 'ㄅ\nBo', 難度: '5.7', 路線種類: '抱石 | Boulder', 高度: '5 m', 'Bolt 統計': '0' }),
    row({}),
    row({
      路線編號: '# 523', 路線名稱: 'V槽\nV-Groove', 難度: '5.10b', 路線種類: '運攀 | Sport',
      首攀: '王世⿍\n—\nJeff Wang', 路線資訊描述: '說明\n–\n無 Anchor',
      B01: '316-TW', B02: '共用', A01: 'Ti-U', A02: 'Ti-U', 'Anchor 配件': '梅隆鎖-316', _1: '垂降環-316',
      'Bolt 統計': '3', 路線狀態: '已拉測', 日期: '2025 / 12 / 04 (週四)', 備註: '[Pulltest] 全線合格',
    }),
    row({ B01: '2006 / 07 / 30', A01: '2016', 'Anchor 配件': '數量 x2 ', _1: '數量 x2 ' }),
    row({ B01: '20 年', A01: '10 年', 'Anchor 配件': '2020 / 12 / 01', _1: '2020 / 12 / 01' }),
    row({ B01: '2020 / 04 / 16', A01: '2025 / 12 / 04' }),
    row({ B01: '2025 / 12 / 04' }),
    row({ 分區: '地下二樓\nBasement', 路線編號: '# 0', 路線名稱: '私設固定點' }),
    row({ 路線編號: '316-TW', 路線名稱: '316 - 台製', 難度: '358' }),
    row({ 路線編號: '# 999', 路線名稱: '圖例之後不該被讀進來' }),
  ])
  const area = parseAreaSheet(csv, { cragId: 'longdong', areaId: 'back-door', expectedZh: '後門' })
  const routes = area.sectors.flatMap((s) => s.routes)
  const fixtureId = routes[2].id

  it('讀出區域名稱與統計', () => {
    expect(area.name).toEqual({ zh: '後門', en: 'Back Door' })
    expect(area.summary).toEqual({ bolts: 4, routes: 2 })
  })

  it('合併儲存格的分區往下沿用，圖例之後停止', () => {
    expect(area.sectors.map((s) => [s.name.zh, s.routes.map((r) => r.id)])).toEqual([
      ['地下一樓', ['longdong/1', 'longdong/523']],
      ['地下二樓', [fixtureId]],
    ])
  })

  it('解析 bolt 的材質、安裝日期與拉測紀錄', () => {
    const r = routes.find((x) => x.id === 'longdong/523')!
    expect(r.bolts).toEqual([
      { position: 'B01', material: '316-TW', installed: '2006-07-30', tests: ['2025-12-04', '2020-04-16'] },
      { position: 'B02', material: '共用', tests: [] },
    ])
    expect(r.anchors[0]).toEqual({ position: 'A01', material: 'Ti-U', installed: '2016', tests: ['2025-12-04'] })
    expect(r.anchorHardware).toEqual([
      { item: '梅隆鎖-316', quantity: 2, installed: '2020-12-01' },
      { item: '垂降環-316', quantity: 2, installed: '2020-12-01' },
    ])
    expect(r.lastTested).toBe('2025-12-04')
    expect(r.status).toBe('tested')
    expect(r.statusDate).toBe('2025-12-04')
    expect(r.firstAscent).toBe('王世鼎\nJeff Wang')
    expect(r.description).toBe('說明\n\n無 Anchor')
  })

  it('ID 帶岩場前綴；未編號項目的 ID 由區域與名稱決定，不受列順序影響', () => {
    expect(area.id).toBe('longdong/back-door')
    expect(fixtureId).toMatch(/^longdong\/x-[0-9a-f]{8}$/)
    const reordered = sheet([
      row({ 分區: '地下二樓', 路線編號: '# 0', 路線名稱: '私設固定點' }),
      row({ 路線編號: '# 1', 路線名稱: 'ㄅ', 難度: '5.7' }),
    ])
    const again = parseAreaSheet(reordered, { cragId: 'longdong', areaId: 'back-door', expectedZh: '後門' })
    expect(again.sectors[0].routes[0].id).toBe(fixtureId)
  })

  it('沒有難度和種類的項目標為固定點', () => {
    const fixture = routes.find((x) => x.id === fixtureId)!
    expect(fixture.isFixture).toBe(true)
    expect(fixture.number).toBeUndefined()
  })

  it('首攀日期讀不成日期時保留原文，不推測日期', () => {
    const fa = parseAreaSheet(
      sheet([
        row({ 路線編號: '# 1', 路線名稱: 'ㄅ', 難度: '5.7', 首攀: '甲', 首攀日期: '1990年代' }),
        row({ 路線編號: '# 2', 路線名稱: 'ㄆ', 難度: '5.7', 首攀: '乙', 首攀日期: '1990 / 夏' }),
        row({ 路線編號: '# 3', 路線名稱: 'ㄇ', 難度: '5.7', 首攀: '丙', 首攀日期: '1991 / 06' }),
      ]),
      { cragId: 'longdong', areaId: 'back-door', expectedZh: '後門' },
    ).sectors[0].routes
    expect(fa.map((r) => [r.firstAscentDate, r.firstAscentDateLabel])).toEqual([
      [undefined, '1990年代'],
      [undefined, '1990 / 夏'],
      ['1991-06', undefined],
    ])
  })

  it('有燈號但讀不到評級的路線，停止匯入並列出', () => {
    const lights = sheet([
      row({ 路線編號: '# 1', 路線名稱: 'ㄅ', 難度: '5.7', 安全評級: '●●●' }),
      row({ 路線編號: '# 2', 路線名稱: 'ㄆ', 難度: '5.8', 安全評級: '●●●' }),
    ])
    const opts = { cragId: 'longdong', areaId: 'back-door', expectedZh: '後門' }
    expect(() => parseAreaSheet(lights, { ...opts, safety: new Map([[2, 'green' as const]]) })).toThrow(
      /\n {2}第 4 列 #2 ㄆ：讀不到安全評級燈號，Sheet 版面可能變了$/,
    )
  })

  it('路線種類、路線狀態不在對照表時停止匯入，列出原文', () => {
    const unknown = sheet([
      row({ 路線編號: '# 1', 路線名稱: 'ㄅ', 難度: '5.7', 路線種類: '運攀 | Sport', 路線狀態: '已拉測' }),
      row({ 路線編號: '# 2', 路線名稱: 'ㄆ', 路線種類: '冰攀 | Ice' }),
      row({ 路線編號: '# 3', 路線名稱: 'ㄇ', 難度: '5.8', 路線狀態: '施工中' }),
    ])
    expect(() => parseAreaSheet(unknown, { cragId: 'longdong', areaId: 'back-door', expectedZh: '後門' })).toThrow(
      /\n {2}第 4 列 #2 ㄆ：路線種類「冰攀 \| Ice」不在對照表\n {2}第 5 列 #3 ㄇ：路線狀態「施工中」不在對照表$/,
    )
  })

  it('分頁標題不符時報錯', () => {
    expect(() => parseAreaSheet(csv, { cragId: 'longdong', areaId: 'golden-valley', expectedZh: '黃金谷' })).toThrow(/gid/)
  })
})

describe('分區 ID', () => {
  const opts = { cragId: 'longdong', areaId: 'back-door', expectedZh: '後門' }
  const sectorIds = (sectors: string[]) =>
    parseAreaSheet(sheet(sectors.map((zh, i) => row({ 分區: zh, 路線編號: `# ${i + 1}`, 路線名稱: `路線${i}`, 難度: '5.7' }))), opts).sectors.map((s) => [
      s.name.zh,
      s.id,
    ])

  it('由區域與中文名稱決定，每次、每個平台都相同', () => {
    expect(sectorId('longdong', 'back-door', '地下一樓')).toBe('longdong/back-door-92kxxd')
  })

  it('插入或調換分區不影響其他分區的 ID', () => {
    const before = sectorIds(['地下一樓\nB1', '地下二樓'])
    const after = sectorIds(['新分區', '地下二樓', '地下一樓\nB1'])
    for (const [zh, id] of before) expect(after).toContainEqual([zh, id])
  })

  it('同區域兩個分區的 ID 相同時停止匯入', () => {
    // 這兩個名稱的雜湊剛好相同
    expect(() => sectorIds(['分區1333', '分區15999'])).toThrow('[back-door] 分區「分區1333」與「分區15999」的 ID 相同')
  })

  it('掛上凍結的舊 ID，回報對不到的舊 ID', () => {
    const area = { sectors: [{ id: 'longdong/a-92kxxd', routes: [] }, { id: 'longdong/a-ikx7n4', routes: [] }] } as unknown as Area
    const orphans = attachLegacySectorIds([area], { 'longdong/a-s2': 'longdong/a-92kxxd', 'longdong/a-s9': 'longdong/a-gone00' })
    expect(area.sectors.map((s) => s.legacyIds)).toEqual([['longdong/a-s2'], undefined])
    expect(orphans).toEqual(['longdong/a-s9'])
  })
})

describe('舊的分區 ID 對照（scripts/data/legacy-sector-ids.json）', () => {
  const legacy = JSON.parse(readFileSync(new URL('../scripts/data/legacy-sector-ids.json', import.meta.url), 'utf8')) as Record<string, string>
  const data = JSON.parse(readFileSync(new URL('../public/data/longdong.json', import.meta.url), 'utf8')) as { areas: Area[] }

  it('每個舊 ID 都掛在資料檔中同區域的分區上', () => {
    const attached = new Map(data.areas.flatMap((a) => a.sectors.flatMap((s) => (s.legacyIds ?? []).map((old) => [old, s.id] as const))))
    expect(Object.fromEntries(attached)).toEqual(legacy)
    for (const [old, id] of Object.entries(legacy)) expect(id.replace(/-[0-9a-z]{6}$/, '')).toBe(old.replace(/-s\d+$/, ''))
  })
})

describe('parseHardwareSheet', () => {
  it('讀出材質代號對照表', () => {
    const csv = Papa.unparse([
      ['', '各區錨栓統計表'],
      ['', 'Bolt 代號', '材質 - 廠牌 - 型號', '後門'],
      ['', '304-FX', '304 - Fixe', '0'],
      ['', 'Ti-U', 'Ti - Titan Climbing - U形', '13'],
      ['', '統計', '', '440'],
    ])
    expect(parseHardwareSheet(csv)).toEqual([
      { code: '304-FX', description: '304 - Fixe' },
      { code: 'Ti-U', description: 'Ti - Titan Climbing - U形' },
    ])
  })
})
