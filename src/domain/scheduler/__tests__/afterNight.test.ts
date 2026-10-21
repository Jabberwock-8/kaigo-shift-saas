import { describe, expect, it } from 'vitest'
import { generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1 } from '../defaults'
import type { PatternWithId } from '../types'
import { A, B, OFF, input, rule, settings, staff } from './fixtures'

const N: PatternWithId = { id: 'N', code: 'N', label: '夜勤', startTime: '16:00', endTime: '09:00', category: 'night', isWork: true, isNight: true }
// 明出を勤務日として数える運用（第三恵光: 日勤10＋夜勤5＋明出5＝20日）
const AKE: PatternWithId = { id: 'ake', code: '明', label: '明出', category: 'afterNight', isWork: true, isNight: false }

describe('generateOne: 明を勤務日として数える「明を使う」運用', () => {
  const rules = [
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'N' }, cond: { type: 'exact', count: 1 } }),
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 2 } }),
  ]
  const staffList = ['s1', 's2', 's3', 's4', 's5'].map((id) =>
    staff(id, { workConditions: { workablePatternIds: ['A', 'B', 'N', 'ake'], nightShiftTarget: 6 } }),
  )

  // 以前は明が「余っている勤務」とみなされ、休みへの振替・別の日への移動・日数の補充に使われて、
  // 「夜勤翌日は明が必要」「夜勤なしの明」の必須違反が毎回数件出ていた
  it.each([1, 2, 3, 4, 5])('試行%i回目: 夜勤の翌日は必ず明、明は夜勤の翌日にだけある', () => {
    const result = generateOne(
      input({
        staff: staffList,
        rules,
        shiftPatterns: [OFF, A, B, N, AKE],
        settings: settings({
          nightMode: 'ake',
          maxConsecutiveWorkdaysDefault: 4,
          monthlyLimitsDefault: { targetWorkdays: 20, maxWorkdays: 20, maxNightShifts: null },
        }),
      }),
      GENERATION_DEFAULTS_V1.profiles[0],
    )
    const nightBlock = result.hardViolations.filter((v) => v.includes('明'))
    expect(nightBlock).toEqual([])
  })
})

describe('generateOne: 準夜勤の「明休」（明の翌日を公休にしない運用）', () => {
  // 準夜勤（21:00〜翌7:00）の翌日は休み扱いの「明休」。その翌日は勤務を入れてよい
  const N_SEMI: PatternWithId = { id: 'N', code: 'N1', label: '準夜勤', startTime: '21:00', endTime: '07:00', category: 'night', isWork: true, isNight: true }
  const AKE_REST: PatternWithId = { id: 'ake', code: '明休', label: '明休', category: 'afterNight', isWork: false, isNight: false }
  const rules = [
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'N' }, cond: { type: 'exact', count: 1 } }),
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 2 } }),
  ]
  const staffList = ['s1', 's2', 's3', 's4', 's5'].map((id) =>
    staff(id, { workConditions: { workablePatternIds: ['A', 'B', 'N'], nightShiftTarget: 6 } }),
  )
  const run = (akeRequiresOffNextDay: boolean | null) =>
    generateOne(
      input({
        staff: staffList,
        rules,
        shiftPatterns: [OFF, A, B, N_SEMI, AKE_REST],
        settings: settings({ nightMode: 'ake', akeRequiresOffNextDay, monthlyLimitsDefault: { targetWorkdays: 20, maxWorkdays: 20, maxNightShifts: null } }),
      }),
      GENERATION_DEFAULTS_V1.profiles[0],
    )
  /** 明休の翌日に勤務が入った回数 */
  const workAfterAke = (assignments: Record<string, Record<string, string>>) =>
    Object.values(assignments).reduce((n, byDay) => {
      return n + Object.entries(byDay).filter(([d, p]) => p === 'ake' && ['A', 'B', 'N'].includes(byDay[String(Number(d) + 1)])).length
    }, 0)

  it('翌日を自由にすると、明休の翌日にも勤務が入り、違反にならない', () => {
    const results = [1, 2, 3].map(() => run(false))
    for (const r of results) expect(r.hardViolations.filter((v) => v.includes('明休'))).toEqual([])
    expect(results.some((r) => workAfterAke(r.assignments) > 0)).toBe(true)
  })

  it('未設定なら従来どおり、明休の翌日は必ず公休', () => {
    for (let i = 0; i < 3; i++) {
      const r = run(null)
      expect(workAfterAke(r.assignments)).toBe(0)
      expect(r.hardViolations.filter((v) => v.includes('明休'))).toEqual([])
    }
  })
})

