import { ruleAppliesToDate } from './ruleMatch'
import type { AssignmentGrid, RuleWithId, StaffWithId } from './types'
import type { RuleDays } from '../../types/models'

/** 必須の「タグのペアを同一シフトに入れない」1件分を、職員IDの集合に展開したもの */
export interface TraitPairBlock {
  days: RuleDays
  aIds: Set<string>
  bIds: Set<string>
}

/**
 * 必須の「タグのペアを同一シフトに入れない」ルールを、配置判定で使える形に展開する。
 *
 * canWork がこれを見ることで、違反を作ってから hillClimb が偶然消すのをやめ、そもそも置かないようにする
 * （docs/remaining-work-design.md §3-4 の 4.6）。アミティホーム寺田の
 * 「臼井（見分けA）と中野（見分けB）を同じ勤務帯にしない」がこれにあたる。
 * 判定の意味は check.ts の evalRuleDay（traitPair / notTogether）と揃えている。
 */
export function buildTraitPairBlocks(rules: RuleWithId[], staff: StaffWithId[]): TraitPairBlock[] {
  const blocks: TraitPairBlock[] = []
  for (const r of rules) {
    if (!r.enabled || r.kind !== 'hard') continue
    if (r.target.type !== 'traitPair' || r.cond.type !== 'notTogether') continue
    const traitA = r.target.value as string | undefined
    const traitB = r.target.value2
    if (!traitA || !traitB) continue
    const aIds = new Set(staff.filter((s) => (s.traits ?? []).includes(traitA)).map((s) => s.id))
    const bIds = new Set(staff.filter((s) => (s.traits ?? []).includes(traitB)).map((s) => s.id))
    if (aIds.size === 0 || bIds.size === 0) continue
    blocks.push({ days: r.days, aIds, bIds })
  }
  return blocks
}

/** staffId をこの日この勤務に置くと、ペアの相手とかち合うか（呼び出し側で勤務パターンであることを確認済みの前提） */
export function conflictsWithTraitPair(
  blocks: TraitPairBlock[] | undefined,
  grid: AssignmentGrid,
  yearMonth: string,
  staffId: string,
  day: number,
  patternId: string,
): boolean {
  if (!blocks || blocks.length === 0) return false
  const key = String(day)
  for (const b of blocks) {
    // 両方のタグを持つ職員は、どちら側の相手ともかち合い得る
    const partners: Set<string>[] = []
    if (b.aIds.has(staffId)) partners.push(b.bIds)
    if (b.bIds.has(staffId)) partners.push(b.aIds)
    if (partners.length === 0) continue
    if (!ruleAppliesToDate(b.days, yearMonth, day)) continue
    for (const ids of partners) {
      for (const otherId of ids) {
        if (otherId !== staffId && grid[otherId]?.[key] === patternId) return true
      }
    }
  }
  return false
}
