import { describe, expect, it } from 'vitest'
import { buildShiftSheetRows } from './exportShiftExcel'

const A = { id: 'a', code: 'A2', label: '早出', isWork: true, isNight: false }
const OFF = { id: 'off', code: '公休', label: '公休', isWork: false, isNight: false, category: 'off' as const }

describe('buildShiftSheetRows', () => {
  it('見出し・曜日・行事・職員・兼務行・日別集計の順に、記号と集計を並べる', () => {
    const rows = buildShiftSheetRows({
      facilityName: 'テスト施設',
      yearMonth: '2026-09',
      days: [1, 2],
      staffList: [
        { id: 's1', name: '山田', active: true, traits: ['生活相談員'] },
        { id: 's2', name: '佐藤', active: true },
      ],
      shiftPatterns: [A, OFF],
      assignments: { s1: { '1': 'a', '2': 'off' }, s2: { '1': 'off', '2': 'a' } },
      secondaryAssignments: { s1: { '2': 'a' } },
      events: { '1': '避難訓練' },
      summaryPatterns: [A, OFF],
      workPatterns: [A],
      tallyText: (pid, d) => (pid === 'a' ? `1/${d}` : ''),
      fteFor: (id) => (id === 's1' ? 0.5 : null),
    })
    expect(rows[0][0]).toContain('2026年9月')
    expect(rows[1]).toEqual(['職員', 1, 2, 'A2', '公休', '常勤換算'])
    expect(rows[2]).toEqual(['', '火', '水', '', '', ''])
    expect(rows[3]).toEqual(['行事', '避難訓練', '', '', '', ''])
    expect(rows[4]).toEqual(['山田', 'A2', '公休', 1, 1, 0.5])
    expect(rows[5]).toEqual(['└ 生活相談員', '', 'A2', '', '', ''])
    expect(rows[6]).toEqual(['佐藤', '公休', 'A2', 1, 1, ''])
    expect(rows[7]).toEqual(['A2 計', '1/1', '1/2', '', '', ''])
  })
})
