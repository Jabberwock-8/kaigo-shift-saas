import { describe, expect, it } from 'vitest'
import { generate } from '../generate'
import { createSeededRandom } from '../random'
import { shuffle } from '../gridUtils'
import type { GenerateInput } from '../types'
import { BENCH_FACILITIES, steppingClock } from './fixtures/facilities'

// 改善指示書 B0: 種を渡すと毎回同じ結果になること（計測の土台）
describe('createSeededRandom', () => {
  it('同じ種なら同じ列、違う種なら違う列。値は0以上1未満', () => {
    const a = createSeededRandom(42)
    const b = createSeededRandom(42)
    const c = createSeededRandom(43)
    const sa = Array.from({ length: 20 }, () => a())
    expect(Array.from({ length: 20 }, () => b())).toEqual(sa)
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(sa)
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('shuffle は乱数を渡すと決まった並びになり、要素は変わらない', () => {
    const x = shuffle([1, 2, 3, 4, 5, 6, 7, 8], createSeededRandom(7))
    const y = shuffle([1, 2, 3, 4, 5, 6, 7, 8], createSeededRandom(7))
    expect(x).toEqual(y)
    expect([...x].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

/** 時間で打ち切る処理を、呼ぶたびに進む時計で決まった回数にする（探索は短めにしてテストを速くする） */
function seeded(build: () => GenerateInput, seed: number): GenerateInput {
  const base = build()
  return {
    ...base,
    random: createSeededRandom(seed),
    now: steppingClock(),
    config: { ...base.config, engine: { ...base.config.engine, hillClimbMs: 60 } },
  }
}

describe('generate: 種と時計を渡すと毎回同じ案になる', () => {
  it.each(BENCH_FACILITIES.map((f) => [f.label, f.build] as const))('%s', (_label, build) => {
    const first = generate(seeded(build, 1))
    const second = generate(seeded(build, 1))
    expect(second.map((c) => c.assignments)).toEqual(first.map((c) => c.assignments))
    expect(second.map((c) => c.hardCount)).toEqual(first.map((c) => c.hardCount))
    expect(second.map((c) => c.scores.total)).toEqual(first.map((c) => c.scores.total))
  })

  it('種が違えば、少なくとも1施設で違う案になる（乱数が実際に効いている）', () => {
    const differs = BENCH_FACILITIES.some((f) => {
      const a = generate(seeded(f.build, 1))[0].assignments
      const b = generate(seeded(f.build, 2))[0].assignments
      return JSON.stringify(a) !== JSON.stringify(b)
    })
    expect(differs).toBe(true)
  })

  it('種を渡さない従来の呼び方でも、案の形は同じ（3案・全職員分）', () => {
    const f = BENCH_FACILITIES[0].build()
    const result = generate({ ...f, config: { ...f.config, engine: { ...f.config.engine, hillClimbMs: 30 } } })
    expect(result).toHaveLength(f.config.profiles.length)
    for (const c of result) expect(Object.keys(c.assignments).sort()).toEqual(f.staff.map((s) => s.id).sort())
  })
})
