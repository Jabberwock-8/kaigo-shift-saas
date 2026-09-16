import { demandFor } from './demand'
import { ruleAppliesToDate } from './ruleMatch'
import type { RuleWithId } from './types'

/** day → patternId → その日に配置してよい人数の上限 */
export type DayPatternCaps = Map<number, Map<string, number>>

/**
 * 「配置しない」「N名以下」の必須ルールから、日ごと・パターンごとの人数上限を作る。
 *
 * canWork がこれを見ることで、旧HTML版から引き継いだ「違反を作ってから hillClimb で
 * 偶然消す」挙動をやめ、そもそも置かないようにする（docs/remaining-work-design.md §3-4 の 4.5）。
 *
 * 同じパターンに必要人数（N名以上）と上限が同時に指定された矛盾データでは、
 * 上限を必要人数まで引き上げる。こうしておくと生成は従来と完全に同じ動きになり、
 * 充足率が下がる回帰が起きない（矛盾自体は checkMonth が違反として報告する）。
 */
export function buildDayPatternCaps(
  rules: RuleWithId[],
  yearMonth: string,
  daysInMonth: number,
): DayPatternCaps {
  const caps: DayPatternCaps = new Map()

  const capRules = rules.filter(
    (r) =>
      r.enabled &&
      r.kind === 'hard' &&
      r.target.type === 'shift' &&
      (r.cond.type === 'none' || r.cond.type === 'atMost'),
  )
  if (capRules.length === 0) return caps

  for (let day = 1; day <= daysInMonth; day++) {
    let perPattern: Map<string, number> | undefined

    for (const rule of capRules) {
      if (!ruleAppliesToDate(rule.days, yearMonth, day)) continue
      const patternId = rule.target.value as string
      const limit = rule.cond.type === 'none' ? 0 : (rule.cond.count ?? 0)
      if (!perPattern) perPattern = new Map()
      const prev = perPattern.get(patternId)
      perPattern.set(patternId, prev == null ? limit : Math.min(prev, limit))
    }

    if (!perPattern) continue

    const demand = demandFor(rules, yearMonth, day)
    for (const [patternId, limit] of perPattern) {
      const need = demand[patternId] ?? 0
      if (need > limit) perPattern.set(patternId, need)
    }
    caps.set(day, perPattern)
  }

  return caps
}

/** その日そのパターンへあと1人置けるか。上限が無ければ常に true */
export function withinDayPatternCap(
  caps: DayPatternCaps | undefined,
  day: number,
  patternId: string,
  countAssigned: () => number,
): boolean {
  const limit = caps?.get(day)?.get(patternId)
  if (limit == null) return true
  if (limit === 0) return false
  return countAssigned() < limit
}
