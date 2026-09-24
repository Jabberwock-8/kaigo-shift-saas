import { describe, expect, it } from 'vitest'
import { assertGenerationPrerequisites, generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1 } from '../defaults'
import { A, B, OFF, WEEKENDS, input, rule, settings, staff } from './fixtures'

const profile = GENERATION_DEFAULTS_V1.profiles[0]

describe('assertGenerationPrerequisites', () => {
  it('公休カテゴリのパターンが無ければ止める', () => {
    expect(() => assertGenerationPrerequisites(input({ shiftPatterns: [A, B] }))).toThrow(/公休/)
  })

  it('公休が「勤務」扱いなら止める（アミティで必須違反が600件超出た事故の再発防止）', () => {
    const badOff = { ...OFF, isWork: true }
    expect(() => assertGenerationPrerequisites(input({ shiftPatterns: [badOff, A, B] }))).toThrow(/勤務.*チェック/)
  })

  it('「明を使う」運用なのに夜勤明けパターンが無ければ止める', () => {
    expect(() => assertGenerationPrerequisites(input({ settings: settings({ nightMode: 'ake' }) }))).toThrow(/夜勤明け/)
  })

  it('正しい設定なら止めない', () => {
    expect(() => assertGenerationPrerequisites(input())).not.toThrow()
  })
})

describe('generateOne: 「配置しない」の必須ルール', () => {
  // 土日は A が配置禁止。組み合わせ条件「A または B を1名以上」は毎日あるので、土日は B で埋める必要がある。
  // 以前は生成が土日に A を置いてしまい、最後のランダム探索が偶然見つけたときだけ消していた。
  const rules = [
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shiftGroup', value: ['A', 'B'] }, cond: { type: 'atLeastGroup', count: 1 } }),
    rule({ kind: 'hard', days: { type: 'weekend' }, target: { type: 'shift', value: 'A' }, cond: { type: 'none' } }),
  ]
  const staffList = ['s1', 's2', 's3', 's4'].map((id) => staff(id))

  // 生成は乱数を使うため、1回たまたま通るだけでは保証にならない。複数回回す
  it.each([1, 2, 3, 4, 5])('試行%i回目: 土日に A が1件も入らず、組み合わせ条件は満たされる', () => {
    const result = generateOne(input({ staff: staffList, rules }), profile)

    for (const d of WEEKENDS) {
      const onA = staffList.filter((s) => result.assignments[s.id]?.[String(d)] === 'A')
      expect(onA, `${d}日にAが入っている`).toEqual([])
    }
    expect(result.hardViolations.filter((v) => v.includes('配置しない'))).toEqual([])
    expect(result.hardViolations.filter((v) => v.includes('合計1名以上'))).toEqual([])
  })
})
