import type {
  Compatibility,
  EmploymentType,
  Rule,
  ShiftPattern,
  ShiftRulesSettings,
  Staff,
} from '../../types/models'
import type { MonthlyLimitsOverride } from './limits'
import type { GenerationConfig } from './defaults'
import type { DayPatternCaps } from './caps'
import type { TraitPairBlock } from './traitPairs'

export type StaffWithId = Staff & { id: string }
export type PatternWithId = ShiftPattern & { id: string }
export type RuleWithId = Rule & { id: string }
export type CompatibilityWithId = Compatibility & { id: string }
export type EmploymentTypeWithId = EmploymentType & { id: string }

/** staffId -> 日(1始まりの文字列) -> shiftPatterns のID */
export type AssignmentGrid = Record<string, Record<string, string>>

export interface CheckInput {
  yearMonth: string
  daysInMonth: number
  staff: StaffWithId[]
  employmentTypes: EmploymentTypeWithId[]
  shiftPatterns: PatternWithId[]
  assignments: AssignmentGrid
  /** 生活相談員などの兼務行（手入力のみ。自動生成は関与しない） */
  secondaryAssignments?: AssignmentGrid
  rules: RuleWithId[]
  compatibilities: CompatibilityWithId[]
  settings: ShiftRulesSettings
  /** staffId -> その月だけの勤務日数上限の上書き */
  monthlyMaxDaysOverride?: Record<string, MonthlyLimitsOverride>
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

// ------------------------------------------------------------------
// Phase 4d: 自動生成
// ------------------------------------------------------------------

/** canWork（配置可否判定）が参照する、生成途中のグリッドと関連データ */
export interface CanWorkContext {
  grid: AssignmentGrid
  yearMonth: string
  daysInMonth: number
  patternById: Map<string, PatternWithId>
  employmentTypeById: Map<string, EmploymentTypeWithId>
  settings: ShiftRulesSettings
  /** enabled の hard ルールのみで十分（forced-off 判定にのみ使う） */
  rules: RuleWithId[]
  compatibilities: CompatibilityWithId[]
  monthlyMaxDaysOverride?: Record<string, MonthlyLimitsOverride>
  /** 「配置しない」「N名以下」の人数上限。未設定なら上限チェックをしない */
  dayPatternCaps?: DayPatternCaps
  /** 必須の「タグのペアを同一シフトに入れない」。未設定ならチェックしない */
  traitPairBlocks?: TraitPairBlock[]
}

export interface GenerateInput {
  yearMonth: string
  daysInMonth: number
  staff: StaffWithId[]
  employmentTypes: EmploymentTypeWithId[]
  shiftPatterns: PatternWithId[]
  /** enabled のみ渡す */
  rules: RuleWithId[]
  compatibilities: CompatibilityWithId[]
  settings: ShiftRulesSettings
  /** 当月の希望休（type=希望休）のみ */
  wishes: { staffId: string; day: number }[]
  /** schedule.locks */
  lockedCells: Record<string, Record<string, true>>
  /** ロック引き継ぎ元（現在の assignments） */
  baseAssignments: AssignmentGrid
  monthlyMaxDaysOverride?: Record<string, MonthlyLimitsOverride>
  config: GenerationConfig
}

export type ScoreKey = 'fair' | 'comp' | 'wish' | 'soft' | 'interval' | 'spread'

export interface CandidateScores extends Record<ScoreKey, number> {
  total: number
}

export interface Candidate {
  profileKey: string
  label: string
  weights: Record<ScoreKey, number>
  assignments: AssignmentGrid
  scores: CandidateScores
  hardCount: number
  softCount: number
  hardViolations: string[]
  softViolations: string[]
  fulfillmentRate: number
}
