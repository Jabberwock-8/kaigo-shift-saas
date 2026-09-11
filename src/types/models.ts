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

export type ScheduleStatus = 'draft' | 'confirmed' | 'archived'

/** facilityId/schedules/{yearMonth} の中身。Phase 3a では assignments / locks のみ使用 */
export interface Schedule {
  yearMonth: string
  daysInMonth: number
  status?: ScheduleStatus
  /** staffId -> 日(1始まりの文字列) -> shiftPatterns のドキュメントID */
  assignments?: Record<string, Record<string, string>>
  /** staffId -> 日 -> ロック中か */
  locks?: Record<string, Record<string, boolean>>
  revision?: number
}
