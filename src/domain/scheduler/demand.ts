import { ruleAppliesToDate } from './ruleMatch'
import type { RuleWithId } from './types'

/**
 * その日の勤務パターンごとの必要人数（旧HTML版 demandFor 相当）。
 * 有効な必須(hard)ルールのうち、対象がシフト種別で条件が「ちょうどN名」「N名以上」の
 * ものから算出する。同一パターンに複数ルールがある場合は最大値を採用。
 * shiftGroup/atLeastGroup はここに含めない（repair側で別途扱う。旧版と同じ）。
 */
export function demandFor(
  rules: RuleWithId[],
  yearMonth: string,
  day: number,
): Record<string, number> {
  const demand: Record<string, number> = {}
  for (const rule of rules) {
    if (!rule.enabled || rule.kind !== 'hard') continue
    if (rule.target.type !== 'shift') continue
    if (rule.cond.type !== 'exact' && rule.cond.type !== 'atLeast') continue
    if (!ruleAppliesToDate(rule.days, yearMonth, day)) continue

    const patternId = rule.target.value as string
    const count = rule.cond.count ?? 0
    demand[patternId] = Math.max(demand[patternId] ?? 0, count)
  }
  return demand
}
