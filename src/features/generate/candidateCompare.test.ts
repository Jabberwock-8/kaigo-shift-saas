import { describe, expect, it } from 'vitest'
import { bestScoreByKey, pickRecommendedId, recommendReason } from './candidateCompare'

const c = (id: string, hardCount: number, total: number, extra: Partial<Record<string, number>> = {}) => ({
  id,
  hardCount,
  scores: { fair: 50, comp: 50, wish: 50, soft: 50, interval: 50, spread: 50, total, ...extra },
})

describe('pickRecommendedId（従来と同じ選び方）', () => {
  it('必須違反が少ない案。同じなら総合点が高い案。まったく同じなら先の案', () => {
    expect(pickRecommendedId([c('a', 2, 90), c('b', 1, 60), c('c', 3, 99)])).toBe('b')
    expect(pickRecommendedId([c('a', 0, 70), c('b', 0, 80), c('c', 0, 75)])).toBe('b')
    expect(pickRecommendedId([c('a', 0, 80), c('b', 0, 80)])).toBe('a')
    expect(pickRecommendedId([])).toBeNull()
  })
})

describe('recommendReason', () => {
  it('必須違反がない案が1つだけ', () => {
    const cs = [c('a', 0, 60), c('b', 2, 90), c('c', 1, 95)]
    expect(recommendReason(cs, 'a')).toBe('必須違反がない、ただ1つの案')
  })
  it('必須違反がいちばん少ない', () => {
    const cs = [c('a', 1, 60), c('b', 2, 90), c('c', 3, 95)]
    expect(recommendReason(cs, 'a')).toBe('必須違反がいちばん少ない（1件）')
  })
  it('どれも必須違反なし → 総合点', () => {
    const cs = [c('a', 0, 70), c('b', 0, 80)]
    expect(recommendReason(cs, 'b')).toBe('必須違反がなく、総合点がいちばん高い（80点）')
  })
  it('必須違反が同数 → 総合点', () => {
    const cs = [c('a', 2, 70), c('b', 2, 80), c('c', 3, 99)]
    expect(recommendReason(cs, 'b')).toBe('必須違反の件数が同じ中で、総合点がいちばん高い（80点）')
  })
  it('案が1つだけなら理由は出さない', () => {
    expect(recommendReason([c('a', 0, 70)], 'a')).toBe('')
  })
})

describe('bestScoreByKey', () => {
  it('項目ごとに3案の中のいちばん高い点', () => {
    const cs = [c('a', 0, 70, { fair: 80, comp: 40 }), c('b', 0, 80, { fair: 60, comp: 90 })]
    expect(bestScoreByKey(cs, ['fair', 'comp'])).toEqual({ fair: 80, comp: 90 })
  })
})
