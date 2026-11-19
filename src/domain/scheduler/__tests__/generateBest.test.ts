import { describe, expect, it } from 'vitest'
import { generateBest, isBetterCandidate } from '../generateBest'
import { generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1, mergeGenerationConfig } from '../defaults'
import { createSeededRandom } from '../random'
import type { Candidate, GenerateInput } from '../types'
import { BENCH_FACILITIES, steppingClock } from './fixtures/facilities'

// 改善指示書 B3: 持ち時間の中で作り直して、いちばん良い案を残す
function seeded(budget: number, seed = 9): GenerateInput {
  const base = BENCH_FACILITIES[0].build()
  return {
    ...base,
    random: createSeededRandom(seed),
    now: steppingClock(),
    config: { ...base.config, engine: { ...base.config.engine, hillClimbMs: 40, candidateTimeBudgetMs: budget } },
  }
}
const profile = GENERATION_DEFAULTS_V1.profiles[0]
const cand = (hardCount: number, total: number) => ({ hardCount, scores: { total } }) as Candidate

describe('isBetterCandidate', () => {
  it('必須違反が少ない方が良い。同じなら総合点が高い方。まったく同じなら先の案を残す（false）', () => {
    expect(isBetterCandidate(cand(0, 70), cand(1, 90))).toBe(true)
    expect(isBetterCandidate(cand(1, 90), cand(0, 70))).toBe(false)
    expect(isBetterCandidate(cand(0, 80), cand(0, 79))).toBe(true)
    expect(isBetterCandidate(cand(0, 80), cand(0, 80))).toBe(false)
  })
})

describe('generateBest', () => {
  it('持ち時間0なら1回だけ作り、従来の generateOne と同じ案', () => {
    const attempts: number[] = []
    const best = generateBest(seeded(0), profile, (a) => attempts.push(a))
    expect(attempts).toEqual([1])
    expect(best).toEqual(generateOne(seeded(0), profile))
  })

  it('持ち時間があれば何度か作り、その中でいちばん良い案を返す', () => {
    const attempts: number[] = []
    const best = generateBest(seeded(3000), profile, (a) => attempts.push(a))
    expect(attempts.length).toBeGreaterThan(1)
    // 同じ乱数の列で同じ回数だけ作り直したときの各回の案を作り、選び方の決まりで一番を選ぶ
    const replay = seeded(3000)
    let expected: Candidate | null = null
    for (let i = 0; i < attempts.length; i++) {
      const c = generateOne(replay, profile)
      if (!expected || isBetterCandidate(c, expected)) expected = c
    }
    expect(best).toEqual(expected)
  })

  it('持ち時間を大きく超えない（最後の1回の分まで）', () => {
    const input = seeded(3000)
    const clock = input.now!
    const start = clock()
    generateBest(input, profile)
    // 呼ぶたびに1ms進む時計なので、経過は呼び出し回数。持ち時間＋1回分程度に収まる
    const elapsed = clock() - start
    expect(elapsed).toBeLessThan(3000 * 2)
  })
})

describe('candidateTimeBudgetMs の既定値と上書き', () => {
  it('施設の設定が無い・古い上書きに項目が無いときは既定の5秒。上書きすればその値（0 で従来どおり1回）', () => {
    expect(mergeGenerationConfig(null).engine.candidateTimeBudgetMs).toBe(5000)
    expect(mergeGenerationConfig({ engine: { hillClimbMs: 500 } }).engine.candidateTimeBudgetMs).toBe(5000)
    expect(mergeGenerationConfig({ engine: { candidateTimeBudgetMs: 0 } }).engine.candidateTimeBudgetMs).toBe(0)
  })
})
