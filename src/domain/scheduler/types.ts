import type { Compatibility, Rule, ShiftPattern, Staff } from '../../types/models'

export type StaffWithId = Staff & { id: string }
export type PatternWithId = ShiftPattern & { id: string }
export type RuleWithId = Rule & { id: string }
export type CompatibilityWithId = Compatibility & { id: string }

export interface CheckInput {
  yearMonth: string
  daysInMonth: number
  staff: StaffWithId[]
  shiftPatterns: PatternWithId[]
  /** staffId -> 日(1始まりの文字列) -> shiftPatternsのID */
  assignments: Record<string, Record<string, string>>
  rules: RuleWithId[]
  compatibilities: CompatibilityWithId[]
}

export interface CellViolation {
  staffId: string
  day: number
  message: string
}

export interface CheckResult {
  /** staffId -> 日 -> そのセルの違反メッセージ一覧 */
  cellMessages: Record<string, Record<number, string[]>>
  /** staffId -> 月単位の違反メッセージ一覧（勤務日数の過不足など、特定の日に紐付かないもの） */
  staffMessages: Record<string, string[]>
  hard: string[]
  soft: string[]
  hardCount: number
  softCount: number
}
