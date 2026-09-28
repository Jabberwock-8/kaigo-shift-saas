import { describe, expect, it } from 'vitest'
import { weeksOfMonth } from './dateUtils'

describe('weeksOfMonth', () => {
  it('月曜始まりで区切り、月をまたがない（2026年9月は1日が火曜）', () => {
    const weeks = weeksOfMonth('2026-09')
    expect(weeks[0]).toEqual([1, 2, 3, 4, 5, 6])
    expect(weeks[1]).toEqual([7, 8, 9, 10, 11, 12, 13])
    expect(weeks.at(-1)).toEqual([28, 29, 30])
    expect(weeks.flat()).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
  })

  it('1日が月曜なら最初の週は7日ある（2026年6月）', () => {
    const weeks = weeksOfMonth('2026-06')
    expect(weeks[0]).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(weeks).toHaveLength(5)
  })
})
