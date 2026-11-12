import { describe, expect, it } from 'vitest'
import { collectStaffRulePatternRefs, findPatternUsages, type PatternUsageSources } from './patternUsage'
import { monthsWithStaffEntries } from '../../lib/staffUtils'
import type { Rule, Staff } from '../../types/models'

const rule = (target: Rule['target'], cond: Rule['cond'] = { type: 'atLeast', count: 1 }): Rule => ({
  enabled: true,
  kind: 'hard',
  days: { type: 'all' },
  target,
  cond,
})
const staff = (id: string, wc?: Staff['workConditions']) => ({ id, name: `職員${id}`, active: true, workConditions: wc })

const empty: PatternUsageSources = {
  staff: [staff('1')],
  rules: [],
  settings: { nightPrecedingPatternId: null, nightAvoidPatternIdsAfter2: [], shiftConsecutiveCaps: {} },
  schedules: [],
  leaveRequests: [],
}

describe('findPatternUsages（§18 A3）', () => {
  it('どこにも使われていなければ空（削除できる）。設定が未作成（既定値）・勤務表なしの古い施設でも空', () => {
    expect(findPatternUsages('P', empty)).toEqual([])
  })

  it('職員の可能な勤務・不可の勤務', () => {
    const src = { ...empty, staff: [staff('1', { workablePatternIds: ['P'] }), staff('2', { ngPatternIds: ['P'] })] }
    expect(findPatternUsages('P', src)).toEqual(['職員の「可能な勤務」: 職員1', '職員の「不可の勤務」: 職員2'])
  })

  it('条件（勤務・兼務・グループ・優先する勤務）を数える', () => {
    const rules = [
      rule({ type: 'shift', value: 'P' }),
      rule({ type: 'secondaryShift', value: 'P' }),
      rule({ type: 'shiftGroup', value: ['X', 'P'] }),
      rule({ type: 'staff', value: 's1' }, { type: 'preferShift', value: 'P' }),
      rule({ type: 'shift', value: 'X' }),
    ]
    expect(findPatternUsages('P', { ...empty, rules })).toEqual(['条件: 4件'])
  })

  it('設定（夜勤の前日・2日後に避ける・連続の上限）', () => {
    const settings = { nightPrecedingPatternId: 'P', nightAvoidPatternIdsAfter2: ['P'], shiftConsecutiveCaps: { P: 3 } }
    expect(findPatternUsages('P', { ...empty, settings })).toEqual([
      '設定: 夜勤の前日の勤務',
      '設定: 夜勤の2日後に避ける勤務',
      '設定: 勤務の連続日数の上限',
    ])
  })

  it('勤務表（通常行・兼務行）の月と、勤務希望', () => {
    const schedules: PatternUsageSources['schedules'] = [
      { id: '2026-11', assignments: { a: { '1': 'X' } }, secondaryAssignments: { a: { '2': 'P' } } },
      { id: '2026-09', assignments: { a: { '5': 'P' } } },
      { id: '2026-10', assignments: { a: { '5': 'X' } } },
    ]
    const leaveRequests = [{ desiredPatternId: 'P' }, { desiredPatternId: null }]
    expect(findPatternUsages('P', { ...empty, schedules, leaveRequests })).toEqual([
      '勤務表: 2026年9月、2026年11月',
      '勤務希望: 1件',
    ])
  })
})

describe('collectStaffRulePatternRefs（Excel 取込の判定。従来と同じ範囲）', () => {
  it('可能な勤務・shift/shiftGroup の条件・優先する勤務だけを数え、不可の勤務・兼務の条件は数えない', () => {
    const used = collectStaffRulePatternRefs(
      [staff('1', { workablePatternIds: ['A'], ngPatternIds: ['N'] })],
      [
        rule({ type: 'shift', value: 'B' }),
        rule({ type: 'shiftGroup', value: ['C', 'D'] }),
        rule({ type: 'staff', value: 's' }, { type: 'preferShift', value: 'E' }),
        rule({ type: 'secondaryShift', value: 'S' }),
      ],
    )
    expect([...used].sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('monthsWithStaffEntries（§18 A2 職員の削除前の確認）', () => {
  it('通常行・兼務行に入力がある月を年月順に返す。空の行は数えない', () => {
    const schedules = [
      { id: '2026-11', assignments: { a: { '1': 'P' } } },
      { id: '2026-08', secondaryAssignments: { a: { '3': 'P' } } } as { id: string; assignments?: Record<string, Record<string, string>> },
      { id: '2026-10', assignments: { a: {} , b: { '1': 'P' } } },
    ]
    expect(monthsWithStaffEntries('a', schedules)).toEqual(['2026-08', '2026-11'])
    expect(monthsWithStaffEntries('z', schedules)).toEqual([])
  })
})
