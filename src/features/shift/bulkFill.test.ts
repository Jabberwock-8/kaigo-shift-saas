import { describe, expect, it } from 'vitest'
import { bulkFillDays, planBulkFill, type BulkFillRequest, type BulkFillContext } from './bulkFill'

// 2026-11-01 は日曜。平日は 2〜6, 9〜13, 16〜20, 23〜27, 30 の21日
const base: BulkFillRequest = {
  yearMonth: '2026-11',
  daysInMonth: 30,
  staffIds: ['a'],
  patternId: 'B1',
  mode: 'weekdays',
  customWeekdays: [],
  fromDay: 1,
  toDay: 30,
}
const emptyCtx: BulkFillContext = { assignments: {}, locks: {}, wishes: [], canUsePattern: () => true }

describe('bulkFillDays', () => {
  it('平日は月〜金、土日は土日、曜日指定はその曜日', () => {
    expect(bulkFillDays(base)).toHaveLength(21)
    expect(bulkFillDays(base).slice(0, 6)).toEqual([2, 3, 4, 5, 6, 9])
    expect(bulkFillDays({ ...base, mode: 'weekend' })).toEqual([1, 7, 8, 14, 15, 21, 22, 28, 29])
    expect(bulkFillDays({ ...base, mode: 'custom', customWeekdays: [3] })).toEqual([4, 11, 18, 25])
  })

  it('期間で絞る。月の外の日は含めない', () => {
    expect(bulkFillDays({ ...base, fromDay: 9, toDay: 13 })).toEqual([9, 10, 11, 12, 13])
    expect(bulkFillDays({ ...base, fromDay: 0, toDay: 40 })).toHaveLength(21)
    expect(bulkFillDays({ ...base, fromDay: 20, toDay: 10 })).toEqual([])
  })
})

describe('planBulkFill（空いているマスだけ）', () => {
  it('勤務表が無い月（undefined）でも全部の平日に入る', () => {
    const plan = planBulkFill(base, { ...emptyCtx, assignments: undefined, locks: undefined })
    expect(plan.cells).toHaveLength(21)
    expect(plan.staffCount).toBe(1)
  })

  it('入力済み・ロック済み・希望のある日・選べない勤務は飛ばし、内訳を数える', () => {
    const plan = planBulkFill(
      { ...base, staffIds: ['a', 'b'], fromDay: 2, toDay: 6 },
      {
        assignments: { a: { '2': 'OFF' } },
        locks: { a: { '3': true } },
        wishes: [
          { staffId: 'a', date: '2026-11-04', status: 'approved' },
          { staffId: 'a', date: '2026-11-05', status: 'rejected' }, // 却下は数えない＝入れる
        ],
        canUsePattern: (id) => id === 'a',
      },
    )
    expect(plan.cells).toEqual([
      { staffId: 'a', day: 5 },
      { staffId: 'a', day: 6 },
    ])
    expect(plan.staffCount).toBe(1)
    expect(plan.skipped).toEqual({ filled: 1, locked: 1, wish: 1, notAllowed: 5 })
  })

  it('ロックだけで空のマス（値なし）は、ロックとして飛ばす', () => {
    const plan = planBulkFill({ ...base, fromDay: 2, toDay: 2 }, { ...emptyCtx, locks: { a: { '2': true } } })
    expect(plan.cells).toEqual([])
    expect(plan.skipped.locked).toBe(1)
  })
})
