import { describe, expect, it } from 'vitest'
import { buildTraitPairBlocks, conflictsWithTraitPair } from '../traitPairs'
import { generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1 } from '../defaults'
import { DAYS, YM, input, rule, staff } from './fixtures'

const profile = GENERATION_DEFAULTS_V1.profiles[0]

// アミティホーム寺田の「臼井（見分けA）と中野（見分けB）を同じ勤務帯にしない」を模したもの
const notTogether = rule({
  kind: 'hard',
  days: { type: 'all' },
  target: { type: 'traitPair', value: '見分けA', value2: '見分けB' },
  cond: { type: 'notTogether' },
})
const usui = staff('usui', { traits: ['見分けA'] })
const nakano = staff('nakano', { traits: ['見分けB'] })

describe('buildTraitPairBlocks', () => {
  it('必須の notTogether だけを、タグを持つ職員IDの集合に展開する', () => {
    const blocks = buildTraitPairBlocks([notTogether], [usui, nakano, staff('other')])
    expect(blocks).toHaveLength(1)
    expect([...blocks[0].aIds]).toEqual(['usui'])
    expect([...blocks[0].bIds]).toEqual(['nakano'])
  })

  it('推奨・無効、または片方のタグを持つ人がいないルールは対象外', () => {
    expect(buildTraitPairBlocks([{ ...notTogether, kind: 'soft' }], [usui, nakano])).toEqual([])
    expect(buildTraitPairBlocks([{ ...notTogether, enabled: false }], [usui, nakano])).toEqual([])
    expect(buildTraitPairBlocks([notTogether], [usui])).toEqual([])
  })
})

describe('conflictsWithTraitPair', () => {
  const blocks = buildTraitPairBlocks([notTogether], [usui, nakano])

  it('相手がすでに同じ日・同じ勤務にいればかち合う（どちら側から置いても）', () => {
    expect(conflictsWithTraitPair(blocks, { nakano: { '3': 'A' } }, YM, 'usui', 3, 'A')).toBe(true)
    expect(conflictsWithTraitPair(blocks, { usui: { '3': 'A' } }, YM, 'nakano', 3, 'A')).toBe(true)
  })

  it('勤務が違う、日が違う、ペアでない職員ならかち合わない', () => {
    expect(conflictsWithTraitPair(blocks, { nakano: { '3': 'B' } }, YM, 'usui', 3, 'A')).toBe(false)
    expect(conflictsWithTraitPair(blocks, { nakano: { '4': 'A' } }, YM, 'usui', 3, 'A')).toBe(false)
    expect(conflictsWithTraitPair(blocks, { nakano: { '3': 'A' } }, YM, 'other', 3, 'A')).toBe(false)
  })
})

describe('generateOne: タグのペアを同一シフトに入れない（必須）', () => {
  // A 勤が毎日2名必要で、4人とも A 勤ができる。以前は臼井と中野が同じ日に A 勤に並ぶことがあった
  const staffList = [usui, nakano, staff('s3'), staff('s4')]
  const rules = [
    rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 2 } }),
    notTogether,
  ]

  it.each([1, 2, 3, 4, 5])('試行%i回目: 臼井と中野が同じ日に同じ勤務へ入らない', () => {
    const { assignments, hardViolations } = generateOne(input({ staff: staffList, rules }), profile)
    for (let d = 1; d <= DAYS; d++) {
      const u = assignments.usui?.[String(d)]
      const n = assignments.nakano?.[String(d)]
      if (u && u !== 'off') expect(n, `${d}日に2人とも${u}`).not.toBe(u)
    }
    expect(hardViolations.filter((v) => v.includes('見分けA'))).toEqual([])
  })

  // 最後の仕上げ（hillClimb）は違反を減らす入れ替えを探すため、簡単な条件だとブロックが無くても直してしまい、
  // 配置時ブロックの効果が見えない。仕上げを止めて、配置の段階で何が起きるかだけを比べる
  const clashesWithoutHillClimb = (enforceTraitPairs: boolean) => {
    let clashed = 0
    for (let i = 0; i < 10; i++) {
      const { assignments } = generateOne(input({ staff: staffList, rules }, { hillClimbMs: 0, enforceTraitPairs }), profile)
      for (let d = 1; d <= DAYS; d++) {
        const u = assignments.usui?.[String(d)]
        if (u && u !== 'off' && assignments.nakano?.[String(d)] === u) clashed++
      }
    }
    return clashed
  }

  it('配置の段階でかち合いを作らない（仕上げの探索に頼っていない）', () => {
    expect(clashesWithoutHillClimb(true)).toBe(0)
  })

  it('スイッチを切ると配置の段階でかち合いが生まれる（テストが機能を見張れていることの確認）', () => {
    expect(clashesWithoutHillClimb(false)).toBeGreaterThan(0)
  })
})
