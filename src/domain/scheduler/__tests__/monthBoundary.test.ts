import { describe, expect, it } from 'vitest'
import { checkMonth } from '../check'
import { generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1 } from '../defaults'
import { makeCheckInput, prevMonthTail } from '../gridUtils'
import type { PatternWithId } from '../types'
import { A, B, OFF, input, rule, settings, staff } from './fixtures'

const N: PatternWithId = { id: 'N', code: 'N6', label: '夜勤', startTime: '16:00', endTime: '10:00', category: 'night', isWork: true, isNight: true }
const AKE: PatternWithId = { id: 'ake', code: '明出', label: '明出', category: 'afterNight', isWork: true, isNight: false }
const profile = GENERATION_DEFAULTS_V1.profiles[0]

describe('prevMonthTail', () => {
  it('前月の最終日を "0"、その前日を "-1" として取り出す', () => {
    expect(prevMonthTail({ s1: { '30': 'N', '29': 'A', '1': 'B' } }, 30)).toEqual({ s1: { '0': 'N', '-1': 'A' } })
  })
})

describe('月をまたぐ夜勤明け（明出→公休の運用）', () => {
  const staffList = ['s1', 's2', 's3', 's4'].map((id) =>
    staff(id, { workConditions: { workablePatternIds: ['A', 'B', 'N', 'ake'], nightShiftTarget: 5 } }),
  )
  const base = {
    staff: staffList,
    shiftPatterns: [OFF, A, B, N, AKE],
    rules: [
      rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'N' }, cond: { type: 'exact', count: 1 } }),
      rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 1 } }),
    ],
    settings: settings({ nightMode: 'ake' }),
    // s1 は前月の最終日が夜勤
    prevTail: { s1: { '0': 'N', '-1': 'A' } },
  }

  it('生成: 前月の最終日が夜勤なら、1日は明出・2日は公休になる（以前は1日に普通の勤務が入り得た）', () => {
    for (let i = 0; i < 3; i++) {
      const r = generateOne(input(base), profile)
      expect(r.assignments.s1['1']).toBe('ake')
      expect(r.assignments.s1['2']).toBe('off')
      expect(r.hardViolations.filter((v) => v.startsWith('s1:') && v.includes('前月末'))).toEqual([])
    }
  })

  it('違反チェック: 前月の最終日が夜勤なのに1日が勤務なら違反になる', () => {
    const r = checkMonth(makeCheckInput({ s1: { '1': 'A' } }, input(base)))
    expect(r.hard).toContain('s1: 1日 夜勤翌日は「明出」が必要（前月末の夜勤）')
  })

  it('違反チェック: 前月の勤務表が無いときは、1日の明を「夜勤なしの明」としない（前月の夜勤が分からないため）', () => {
    const r = checkMonth(makeCheckInput({ s1: { '1': 'ake', '2': 'off' } }, input({ ...base, prevTail: undefined })))
    expect(r.hard.filter((v) => v.includes('夜勤なし'))).toEqual([])
  })

  it('違反チェック: 前月の勤務表があり、前月の最終日が夜勤でないのに1日が明なら違反', () => {
    const r = checkMonth(makeCheckInput({ s2: { '1': 'ake' } }, input({ ...base, prevTail: { s2: { '0': 'A' } } })))
    expect(r.hard).toContain('s2: 1日 夜勤なしの「明出」')
  })
})

describe('月をまたぐ連続勤務', () => {
  const s1 = staff('s1', { workConditions: { workablePatternIds: ['A', 'B'], maxConsecutiveWorkdays: 5 } })
  // 前月末に4日続けて勤務している
  const prevTail = { s1: { '0': 'A', '-1': 'A', '-2': 'B', '-3': 'A' } }

  it('違反チェック: 前月末からの連続を引き継いで数える', () => {
    const r = checkMonth(makeCheckInput({ s1: { '1': 'A', '2': 'A' } }, input({ staff: [s1], prevTail })))
    expect(r.hard).toContain('s1: 連続勤務が上限5日を超過（2日時点）')
  })

  it('生成: 1日に勤務を入れたら、2日は勤務にしない', () => {
    for (let i = 0; i < 3; i++) {
      const r = generateOne(
        input({
          staff: [s1],
          prevTail,
          shiftPatterns: [OFF, A, B],
          rules: [rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 1 } })],
        }),
        profile,
      )
      const work = (d: number) => ['A', 'B'].includes(r.assignments.s1[String(d)])
      expect(work(1) && work(2)).toBe(false)
    }
  })
})

describe('月をまたぐ夜勤（公休に直行の運用）', () => {
  it('前月の最終日が夜勤なら、1日は休みになり、勤務なら違反', () => {
    const s1 = staff('s1', { workConditions: { workablePatternIds: ['A', 'N'] } })
    const base = { staff: [s1], shiftPatterns: [OFF, A, N], settings: settings({ nightMode: 'direct' }), prevTail: { s1: { '0': 'N' } } }
    const gen = generateOne(input(base), profile)
    expect(gen.assignments.s1['1']).toBe('off')
    const r = checkMonth(makeCheckInput({ s1: { '1': 'A' } }, input(base)))
    expect(r.hard).toContain('s1: 1日 夜勤翌日は休みが必要（前月末の夜勤）')
  })
})
