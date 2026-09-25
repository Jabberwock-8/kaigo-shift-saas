import { describe, expect, it } from 'vitest'
import { generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1 } from '../defaults'
import { DAYS, input, rule, settings, staff } from './fixtures'

describe('generateOne: 希望休', () => {
  // 人手が足りず（毎日 A を2名・3人で回す）、必要出勤日数（22日）も希望休を除くと届かない状況。
  // 以前は必要出勤日数の補充・同日の交換・不足の充当で希望休の日に勤務が入っていた
  const rules = [rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 2 } })]
  const staffList = ['s1', 's2', 's3'].map((id) => staff(id))
  const wishes = [
    ...[3, 9, 10, 11, 17, 24].map((day) => ({ staffId: 's1', day })),
    ...[9, 10, 18, 25].map((day) => ({ staffId: 's2', day })),
    ...[10, 11, 12, 20].map((day) => ({ staffId: 's3', day })),
  ]

  const run = (profile: (typeof GENERATION_DEFAULTS_V1.profiles)[number], enforceWishes = true) =>
    generateOne(
      input(
        {
          staff: staffList,
          rules,
          wishes,
          settings: settings({ monthlyLimitsDefault: { targetWorkdays: 22, maxWorkdays: null, maxNightShifts: null } }),
        },
        { enforceWishes },
      ),
      profile,
    )

  it.each(GENERATION_DEFAULTS_V1.profiles.map((p) => [p.label, p] as const))('%s: 希望休の日に勤務が入らない', (_, profile) => {
    for (let i = 0; i < 3; i++) {
      const result = run(profile)
      for (const w of wishes) expect(result.assignments[w.staffId][String(w.day)], `${w.staffId} ${w.day}日`).toBe('off')
      // 守った日も含め、全日に何かが入っている（空欄が残らない）
      expect(Object.keys(result.assignments.s1)).toHaveLength(DAYS)
    }
  })

  it('スイッチを切ると旧挙動（希望休に勤務が入る）に戻る', () => {
    const broken = [1, 2, 3].some(() => {
      const result = run(GENERATION_DEFAULTS_V1.profiles[0], false)
      return wishes.some((w) => result.assignments[w.staffId][String(w.day)] !== 'off')
    })
    expect(broken).toBe(true)
  })
})
