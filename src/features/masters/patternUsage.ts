/**
 * 勤務パターンがどこで使われているかの判定（純関数）。remaining-work-design.md §18 A3。
 * 使用中のパターンを消すと、過去の勤務表のマスが空欄になったり、条件・設定が働かなくなったりするため、削除の前に調べる。
 */
import type { LeaveRequest, Rule, Schedule, ShiftRulesSettings, Staff } from '../../types/models'
import { formatYearMonthLabel } from '../../lib/dateUtils'

type WithId<T> = T & { id: string }

/**
 * 職員の「可能な勤務」と条件から参照されている勤務パターンID（Excel 取込の「使用中のため削除不可」の判定）。
 * Excel 取込の動きを変えないため、この関数の判定範囲は従来のまま広げない（広い判定は findPatternUsages）
 */
export function collectStaffRulePatternRefs(staff: Pick<Staff, 'workConditions'>[], rules: Pick<Rule, 'target' | 'cond'>[]): Set<string> {
  const used = new Set<string>()
  for (const s of staff) for (const id of s.workConditions?.workablePatternIds ?? []) used.add(id)
  for (const r of rules) {
    if (r.target.type === 'shift' && typeof r.target.value === 'string') used.add(r.target.value)
    if (r.target.type === 'shiftGroup') (r.target.value as string[] | undefined)?.forEach((id) => used.add(id))
    if (r.cond.type === 'preferShift' && r.cond.value) used.add(r.cond.value)
  }
  return used
}

export interface PatternUsageSources {
  staff: WithId<Staff>[]
  rules: Rule[]
  settings: Pick<ShiftRulesSettings, 'nightPrecedingPatternId' | 'nightAvoidPatternIdsAfter2' | 'shiftConsecutiveCaps'>
  /** 全月の勤務表（id = 年月） */
  schedules: WithId<Pick<Schedule, 'assignments' | 'secondaryAssignments'>>[]
  leaveRequests: Pick<LeaveRequest, 'desiredPatternId'>[]
}

function namesText(names: string[]): string {
  return names.length <= 5 ? names.join('、') : `${names.slice(0, 5).join('、')} ほか${names.length - 5}名`
}

function usesPattern(rows: Record<string, Record<string, string>> | undefined, patternId: string): boolean {
  return Object.values(rows ?? {}).some((byDay) => Object.values(byDay ?? {}).includes(patternId))
}

/** 勤務パターンが使われている場所の説明。空なら未使用（削除してよい） */
export function findPatternUsages(patternId: string, src: PatternUsageSources): string[] {
  const out: string[] = []

  const workable = src.staff.filter((s) => s.workConditions?.workablePatternIds?.includes(patternId)).map((s) => s.name)
  if (workable.length) out.push(`職員の「可能な勤務」: ${namesText(workable)}`)
  const ng = src.staff.filter((s) => s.workConditions?.ngPatternIds?.includes(patternId)).map((s) => s.name)
  if (ng.length) out.push(`職員の「不可の勤務」: ${namesText(ng)}`)

  const ruleCount = src.rules.filter(
    (r) =>
      ((r.target.type === 'shift' || r.target.type === 'secondaryShift') && r.target.value === patternId) ||
      (r.target.type === 'shiftGroup' && Array.isArray(r.target.value) && r.target.value.includes(patternId)) ||
      (r.cond.type === 'preferShift' && r.cond.value === patternId),
  ).length
  if (ruleCount) out.push(`条件: ${ruleCount}件`)

  if (src.settings.nightPrecedingPatternId === patternId) out.push('設定: 夜勤の前日の勤務')
  if (src.settings.nightAvoidPatternIdsAfter2?.includes(patternId)) out.push('設定: 夜勤の2日後に避ける勤務')
  if (src.settings.shiftConsecutiveCaps && patternId in src.settings.shiftConsecutiveCaps) out.push('設定: 勤務の連続日数の上限')

  const months = src.schedules
    .filter((sc) => usesPattern(sc.assignments, patternId) || usesPattern(sc.secondaryAssignments, patternId))
    .map((sc) => sc.id)
    .sort()
  if (months.length) out.push(`勤務表: ${months.map(formatYearMonthLabel).join('、')}`)

  const wishCount = src.leaveRequests.filter((w) => w.desiredPatternId === patternId).length
  if (wishCount) out.push(`勤務希望: ${wishCount}件`)

  return out
}
