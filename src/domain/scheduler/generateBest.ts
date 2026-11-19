/**
 * 1案の持ち時間の中で何度か作り直し、いちばん良いものを残す（改善指示書 B3。remaining-work-design.md §23）。
 * 生成は乱数で最初の割り当て（夜勤→日中）の良し悪しが分かれるため、1回だけだと運に左右される。
 */
import { generateOne } from './generateOne'
import { nowOf } from './random'
import type { GenerationProfile } from './defaults'
import type { Candidate, GenerateInput } from './types'

/** a が b より良いか（必須違反が少ない → 総合点が高い。同じなら先に作った方＝b を残す） */
export function isBetterCandidate(a: Candidate, b: Candidate): boolean {
  if (a.hardCount !== b.hardCount) return a.hardCount < b.hardCount
  return a.scores.total > b.scores.total
}

/**
 * profile の案を、config.engine.candidateTimeBudgetMs の間で作り直して、いちばん良いものを返す。
 * 最低1回は作る。1回終わるごとに「経過時間＋直前の1回の時間」が持ち時間を超えるなら止める。
 * onAttempt は各回を始める前に呼ぶ（1始まりの回数。進み具合の表示用）
 */
export function generateBest(
  input: GenerateInput,
  profile: GenerationProfile,
  onAttempt?: (attempt: number) => void,
): Candidate {
  const now = nowOf(input)
  const budget = Math.max(0, input.config.engine.candidateTimeBudgetMs ?? 0)
  const start = now()
  let best: Candidate | null = null
  for (let attempt = 1; ; attempt++) {
    onAttempt?.(attempt)
    const t0 = now()
    const c = generateOne(input, profile)
    const t1 = now()
    if (!best || isBetterCandidate(c, best)) best = c
    if (t1 - start + (t1 - t0) > budget) return best
  }
}