describe('準夜勤の「明休」: 夜勤の連続', () => {
  const N_SEMI: PatternWithId = { id: 'N', code: 'N1', label: '準夜勤', startTime: '21:00', endTime: '07:00', category: 'night', isWork: true, isNight: true }
  const AKE_REST: PatternWithId = { id: 'ake', code: '明休', label: '明休', category: 'afterNight', isWork: false, isNight: false }
  const staffList = ['s1', 's2', 's3', 's4', 's5'].map((id) =>
    staff(id, { workConditions: { workablePatternIds: ['A', 'B', 'N'], nightShiftTarget: 4 } }),
  )
  const rules = [rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'N' }, cond: { type: 'exact', count: 1 } })]
  const run = (akeAllowConsecutiveNights: boolean) =>
    generateOne(
      input({
        staff: staffList,
        rules,
        shiftPatterns: [OFF, A, B, N_SEMI, AKE_REST],
        settings: settings({ nightMode: 'ake', akeRequiresOffNextDay: false, akeAllowConsecutiveNights, shiftConsecutiveCaps: { N: 2 } }),
        // s1 の 10・11日に連続夜勤を入力してロック
        baseAssignments: { s1: { '10': 'N', '11': 'N' } },
        lockedCells: { s1: { '10': true, '11': true } },
      }),
      GENERATION_DEFAULTS_V1.profiles[0],
    )

  it('連続を認めると、ロックした夜→夜はそのまま違反にならず、最後の翌日に明休が入る', () => {
    for (let i = 0; i < 3; i++) {
      const r = run(true)
      expect(r.assignments.s1['12']).toBe('ake')
      expect(r.hardViolations.filter((v) => v.startsWith('s1:') && v.includes('明休'))).toEqual([])
    }
  })

  it('連続を認めないと、夜→夜は「夜勤翌日は明休が必要」の違反になる', () => {
    const r = run(false)
    expect(r.hardViolations).toContain('s1: 11日 夜勤翌日は「明休」が必要')
  })
})

describe('準夜勤の「明休」: 夜勤の2日後に避ける勤務', () => {
  const N_SEMI: PatternWithId = { id: 'N', code: 'N1', label: '準夜勤', startTime: '21:00', endTime: '07:00', category: 'night', isWork: true, isNight: true }
  const AKE_REST: PatternWithId = { id: 'ake', code: '明休', label: '明休', category: 'afterNight', isWork: false, isNight: false }

  it('明休の翌日に、避ける勤務（A）は入らない', () => {
    const staffList = ['s1', 's2', 's3', 's4', 's5'].map((id) =>
      staff(id, { workConditions: { workablePatternIds: ['A', 'B', 'N'], nightShiftTarget: 5 } }),
    )
    const rules = [
      rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'N' }, cond: { type: 'exact', count: 1 } }),
      rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 1 } }),
    ]
    for (let i = 0; i < 3; i++) {
      const r = generateOne(
        input({
          staff: staffList,
          rules,
          shiftPatterns: [OFF, A, B, N_SEMI, AKE_REST],
          settings: settings({ nightMode: 'ake', akeRequiresOffNextDay: false, nightAvoidPatternIdsAfter2: ['A'] }),
        }),
        GENERATION_DEFAULTS_V1.profiles[0],
      )
      for (const byDay of Object.values(r.assignments)) {
        for (const [d, p] of Object.entries(byDay)) {
          if (p === 'ake' && byDay[String(Number(d) - 1)] === 'N') expect(byDay[String(Number(d) + 1)]).not.toBe('A')
        }
      }
      expect(r.hardViolations.filter((v) => v.includes('避ける'))).toEqual([])
    }
  })
})

describe('夜勤の前日の決まった勤務（M3→夜勤→明出→公休）', () => {
  const N_LONG: PatternWithId = { id: 'N', code: 'N6', label: '夜勤', startTime: '16:00', endTime: '10:00', category: 'night', isWork: true, isNight: true }
  const M: PatternWithId = { id: 'M', code: 'M3', label: 'M3', startTime: '11:00', endTime: '20:00', category: 'day', isWork: true, isNight: false }
  const AKE_WORK: PatternWithId = { id: 'ake', code: '明出', label: '明出', category: 'afterNight', isWork: true, isNight: false }
  const staffList = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) =>
    staff(id, { workConditions: { workablePatternIds: ['A', 'M', 'N', 'ake'], nightShiftTarget: 5 } }),
  )
  const rules = [
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'N' }, cond: { type: 'exact', count: 1 } }),
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'M' }, cond: { type: 'atLeast', count: 1 } }),
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 1 } }),
  ]
  const run = (nightPrecedingPatternId: string | null) =>
    generateOne(
      input({
        staff: staffList,
        rules,
        shiftPatterns: [OFF, A, M, N_LONG, AKE_WORK],
        settings: settings({ nightMode: 'ake', nightPrecedingPatternId, maxConsecutiveWorkdaysDefault: 5, monthlyLimitsDefault: { targetWorkdays: 20, maxWorkdays: 20, maxNightShifts: null } }),
      }),
      GENERATION_DEFAULTS_V1.profiles[0],
    )
  const preNightRate = (assignments: Record<string, Record<string, string>>) => {
    let nights = 0
    let pre = 0
    for (const byDay of Object.values(assignments)) {
      for (const [d, p] of Object.entries(byDay)) {
        if (p !== 'N' || d === '1') continue
        nights++
        if (byDay[String(Number(d) - 1)] === 'M') pre++
      }
    }
    return pre / nights
  }

  it('設定すると、夜勤の前日はすべて M3 になり、違反も出ない', () => {
    for (let i = 0; i < 3; i++) {
      const r = run('M')
      expect(preNightRate(r.assignments)).toBe(1)
      expect(r.hardViolations.filter((v) => v.includes('夜勤の前日'))).toEqual([])
    }
  })

  it('設定しなければ、夜勤の前日は決まらない（M3 以外も入る）', () => {
    const rates = [1, 2, 3].map(() => preNightRate(run(null).assignments))
    expect(rates.some((x) => x < 1)).toBe(true)
  })
})
