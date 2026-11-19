/**
 * 3案の比較カードで使う、案どうしの比べ方（純関数。改善指示書 D5・remaining-work-design.md §28）。
 */
import type { Candidate, ScoreKey } from '../../domain/scheduler/types'

type WithId = Pick<Candidate, 'hardCount' | 'scores'> & { id: string }

/** 必須違反が最も少なく、同数なら総合点が最も高い案を「おすすめ」とする（従来と同じ選び方） */
export function pickRecommendedId(candidates: WithId[]): string | null {
  if (candidates.length === 0) return null
  return candidates.reduce((best, c) => {
    if (c.hardCount < best.hardCount) return c
    if (c.hardCount === best.hardCount && c.scores.total > best.scores.total) return c
    return best
  }, candidates[0]).id
}

/** 「おすすめ」の理由（1行）。案が1つだけなら空 */
export function recommendReason(candidates: WithId[], recommendedId: string | null): string {
  const rec = candidates.find((c) => c.id === recommendedId)
  const others = candidates.filter((c) => c.id !== recommendedId)
  if (!rec || others.length === 0) return ''
  const fewerHard = others.every((c) => c.hardCount > rec.hardCount)
  if (fewerHard) {
    return rec.hardCount === 0 ? '必須違反がない、ただ1つの案' : `必須違反がいちばん少ない（${rec.hardCount}件）`
  }
  if (rec.hardCount === 0) return `必須違反がなく、総合点がいちばん高い（${rec.scores.total}点）`
  return `必須違反の件数が同じ中で、総合点がいちばん高い（${rec.scores.total}点）`
}

/** 項目ごとの、3案の中でいちばん高い点（同点なら複数の案が「いちばん」になる） */
export function bestScoreByKey(candidates: WithId[], keys: ScoreKey[]): Record<ScoreKey, number> {
  const out = {} as Record<ScoreKey, number>
  for (const k of keys) out[k] = Math.max(...candidates.map((c) => c.scores[k]))
  return out
}
