/**
 * Firestore コレクションの型定義。
 * 詳細・フィールドの意味は docs/firestore-design.md を参照。
 * Phase 1 で使うものだけを先に定義し、以降のフェーズで拡張する。
 */

export type Role = 'admin' | 'staff'

export interface AppUser {
  email: string
  displayName?: string
  organizationId: string
  facilityIds: string[]
  primaryFacilityId: string | null
  role: Role
  linkedStaffId: string | null
}

export interface Organization {
  name: string
}

export interface Facility {
  organizationId: string
  name: string
  shortName?: string
}

export interface StaffWorkConditions {
  workablePatternIds?: string[]
  ngPatternIds?: string[]
  nightShiftAllowed?: boolean | null
  nightShiftTarget?: number | null
  maxNightShiftsPerMonth?: number | null
  targetWorkdaysPerMonth?: number | null
  maxWorkdaysPerMonth?: number | null
  maxConsecutiveWorkdays?: number | null
  fixedOffWeekdays?: number[]
  notes?: string
}

export interface Staff {
  name: string
  nameKana?: string
  jobTypeId?: string
  employmentTypeId?: string
  active: boolean
  order?: number
  qualifications?: string[]
  traits?: string[]
  workConditions?: StaffWorkConditions
}

export interface JobType {
  label: string
  shortLabel?: string
  order?: number
  color?: string
}

export interface EmploymentType {
  label: string
  order?: number
  /** true の区分は「必要勤務日数(下限)」チェックの対象になる（例: 常勤） */
  hasTargetWorkdays?: boolean
}

export type ShiftCategory =
  | 'day'
  | 'early'
  | 'late'
  | 'night'
  | 'afterNight'
  | 'off'
  | 'paidLeave'
  | 'individual'

export interface ShiftPattern {
  code: string
  label: string
  startTime?: string
  endTime?: string
  category?: ShiftCategory
  isWork: boolean
  isNight: boolean
  isSystem?: boolean
  order?: number
  color?: string
  /** 記号の文字色（パステル背景とペアで使う） */
  textColor?: string
}

export type RuleDaysType = 'all' | 'weekdays' | 'weekend' | 'dow' | 'dates'

export interface RuleDays {
  type: RuleDaysType
  /** dow: 0(日)〜6(土) の配列 / dates: "YYYY-MM-DD" の配列 */
  values?: number[] | string[]
}

export type RuleTargetType =
  | 'shift'
  | 'qualification'
  | 'trait'
  | 'staff'
  | 'traitPair'
  | 'shiftGroup'

export interface RuleTarget {
  type: RuleTargetType
  /** shift/staff: id、qualification/trait/traitPairのvalue: 名称、shiftGroup: id配列 */
  value?: string | string[]
  /** traitPair のときだけ使う、もう一方のタグ名 */
  value2?: string
}

export type RuleCondType =
  | 'exact'
  | 'atLeast'
  | 'atMost'
  | 'none'
  | 'work'
  | 'off'
  | 'together'
  | 'notTogether'
  | 'atLeastGroup'
  | 'notTogetherGroup'
  | 'preferShift'

export interface RuleCond {
  type: RuleCondType
  count?: number
  /** preferShift のときだけ使う、優先する勤務パターンID */
  value?: string
}

export type RuleKind = 'hard' | 'soft'

export interface Rule {
  enabled: boolean
  kind: RuleKind
  days: RuleDays
  target: RuleTarget
  cond: RuleCond
  order?: number
}

export type CompatibilityLevel = 'double' | 'caution' | 'x'

/**
 * 職員ペアの相性。「普通(good)」は保存しない（存在しない＝普通）。
 * ドキュメントIDは staffIdA/staffIdB を昇順で連結したもの（lib/firestore.ts 参照）。
 */
export interface Compatibility {
  staffIdA: string
  staffIdB: string
  level: CompatibilityLevel
  weight?: number | null
  note?: string
}

export type LeaveRequestType = '希望休' | '有給希望' | '勤務希望'
export type LeaveRequestPriority = 'must' | 'want'
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequest {
  staffId: string
  yearMonth: string
  date: string
  type: LeaveRequestType
  desiredPatternId: string | null
  priority: LeaveRequestPriority
  status: LeaveRequestStatus
  createdByUid: string
}

export type NightMode = 'ake' | 'direct'

/**
 * facilities/{fid}/settings/shiftRules。未作成なら「全て制約なし」として扱う
 * （lib/firestore.ts の fetchShiftRulesSettings が既定値を返す）。
 */
export interface ShiftRulesSettings {
  /** null = 夜勤ブロックの制約なし。'ake' = 夜→明→休／'direct' = 夜→公休 */
  nightMode: NightMode | null
  /** direct のとき、夜勤の2日後に避ける勤務パターンID */
  nightAvoidPatternIdsAfter2: string[]
  /** patternId -> 連続日数の上限 */
  shiftConsecutiveCaps: Record<string, number>
  /** 勤務間インターバル（時間）。下回るとsoft違反 */
  minRestHours: number | null
  preferredFillTimeRange: { start: string | null; end: string | null }
  /** null/true = 相性×を必須(hard)扱い。false = スコア減点のみ */
  treatCompatibilityXAsHard: boolean | null
  maxConsecutiveWorkdaysDefault: number | null
  monthlyLimitsDefault: {
    targetWorkdays: number | null
    maxWorkdays: number | null
    maxNightShifts: number | null
  }
}

export type ScheduleStatus = 'draft' | 'confirmed' | 'archived'

export type ScheduleGenerationSource = 'manual' | 'auto'

/** 自動生成で採択した場合の記録（schedules/{ym}.generationMeta） */
export interface ScheduleGenerationMeta {
  source: ScheduleGenerationSource
  /** auto のとき採択した candidates ドキュメントID */
  candidateId: string | null
  /** 生成時に使った重み・係数のスナップショット（監査用。中身は問わない） */
  generationConfigSnapshot: Record<string, unknown> | null
  generatedAt: unknown | null
}

/** facilityId/schedules/{yearMonth} の中身。Phase 3a では assignments / locks のみ使用 */
export interface Schedule {
  yearMonth: string
  daysInMonth: number
  status?: ScheduleStatus
  /** staffId -> 日(1始まりの文字列) -> shiftPatterns のドキュメントID */
  assignments?: Record<string, Record<string, string>>
  /** staffId -> 日 -> ロック中か */
  locks?: Record<string, Record<string, boolean>>
  /** この月だけの勤務日数上限の上書き（P5） */
  monthlyMaxDaysOverride?: Record<string, { targetWorkdays?: number | null; maxWorkdays?: number | null }>
  /** 日(1始まりの文字列) -> 行事・予定のテキスト（P5） */
  events?: Record<string, string>
  generationMeta?: ScheduleGenerationMeta
  revision?: number
}
