import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1 } from '../defaults'
import { input, rule, staff } from './fixtures'

const profile = GENERATION_DEFAULTS_V1.profiles[0]
// 2026年9月の金曜日
const FRIDAYS = [4, 11, 18, 25]

afterEach(() => {
  vi.restoreAllMocks()
})

const worksOn = (grid: Record<string, Record<string, string>>, id: string, d: number) => {
  const p = grid[id]?.[String(d)]
  return !!p && p !== 'off'
}

describe('「必ず勤務させる」', () => {
  // 5人とも A 勤ができ、A 勤は毎日1名だけ必要。s1 は「金曜日は必ず勤務させる」。
  // 抽選で常に3番手を引く状態にして、ルールが抽選で打ち消されないかを見る
  const staffList = ['s1', 's2', 's3', 's4', 's5'].map((id) => staff(id))
  const needA = rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 1 } })
  const fridays = { type: 'dow' as const, values: [5] }

  it('推奨でも、金曜日に勤務へ入る', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const rules = [needA, rule({ kind: 'soft', days: fridays, target: { type: 'staff', value: 's1' }, cond: { type: 'work' } })]
    const { assignments } = generateOne(input({ staff: staffList, rules }), profile)

    const worked = FRIDAYS.filter((d) => worksOn(assignments, 's1', d))
    // 推奨は公平性の歯止めの範囲内での後押しなので、4回すべてとは限らないが半分以上は入る
    expect(worked.length).toBeGreaterThanOrEqual(2)
  })

  it('必須なら、金曜日にはすべて勤務へ入る', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const rules = [needA, rule({ kind: 'hard', days: fridays, target: { type: 'staff', value: 's1' }, cond: { type: 'work' } })]
    const { assignments, hardViolations } = generateOne(input({ staff: staffList, rules }), profile)

    expect(FRIDAYS.filter((d) => worksOn(assignments, 's1', d))).toEqual(FRIDAYS)
    expect(hardViolations.filter((v) => v.includes('必ず勤務'))).toEqual([])
  })

  it('ルールが無ければ金曜日を特別扱いしない（テストが機能を見張れていることの確認）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const { assignments } = generateOne(input({ staff: staffList, rules: [needA] }), profile)

    expect(FRIDAYS.filter((d) => worksOn(assignments, 's1', d)).length).toBeLessThan(FRIDAYS.length)
  })

  it('「勤務させない（推奨）」の日は、ルールが無いときより勤務が減る', () => {
    // 推奨は公平性の範囲内での後押しなので、休みが続いた人が選ばれることはある（ゼロにするのは必須の役目）。
    // 同じ乱数の条件で、ルールの有無による差だけを比べる
    const fridaysWorked = (withRule: boolean) => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const rules = withRule
        ? [needA, rule({ kind: 'soft', days: fridays, target: { type: 'staff', value: 's1' }, cond: { type: 'off' } })]
        : [needA]
      const { assignments } = generateOne(input({ staff: staffList, rules }), profile)
      vi.restoreAllMocks()
      return FRIDAYS.filter((d) => worksOn(assignments, 's1', d)).length
    }

    expect(fridaysWorked(true)).toBeLessThan(fridaysWorked(false))
  })
})
