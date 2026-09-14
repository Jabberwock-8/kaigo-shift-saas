import type { RuleDays } from '../../types/models'
import { formatDate, weekdayOf } from '../../lib/dateUtils'

/**
 * ルールの「対象日」が指定の日に当てはまるか。
 * check.ts（違反チェック）と demand.ts（必要人数算出。Phase 4d-1）で共用する。
 */
export function ruleAppliesToDate(days: RuleDays, yearMonth: string, day: number): boolean {
  const w = weekdayOf(yearMonth, day)
  switch (days.type) {
    case 'all':
      return true
    case 'weekdays':
      return w >= 1 && w <= 5
    case 'weekend':
      return w === 0 || w === 6
    case 'dow':
      return ((days.values as number[] | undefined) ?? []).includes(w)
    case 'dates':
      return ((days.values as string[] | undefined) ?? []).includes(formatDate(yearMonth, day))
    default:
      return false
  }
}
