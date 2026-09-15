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

/**
 * shiftGroup(atLeastGroup) の hard ルールが、指定の日に不足しているかを判定する。
 * 不足しているルールの対象パターンID一式を返す（画面の日次集計行で赤枠表示するために使う）。
 * demandFor はこの種のルールを含めない（旧版どおり repair 側で扱うため）ので別関数にしている。
 */
export function shiftGroupDeficitPatternIds(
  rules: RuleWithId[],
  yearMonth: string,
  day: number,
  actualCountFor: (patternId: string) => number,
): Set<string> {
  const deficit = new Set<string>()
  for (const rule of rules) {
    if (!rule.enabled || rule.kind !== 'hard') continue
    if (rule.target.type !== 'shiftGroup' || rule.cond.type !== 'atLeastGroup') continue
    if (!ruleAppliesToDate(rule.days, yearMonth, day)) continue
    const ids = (rule.target.value as string[] | undefined) ?? []
    const total = ids.reduce((sum, id) => sum + actualCountFor(id), 0)
    if (total < (rule.cond.count ?? 0)) ids.forEach((id) => deficit.add(id))
  }
  return deficit
}
