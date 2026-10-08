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
